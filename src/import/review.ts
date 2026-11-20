import type { ParseWarning, Receipt, WarningCode } from '@/domain';
import { sumBani } from '@/domain';
import { duplicateWarning } from './duplicates';
import { parsedFromDraft, type ReceiptDraft } from './draft';
import type {
  FieldError,
  FieldTarget,
  FormRead,
  LineField,
  ReceiptField,
  ReceiptForm,
} from './form';
import type { ParserPort } from './ports';

/** Warnings the user must explicitly accept before a receipt can be confirmed. */
export const ACK_CODES = ['FUTURE_DATE', 'DUPLICATE', 'SUM_MISMATCH'] as const;
export type AckCode = (typeof ACK_CODES)[number];

/**
 * What the user accepted: per warning, a token of the situation that was accepted (the date, the
 * difference, the duplicate ids). A later edit that changes the situation changes the token, so
 * the acceptance lapses by itself.
 */
export type Acks = Partial<Record<AckCode, string>>;

/**
 * Import-time warnings that cannot be recomputed from the stored fields (the digit repair, the OCR
 * confidence, the printed unit price are gone after a reload). They stay on screen until the user
 * edits or verifies the line they point at (or, for the whole receipt, verifies the receipt).
 */
const CARRIED_CODES: ReadonlySet<WarningCode> = new Set([
  'LINE_ARITHMETIC',
  'LOW_CONFIDENCE',
  'REPAIRED_DIGITS',
]);

/** The `reviewed` key that dismisses the import's receipt-level doubts (as a line id does for a line). */
export const RECEIPT_REVIEW_KEY = '*';

const DISPLAY_ORDER: readonly WarningCode[] = [
  'MISSING_TOTAL',
  'MISSING_DATE',
  'FUTURE_DATE',
  'DUPLICATE',
  'SUM_MISMATCH',
  'VAT_MISMATCH',
  'UNKNOWN_CHAIN',
  'LOW_CONFIDENCE',
  'LINE_ARITHMETIC',
  'REPAIRED_DIGITS',
];

export interface ReviewContext {
  parser: ParserPort;
  now: Date;
  /** Stored receipts that look like this one. */
  duplicates: readonly Receipt[];
  /** Ids of the lines the user edited or verified since the import (`RECEIPT_REVIEW_KEY`: the receipt). */
  reviewed: ReadonlySet<string>;
}

export interface Analysis {
  sumBani: number;
  totalBani: number;
  /** Sum of the lines minus the printed total. */
  differenceBani: number;
  /** Receipt-level warnings first, then the lines' in printed order. */
  warnings: ParseWarning[];
  /** Tokens of the warnings that need an acceptance right now. */
  ackTokens: Acks;
}

const orderOf = (code: WarningCode) => DISPLAY_ORDER.indexOf(code);

/**
 * Everything the review screen shows about a draft: the live sum against the printed total and the
 * warnings, i.e. the parsers' arithmetic validation re-run on the edited draft, the duplicate
 * check, an unknown chain, and the import warnings that still await the user.
 */
