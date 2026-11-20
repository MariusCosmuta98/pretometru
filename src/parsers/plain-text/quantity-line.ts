import type { QtyUnit } from '@/domain';
import { findAmounts, parsePrintedQuantity } from './amounts';

/**
 * `2,000 BUC x 4,05`, `0,436 KG x 14,99 Lei/kg`: how many units were sold and the unit price, on a
 * line of their own above the product line (Lidl) or at the end of it, before the total
 * (`Lapte 2 x 5,99 11,98`, generic).
 */
export interface QuantityLine {
  qty: number;
  qtyUnit: QtyUnit;
  unitPriceBani: number;
}

const UNITS: Readonly<Record<string, QtyUnit>> = {
  buc: 'buc',
  bucati: 'buc',
  bucata: 'buc',
  kg: 'kg',
  l: 'l',
  lt: 'l',
};

const D = '[0-9OoIl|SBZ]';
const QTY = `${D}{1,5}(?:[.,]${D}{1,3})?`;
const PRICE = `${D}+[.,]${D}{2}`;
// The multiplication sign is a token of its own: the X of "2L Xylitol" is a letter of a word.
const TIMES = '[xX*\\u00d7](?!\\p{L})';
// After the unit price only a per-unit suffix may follow (`Lei/kg`): otherwise it is a product line.
const PER_UNIT = '(?:\\s*(?:lei|ron)?\\s*/\\s*\\p{L}+)?';

const QUANTITY_LINE = new RegExp(
  `^(?<qty>${QTY})\\s*(?<unit>[A-Za-z]{1,7})?\\s*${TIMES}\\s*(?<price>${PRICE})${PER_UNIT}$`,
  'iu',
);
const INLINE_QUANTITY = new RegExp(
  `^(?<name>.*?\\S)\\s+(?<qty>${QTY})\\s*(?<unit>[A-Za-z]{1,7})?\\s*${TIMES}\\s*(?<price>${PRICE})$`,
  'iu',
);

function toQuantity(
  qtyText: string,
  unitText: string | undefined,
  priceText: string,
): QuantityLine | undefined {
  const qty = parsePrintedQuantity(qtyText);
  const price = findAmounts(priceText)[0];
  if (qty === undefined || !price || price.bani < 0) return undefined;

  const unit = unitText === undefined ? undefined : UNITS[unitText.toLowerCase()];
  // "250 g x 12,99" is a pack size, not a quantity. A unit OCR garbled ("BUG") is only accepted in
  // the `n,000` format that quantity lines are printed in.
  if (unitText !== undefined && unit === undefined && !/[.,].{3}$/.test(qtyText)) return undefined;
  return { qty, qtyUnit: unit ?? 'buc', unitPriceBani: price.bani };
}

export function readQuantityLine(text: string): QuantityLine | undefined {
  const groups = QUANTITY_LINE.exec(text.trim())?.groups;
  if (!groups?.qty || groups.price === undefined) return undefined;
  return toQuantity(groups.qty, groups.unit, groups.price);
}

/** The product name and quantity of `Lapte 2 x 5,99` (the label of a line whose total follows). */
export function readInlineQuantity(label: string): (QuantityLine & { name: string }) | undefined {
  const groups = INLINE_QUANTITY.exec(label.trim())?.groups;
  if (!groups?.name || !groups.qty || groups.price === undefined) return undefined;
  const quantity = toQuantity(groups.qty, groups.unit, groups.price);
  return quantity && { ...quantity, name: groups.name };
}
