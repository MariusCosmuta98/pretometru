import { z } from 'zod';
import {
  CHAINS,
  DOC_TYPES,
  LINE_KINDS,
  ParsedReceiptSchema,
  parsePackSize,
  QTY_UNITS,
  type LineKind,
  type ParsedLine,
  type ParsedReceipt,
  type ParseWarning,
} from '@/domain';
import { finishReceipt } from '@/parsers';
import { lineKindOf } from '@/parsers/line-kind';
import { AiError } from './errors';
import { GEMINI_READING_VERSION } from './prompt';
import { toBani, toChoice, toEan, toPurchasedAt, toQuantity, toText } from './values';

/** Longer than any receipt's answer; a bigger one is not an answer. */
export const MAX_ANSWER_CHARS = 200_000;
/** More printed rows than this on one receipt means a looping model, not a long receipt. */
export const MAX_LINES = 300;

const MAX_NAME = 200;
const MAX_STORE_NAME = 120;
const MAX_CITY = 60;
const MAX_CODE = 40;
const MAX_DOCUMENT_NO = 60;

/** The placeholder of a row whose name was not read (the same text as the review's `UNNAMED_LINE`). */
export const UNNAMED_LINE = '(fără nume)';

const AnswerSchema = z.looseObject({ lines: z.array(z.unknown()) });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (message: string, cause?: unknown) =>
  new AiError('MALFORMED', message, cause === undefined ? {} : { cause });

/** JSON as the model wrote it, tolerating one markdown fence around it. */
function parseAnswerJson(answer: string): unknown {
  const text = answer.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  try {
    return JSON.parse(fenced?.[1] ?? text) as unknown;
  } catch (cause) {
    throw malformed('The answer is not JSON', cause);
  }
}

/** The model's word for "product" does not outrank the name and the sign: they decide it, as for every parser. */
function kindOf(modelKind: LineKind | undefined, name: string, totalBani: number): LineKind {
  const derived = lineKindOf(name, totalBani);
  return modelKind === undefined || modelKind === 'product' ? derived : modelKind;
}

type LineOutcome =
  /** Nothing on the row: skipped without a word. */
  | { kind: 'empty' }
  /** A row with a name but no usable amount (or no object at all): counted, reported once. */
  | { kind: 'dropped' }
  | { kind: 'line'; line: ParsedLine; flags: string[] };

const present = (value: unknown): boolean => value !== undefined && value !== null;

function convertLine(entry: unknown, idx: number): LineOutcome {
  if (!present(entry)) return { kind: 'empty' };
  if (!isRecord(entry)) return { kind: 'dropped' };

  const name = toText(entry['name'], MAX_NAME);
  const totalBani = toBani(entry['total']);
  if (totalBani === undefined) return name === undefined ? { kind: 'empty' } : { kind: 'dropped' };
  if (name === undefined && totalBani === 0) return { kind: 'empty' };

  const flags: string[] = [];
  const rawName = name ?? UNNAMED_LINE;
  if (name === undefined) flags.push('Gemini nu a citit numele produsului.');

  const kind = kindOf(toChoice(entry['kind'], LINE_KINDS), rawName, totalBani);
  if (kind === 'discount' && totalBani > 0) {
    flags.push('Linia este marcată ca reducere, dar suma este pozitivă.');
  }

  let qty = present(entry['quantity']) ? toQuantity(entry['quantity']) : 1;
  if (qty === undefined) {
    qty = 1;
    flags.push('Cantitatea citită de AI nu a putut fi folosită: am pus 1.');
  }
  let qtyUnit = present(entry['unit']) ? toChoice(entry['unit'], QTY_UNITS) : 'buc';
  if (qtyUnit === undefined) {
    qtyUnit = 'buc';
    flags.push('Unitatea citită de AI nu a putut fi folosită: am pus buc.');
  }

  const ean = toEan(entry['ean']);
  if (ean.kind === 'rejected')
    flags.push('Codul de bare citit de AI nu este valid și a fost ignorat.');
  if (entry['uncertain'] === true)
    flags.push('Gemini a marcat linia ca greu de citit: verific-o cu poza.');

  // A zero unit price or discount is how a model says "not printed": it is not a price.
  const unitPriceBani = toBani(entry['unitPrice']);
  const discountBani = toBani(entry['discount']);

  const line: ParsedLine = { idx, rawName, kind, qty, qtyUnit, lineTotalBani: totalBani };
  if (unitPriceBani !== undefined && unitPriceBani > 0) line.unitPriceBani = unitPriceBani;
  if (discountBani !== undefined && discountBani > 0) line.discountBani = discountBani;
  if (ean.kind === 'ean') line.ean = ean.ean;
  if (kind === 'product' && qtyUnit === 'buc') {
    const size = parsePackSize(rawName);
    if (size) line.pack = { qty: size.qty, unit: size.unit };
  }
  return { kind: 'line', line, flags };
}