export function analyze(draft: ReceiptDraft, context: ReviewContext): Analysis {
  const sum = sumBani(draft.lines.map((line) => line.lineTotalBani));
  const differenceBani = sum - draft.totalBani;

  const warnings: ParseWarning[] = [
    ...context.parser.validateReceipt(parsedFromDraft(draft), { now: context.now }),
  ];
  const has = (code: WarningCode, lineIdx?: number) =>
    warnings.some((warning) => warning.code === code && warning.lineIdx === lineIdx);

  if (draft.store.chain === 'unknown' && !has('UNKNOWN_CHAIN')) {
    warnings.push({ code: 'UNKNOWN_CHAIN', message: 'Magazinul nu a fost recunoscut.' });
  }
  if (context.duplicates.length > 0 && !has('DUPLICATE')) {
    warnings.push(duplicateWarning(context.duplicates));
  }

  const lineById = new Map(draft.lines.map((line) => [line.idx, line]));
  for (const warning of draft.extraction.warnings) {
    if (!CARRIED_CODES.has(warning.code) || has(warning.code, warning.lineIdx)) continue;
    if (warning.lineIdx === undefined) {
      if (context.reviewed.has(RECEIPT_REVIEW_KEY)) continue;
    } else {
      const line = lineById.get(warning.lineIdx);
      if (line === undefined || context.reviewed.has(line.id)) continue;
      // With the printed unit price at hand, the fresh validation above is authoritative.
      if (warning.code === 'LINE_ARITHMETIC' && line.unitPriceBani !== undefined) continue;
    }
    warnings.push(warning);
  }

  warnings.sort((a, b) => {
    if ((a.lineIdx === undefined) !== (b.lineIdx === undefined))
      return a.lineIdx === undefined ? -1 : 1;
    return (a.lineIdx ?? 0) - (b.lineIdx ?? 0) || orderOf(a.code) - orderOf(b.code);
  });

  const ackTokens: Acks = {};
  for (const warning of warnings) {
    if (warning.code === 'FUTURE_DATE') ackTokens.FUTURE_DATE = draft.purchasedAt ?? '';
    if (warning.code === 'SUM_MISMATCH') ackTokens.SUM_MISMATCH = String(differenceBani);
    if (warning.code === 'DUPLICATE') {
      ackTokens.DUPLICATE = context.duplicates
        .map((receipt) => receipt.id)
        .sort()
        .join(',');
    }
  }

  return { sumBani: sum, totalBani: draft.totalBani, differenceBani, warnings, ackTokens };
}

/** Warnings that currently need an acceptance and have none. */
export function pendingAcks(analysis: Analysis, acks: Acks): AckCode[] {
  return ACK_CODES.filter(
    (code) => analysis.ackTokens[code] !== undefined && acks[code] !== analysis.ackTokens[code],
  );
}

export type Blocker =
  | { kind: 'field'; target: FieldTarget; error: FieldError | 'not-positive' }
  | { kind: 'no-lines' }
  | { kind: 'ack'; code: AckCode };

const RECEIPT_FIELDS: readonly ReceiptField[] = ['date', 'time', 'total', 'paid'];

/**
 * Why a receipt cannot be confirmed yet, in the order the screen shows the fields: invalid or
 * missing values (a confirmed receipt needs a date and a total), no lines, and warnings the user
 * has not accepted. Saving a draft is only blocked by invalid values.
 */
export function confirmBlockers(
  form: ReceiptForm,
  read: FormRead,
  analysis: Analysis,
  acks: Acks,
): Blocker[] {
  const blockers: Blocker[] = [];
  const { errors, draft } = read;

  for (const field of RECEIPT_FIELDS) {
    const error = errors.receipt[field];
    if (error) blockers.push({ kind: 'field', target: { scope: 'receipt', field }, error });
  }
  if (draft.purchasedAt === undefined && errors.receipt.date === undefined) {
    blockers.push({
      kind: 'field',
      target: { scope: 'receipt', field: 'date' },
      error: 'required',
    });
  }
  if (errors.receipt.total === undefined && draft.totalBani <= 0) {
    blockers.push({
      kind: 'field',
      target: { scope: 'receipt', field: 'total' },
      error: 'not-positive',
    });
  }

  for (const line of form.lines) {
    const lineErrors = errors.lines[line.id];
    for (const [field, error] of Object.entries(lineErrors ?? {}) as Array<
      [LineField, FieldError]
    >) {
      blockers.push({ kind: 'field', target: { scope: 'line', lineId: line.id, field }, error });
    }
  }
  if (form.lines.length === 0) blockers.push({ kind: 'no-lines' });

  for (const code of pendingAcks(analysis, acks)) blockers.push({ kind: 'ack', code });
  return blockers;
}
