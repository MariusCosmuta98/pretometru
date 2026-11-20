/**
 * Money is an integer number of bani (1 RON = 100 bani), VAT-inclusive unless a name says otherwise.
 * Never use floats for money. Functions here throw RangeError on non-integers, since that is a
 * programming error, but `parseBani` (text from receipts) returns `undefined` on bad input.
 */
export type Bani = number;

export function isBani(value: unknown): value is Bani {
  return Number.isSafeInteger(value);
}

function assertInteger(value: number, what: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${what} must be a safe integer, got ${value}`);
  }
}

const MINUS = '[-\\u2212\\u2013]';
const AMOUNT = new RegExp(
  `^(${MINUS})?\\s*(\\d{1,3}(?:[. \\u00a0\\u202f]\\d{3})+|\\d+)[.,](\\d{2})(${MINUS})?$`,
);

/**
 * Parses a printed amount such as `22,99`, `1.234,56`, `1 234,56`, `22.99`, `-20,00` or the
 * METRO-style trailing minus `2,49-`. Requires exactly two decimals, so quantities like `0,920`
 * and amounts whose decimals were lost are rejected rather than guessed.
 */
export function parseBani(text: string): Bani | undefined {
  const match = AMOUNT.exec(text.trim());
  if (!match) return undefined;
  const [, leadingSign, integerPart, fraction, trailingSign] = match;
  if (leadingSign && trailingSign) return undefined;

  const bani =
    Number((integerPart ?? '').replace(/[. \u00a0\u202f]/g, '')) * 100 + Number(fraction);
  if (!Number.isSafeInteger(bani)) return undefined;
  return (leadingSign ?? trailingSign) && bani !== 0 ? -bani : bani;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatScaled(units: number, decimals: number): string {
  const power = 10 ** decimals;
  const abs = Math.abs(units);
  const fraction = abs % power;
  const whole = (abs - fraction) / power;
  const sign = units < 0 ? '-' : '';
  return `${sign}${groupThousands(String(whole))},${String(fraction).padStart(decimals, '0')}`;
}

/** `123456` -> `1.234,56` (Romanian grouping, no currency). */
export function formatBani(bani: Bani): string {
  assertInteger(bani, 'bani');
  return formatScaled(bani, 2);
}

/** `2299` -> `22,99 lei`. */
export function formatLei(bani: Bani): string {
  return `${formatBani(bani)} lei`;
}

/**
 * Formats milli-bani (1/1000 ban, the precision of derived unit prices) as lei with 2 to 5
 * decimals: `formatMilliBani(3317, 3)` -> `0,033`.
 */
export function formatMilliBani(milliBani: number, leiDecimals = 2): string {
  assertInteger(milliBani, 'milli-bani');
  if (!Number.isInteger(leiDecimals) || leiDecimals < 2 || leiDecimals > 5) {
    throw new RangeError(`leiDecimals must be between 2 and 5, got ${leiDecimals}`);
  }
  return formatScaled(roundDiv(milliBani, 10 ** (5 - leiDecimals)), leiDecimals);
}

/** `a * b / c` computed exactly, rounded half away from zero. */
export function mulDiv(a: number, b: number, c: number): number {
  assertInteger(a, 'a');
  assertInteger(b, 'b');
  assertInteger(c, 'c');
  if (c === 0) throw new RangeError('Division by zero');

  const numerator = BigInt(a) * BigInt(b);
  const denominator = BigInt(c);
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * n + d) / (2n * d);
  const result = negative ? -quotient : quotient;

  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Result is not a safe integer');
  }
  return Number(result);
}

export function roundDiv(n: number, d: number): number {
  return mulDiv(n, 1, d);
}

export function sumBani(values: readonly Bani[]): Bani {
  let total = 0;
  for (const value of values) {
    assertInteger(value, 'amount');
    total += value;
  }
  assertInteger(total, 'sum');
  return total;
}

// VAT rates are whole percentages (21, 11, 9, 5, 0).

export function netFromGross(grossBani: Bani, ratePercent: number): Bani {
  return mulDiv(grossBani, 100, 100 + ratePercent);
}

export function grossFromNet(netBani: Bani, ratePercent: number): Bani {
  return mulDiv(netBani, 100 + ratePercent, 100);
}

export function vatFromGross(grossBani: Bani, ratePercent: number): Bani {
  return grossBani - netFromGross(grossBani, ratePercent);
}
