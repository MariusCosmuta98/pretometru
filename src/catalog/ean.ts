/** Shortest code that can identify a product on its own (GTIN-8); shorter ones are truncated prints. */
const MIN_IDENTIFYING_LENGTH = 8;
/** A print that is all zeros (or nearly) is a placeholder, not a code. */
const MIN_SIGNIFICANT_DIGITS = 6;

/** GTIN-8/12/13/14 spellings of one code compare equal once their leading zeros are dropped. */
export function normalizeEan(ean: string): string {
  return ean.replace(/^0+/, '');
}

/**
 * A truncated print (receipts cut the code) can collide with another product's, so only codes of at
 * least 8 digits are trusted enough to assign a product without asking, and a placeholder such as
 * `0000000000000` never is.
 */
export function isIdentifyingEan(ean: string): boolean {
  return ean.length >= MIN_IDENTIFYING_LENGTH && normalizeEan(ean).length >= MIN_SIGNIFICANT_DIGITS;
}

/** GS1 check digit of the digits that precede it: weights 3, 1, 3, 1 ... counted from the right. */
export function checkDigit(body: string): number {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const digit = body.charCodeAt(body.length - 1 - i) - 48;
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

function hasValidCheckDigit(code: string): boolean {
  return checkDigit(code.slice(0, -1)) === Number(code.slice(-1));
}

/**
 * The other spelling a code can be printed in. Mega Image prints the 12 digits of an EAN-13
 * without its check digit; METRO prints all 13. A valid EAN-13 is fixed by its first 12 digits,
 * so a 12-digit print joins the one 13-digit code that completes it, and a valid 13-digit code
 * joins its own 12-digit prefix. Used only when there is no exact match.
 */
export function joinKeys(ean: string): string[] {
  if (ean.length === 12) return [normalizeEan(`${ean}${checkDigit(ean)}`)];
  if (ean.length === 13 && hasValidCheckDigit(ean)) return [normalizeEan(ean.slice(0, 12))];
  return [];
}
