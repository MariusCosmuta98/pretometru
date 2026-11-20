import type { ParseWarning, Receipt, WarningCode } from '@/domain';
import { sumBani } from '@/domain';
import { SUM_TOLERANCE_BANI } from '@/parsers';
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
  /** How `differenceBani` stands against the parsers' tolerance. */
  sumMatch: SumMatch;
  /** The tolerance behind `sumMatch`, in bani: the parsers' `SUM_TOLERANCE_BANI`. */
  toleranceBani: number;
  /** Receipt-level warnings first, then the lines' in printed order. */
  warnings: ParseWarning[];
  /**
   * The warnings (the very same objects) that come from the import and can be dismissed by
   * verifying the line or the receipt; the others re-appear as long as the numbers disagree.
   */
  dismissible: ReadonlySet<ParseWarning>;
  /** Tokens of the warnings that need an acceptance right now. */
  ackTokens: Acks;
}

/**
 * How the lines add up against the printed total: to the ban, off by a few bani that the parsers
 * accept (METRO prints its VAT rounded per rate, so an invoice can be 1 ban off), or beyond that
 * tolerance, which is what raises SUM_MISMATCH.
 */
export type SumMatch = 'exact' | 'within-tolerance' | 'outside-tolerance';

/**
 * Classifies `sum - total` with the parsers' own tolerance, so that the screen never calls a
 * difference acceptable that the validation flags, or the other way round. A total that was not
 * read (0) has nothing to be within tolerance of, like in `checkSumMismatch`.
 */
export function sumMatchOf(differenceBani: number, totalBani: number): SumMatch {
  if (differenceBani === 0) return 'exact';
  return totalBani !== 0 && Math.abs(differenceBani) <= SUM_TOLERANCE_BANI
    ? 'within-tolerance'
    : 'outside-tolerance';
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
  const dismissible = new Set<ParseWarning>();
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
    dismissible.add(warning);
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

  return {
    sumBani: sum,
    totalBani: draft.totalBani,
    differenceBani,
    sumMatch: sumMatchOf(differenceBani, draft.totalBani),
    toleranceBani: SUM_TOLERANCE_BANI,
    warnings,
    dismissible,
    ackTokens,
  };
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

function receiptFieldBlockers({ errors }: FormRead): Blocker[] {
  return RECEIPT_FIELDS.flatMap((field): Blocker[] => {
    const error = errors.receipt[field];
    return error ? [{ kind: 'field', target: { scope: 'receipt', field }, error }] : [];
  });
}

function lineFieldBlockers(form: ReceiptForm, { errors }: FormRead): Blocker[] {
  return form.lines.flatMap((line) =>
    (Object.entries(errors.lines[line.id] ?? {}) as Array<[LineField, FieldError]>).map(
      ([field, error]): Blocker => ({
        kind: 'field',
        target: { scope: 'line', lineId: line.id, field },
        error,
      }),
    ),
  );
}

/** The fields whose text is not a valid value: all that stops a draft from being saved. */
export function fieldErrorBlockers(form: ReceiptForm, read: FormRead): Blocker[] {
  return [...receiptFieldBlockers(read), ...lineFieldBlockers(form, read)];
}

/**
 * Why a receipt cannot be confirmed yet, in the order the screen shows the fields: invalid or
 * missing values (a confirmed receipt needs a date and a total), no lines, and warnings the user
 * has not accepted. Saving a draft is only blocked by invalid values (`fieldErrorBlockers`).
 */
export function confirmBlockers(
  form: ReceiptForm,
  read: FormRead,
  analysis: Analysis,
  acks: Acks,
): Blocker[] {
  const blockers: Blocker[] = receiptFieldBlockers(read);
  const { errors, draft } = read;

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

  blockers.push(...lineFieldBlockers(form, read));
  if (form.lines.length === 0) blockers.push({ kind: 'no-lines' });

  for (const code of pendingAcks(analysis, acks)) blockers.push({ kind: 'ack', code });
  return blockers;
}