export interface ConvertOptions {
  /** The model that answered: it becomes `meta.parser`. */
  model: string;
  /** The clock of the date checks. */
  now: Date;
}

/**
 * The model's answer as a `ParsedReceipt` that went through the same checks as any other engine's:
 * every field is converted exactly or left out (never rounded, clamped or guessed), a row that has
 * no usable amount is dropped and counted, doubtful rows get a `LOW_CONFIDENCE` warning, then
 * `finishReceipt` adds the arithmetic warnings (`SUM_MISMATCH`, `LINE_ARITHMETIC`, `MISSING_*`,
 * `FUTURE_DATE`, `UNKNOWN_CHAIN`) and the contract schema has the last word. Fails with an
 * `AiError`: `MALFORMED` (not JSON of the asked shape, or nothing usable in it) or `NO_LINES`.
 */
export function convertAnswer(answer: string, options: ConvertOptions): ParsedReceipt {
  if (answer.length > MAX_ANSWER_CHARS) throw malformed('The answer is too long');
  const json = parseAnswerJson(answer);
  const shape = AnswerSchema.safeParse(json);
  if (!shape.success || !isRecord(json)) throw malformed('The answer has no "lines" array');

  const entries = shape.data.lines;
  if (entries.length === 0) throw new AiError('NO_LINES', 'The answer has no line');
  if (entries.length > MAX_LINES) throw malformed(`The answer has more than ${MAX_LINES} lines`);

  const lines: ParsedLine[] = [];
  const notes: ParseWarning[] = [];
  let dropped = 0;
  for (const entry of entries) {
    const outcome = convertLine(entry, lines.length);
    if (outcome.kind === 'dropped') dropped++;
    if (outcome.kind !== 'line') continue;
    lines.push(outcome.line);
    if (outcome.flags.length > 0) {
      notes.push({
        code: 'LOW_CONFIDENCE',
        lineIdx: outcome.line.idx,
        message: `Linia „${outcome.line.rawName}”: ${outcome.flags.join(' ')}`,
      });
    }
  }
  if (lines.length === 0) throw malformed('No line of the answer is usable');
  if (dropped > 0) {
    notes.push({
      code: 'LOW_CONFIDENCE',
      message:
        dropped === 1
          ? 'O linie din răspunsul AI nu a putut fi folosită (suma lipsește sau nu este validă): verifică suma bonului.'
          : `${dropped} linii din răspunsul AI nu au putut fi folosite (suma lipsește sau nu este validă): verifică suma bonului.`,
    });
  }

  const total = toBani(json['total']);
  const grandTotalBani = total !== undefined && total >= 0 ? total : 0;
  const paid = toBani(json['paid']);
  const paidBani = paid !== undefined && paid >= 0 ? paid : undefined;
  const voucherBani =
    total !== undefined && paidBani !== undefined && paidBani < grandTotalBani
      ? grandTotalBani - paidBani
      : undefined;

  const storeName = toText(json['store'], MAX_STORE_NAME);
  const city = toText(json['city'], MAX_CITY);
  const code = toText(json['storeCode'], MAX_CODE);
  const documentNo = toText(json['documentNumber'], MAX_DOCUMENT_NO);
  const purchasedAt = toPurchasedAt(json['purchasedAt']);

  const receipt: ParsedReceipt = {
    schemaVersion: 1,
    chain: toChoice(json['chain'], CHAINS) ?? 'unknown',
    ...(storeName === undefined ? {} : { storeName }),
    ...(city === undefined && code === undefined
      ? {}
      : {
          branch: {
            ...(code === undefined ? {} : { code }),
            ...(city === undefined ? {} : { city }),
          },
        }),
    docType: toChoice(json['documentType'], DOC_TYPES) ?? 'receipt',
    ...(documentNo === undefined ? {} : { documentNo }),
    ...(purchasedAt === undefined ? {} : { purchasedAt }),
    currency: 'RON',
    totals: {
      grandTotalBani,
      ...(voucherBani === undefined ? {} : { voucherBani }),
      ...(paidBani === undefined ? {} : { paidBani }),
    },
    lines,
    meta: {
      engine: 'gemini',
      parser: options.model,
      parserVersion: GEMINI_READING_VERSION,
      warnings: [],
    },
  };

  const checked = ParsedReceiptSchema.safeParse(
    finishReceipt(receipt, notes, { now: options.now }),
  );
  if (!checked.success) throw malformed('The reading does not satisfy the receipt contract');
  return checked.data;
}
