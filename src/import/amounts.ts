import { BaniSchema, EanSchema, parseBani, QtySchema } from '@/domain';

/*
 * Text <-> number conversions for editable fields. Receipts print a decimal comma; people type
 * either `,` or `.`, and often leave the decimals out. Money stays integer bani throughout.
 */

const MINUS = '[-\\u2212\\u2013]';
const LOOSE_AMOUNT = new RegExp(`^(${MINUS})?(\\d+)(?:[.,](\\d))?$`);
const QTY = /^(\d+)(?:[.,](\d{1,3}))?$/;

/** `-1234` -> `-12,34`: decimal comma, no digit grouping (this is editable text, not display). */
export function formatLeiInput(bani: number): string {
  const abs = Math.abs(bani);
  return `${bani < 0 ? '-' : ''}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/**
 * Reads an amount in lei as bani: `22,99`, `1.234,56`, `22`, `2,5`, `-20,00`, `2,49-`, `12,50 lei`.
 * `undefined` for anything else, including more than two decimals and out-of-range values.
 */
export function parseLeiInput(text: string): number | undefined {
  const cleaned = text.trim().replace(/\s*(?:lei|ron)$/i, '');
  if (cleaned === '') return undefined;

  let bani = parseBani(cleaned);
  if (bani === undefined) {
    const loose = LOOSE_AMOUNT.exec(cleaned);
    if (!loose) return undefined;
    const [, sign, whole, tenths] = loose;
    const magnitude = Number(whole) * 100 + Number(tenths ?? '0') * 10;
    bani = sign && magnitude !== 0 ? -magnitude : magnitude;
  }
  return BaniSchema.safeParse(bani).success ? bani : undefined;
}

/** `0.92` -> `0,92`. */
export function formatQtyInput(qty: number): string {
  return String(qty).replace('.', ',');
}

/** A positive quantity or pack size with up to three decimals (`0,920`), or `undefined`. */
export function parseQtyInput(text: string): number | undefined {
  const match = QTY.exec(text.trim());
  if (!match) return undefined;
  const qty = Number(`${match[1] ?? '0'}.${match[2] ?? '0'}`);
  return QtySchema.safeParse(qty).success ? qty : undefined;
}

/** Digits of an EAN typed or scanned with spaces or dashes; `undefined` when empty or not an EAN. */
export function parseEanInput(text: string): string | undefined {
  const digits = text.replace(/[\s-]/g, '');
  return EanSchema.safeParse(digits).success ? digits : undefined;
}
