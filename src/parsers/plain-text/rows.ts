import { findAmounts } from './amounts';

/**
 * The rows that close a receipt: `TOTAL 61,67`, `Subtotal 61,67`, `CARD 20,69`, `REST 6,86`.
 * Only the strict form counts, a label and one amount and nothing else, because a product can be
 * called "Total 0% grasime" or "Card cadou": `Total 0% grasime 5,99 B` is not the total.
 */

const AMOUNT = String.raw`[0-9OoIl|SBZ]+(?:\.\d{3})*[.,][0-9OoIl|SBZ]{2}`;
const CURRENCY = String.raw`(?:\s*(?:lei|ron))?`;

const TOTAL = new RegExp(
  String.raw`^t[o0]tal(?:\s+(?:lei|ron|de\s+plat[aă]))?\s*:?\s*(${AMOUNT})${CURRENCY}$`,
  'iu',
);
const SUBTOTAL = new RegExp(String.raw`^sub\s*-?\s*t[o0]tal\s*:?\s*(${AMOUNT})${CURRENCY}$`, 'iu');
const PAYMENT = new RegExp(String.raw`^(card|numerar|cash)\s*:?\s*(${AMOUNT})${CURRENCY}$`, 'iu');
const CHANGE = new RegExp(
  String.raw`^rest(?:\s+de\s+plat[aă])?\s*:?\s*(${AMOUNT})${CURRENCY}$`,
  'iu',
);
// The VAT total (`TOTAL TVA 8,64`) is not the total of the goods.
const VAT_TOTAL = /^t[o0]tal\s+tva\b/i;

function amountIn(text: string, pattern: RegExp, group = 1): number | undefined {
  const printed = pattern.exec(text.trim())?.[group];
  return printed === undefined ? undefined : findAmounts(printed)[0]?.bani;
}

/** `TOTAL 61,67`, `TOTAL LEI 61,67`, `TOTAL DE PLATA 61,67` -> 6167. */
export const readTotalRow = (text: string): number | undefined => amountIn(text, TOTAL);

/** `Subtotal 61,67` -> 6167. */
export const readSubtotalRow = (text: string): number | undefined => amountIn(text, SUBTOTAL);

/** `CARD 20,69`, `NUMERAR 100,00` -> the payment; `undefined` for any other row. */
export function readPaymentRow(
  text: string,
): { method: 'card' | 'cash'; bani: number } | undefined {
  const method = PAYMENT.exec(text.trim())?.[1];
  const bani = amountIn(text, PAYMENT, 2);
  if (method === undefined || bani === undefined) return undefined;
  return { method: method.toLowerCase() === 'card' ? 'card' : 'cash', bani };
}

/** `REST 6,86` -> the change handed back. */
export const readChangeRow = (text: string): number | undefined => amountIn(text, CHANGE);

/** A row of the totals block: the total, the subtotal, the VAT total, a payment or the change. */
export function isTotalsRow(text: string): boolean {
  return (
    readTotalRow(text) !== undefined ||
    readSubtotalRow(text) !== undefined ||
    VAT_TOTAL.test(text) ||
    readPaymentRow(text) !== undefined ||
    readChangeRow(text) !== undefined
  );
}
