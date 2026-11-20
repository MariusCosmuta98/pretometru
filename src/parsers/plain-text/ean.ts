/**
 * EAN / GTIN helpers. Receipts print the code under the product (Mega Image) or in a column
 * (METRO); OCR may drop or confuse digits, and some prints omit the check digit.
 */

/** Check digit of the code without it (GTIN-8/12/13/14: weights 3,1,3,1... from the right). */
export function checkDigitOf(payload: string): number {
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const digit = Number(payload[payload.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

/** True for a complete GTIN-8, -12, -13 or -14 whose last digit is the right check digit. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  return checkDigitOf(code.slice(0, -1)) === Number(code.at(-1));
}

/**
 * A line that is nothing but a product code: 8 to 14 digits, possibly split by spaces or sprinkled
 * with OCR noise at the ends. Returns the digits, or `undefined` when the line is something else.
 */
export function parseEanLine(text: string): string | undefined {
  const trimmed = text.replace(/^[^\dA-Za-z]+|[^\dA-Za-z]+$/g, '');
  if (!/^[\d ]+$/.test(trimmed)) return undefined;
  const digits = trimmed.replaceAll(' ', '');
  return digits.length >= 8 && digits.length <= 14 ? digits : undefined;
}
