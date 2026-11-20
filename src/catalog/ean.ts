/** Shortest code that can identify a product on its own (GTIN-8); shorter ones are truncated prints. */
const MIN_IDENTIFYING_LENGTH = 8;

/** GTIN-8/12/13/14 spellings of one code compare equal once their leading zeros are dropped. */
export function normalizeEan(ean: string): string {
  return ean.replace(/^0+/, '');
}

/**
 * A truncated print (receipts cut the code) can collide with another product's, so only codes of at
 * least 8 digits are trusted enough to assign a product without asking.
 */
export function isIdentifyingEan(ean: string): boolean {
  return ean.length >= MIN_IDENTIFYING_LENGTH;
}
