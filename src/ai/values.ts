import { parsePurchasedAt } from '@/domain';
import { hasValidCheckDigit } from '@/parsers/plain-text/ean';

/*
 * Small converters from "whatever the model wrote" to the values of the contracts. The model is
 * never trusted: each one accepts only what is exactly representable, and answers `undefined` for
 * the rest (a missing value is flagged by the arithmetic checks; a wrong one that was accepted
 * would not be). Nothing here rounds, clamps or guesses.
 */

/** Same bound as `BaniSchema` (10,000,000 RON): beyond it a number is a runaway reading, not money. */
const MAX_BANI = 1_000_000_000;
const MAX_QTY = 1_000_000;
/** The leu in its present form dates from 2005; a receipt cannot be older or from the 22nd century. */
const MIN_YEAR = 2005;
const MAX_YEAR = 2100;

/** A JSON number as its shortest decimal text, or a string as written: both are checked as text, never as a float. */
function decimalText(value: unknown): string | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
  return typeof value === 'string' ? value.trim() : undefined;
}

/**
 * An amount in lei with at most two decimals (a number, or a string with a dot) as integer bani.
 * No exponent, no comma, no thousands separator, no more than two decimals, within +-10 million
 * RON: anything else is `undefined`.
 */
export function toBani(value: unknown): number | undefined {
  const text = decimalText(value);
  const match = text === undefined ? null : /^(-)?(\d{1,10})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return undefined;
  const bani = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (bani > MAX_BANI) return undefined;
  return match[1] && bani !== 0 ? -bani : bani;
}

/** A positive quantity with at most three decimals (`0.92` kg), up to a million. */
export function toQuantity(value: unknown): number | undefined {
  const text = decimalText(value);
  const match = text === undefined ? null : /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(text);
  if (!match) return undefined;
  const quantity = Number(text);
  return quantity > 0 && quantity <= MAX_QTY ? quantity : undefined;
}

/**
 * Text for a field: format characters (zero-width and bidirectional marks) are removed, control
 * characters and line breaks become spaces, runs of spaces collapse, the result is trimmed and cut
 * at `max` characters. `undefined` when nothing is left.
 */
export function toText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value
    .normalize('NFC')
    .replace(/[\p{Cf}\p{Cs}\p{Co}]/gu, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const text = Array.from(cleaned).slice(0, max).join('').trim();
  return text === '' ? undefined : text;
}

/** One of `allowed`, case-insensitively, else `undefined`. */
export function toChoice<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== 'string') return undefined;
  const wanted = value.trim().toLowerCase();
  return allowed.find((choice) => choice.toLowerCase() === wanted);
}

/**
 * `YYYY-MM-DD`, optionally with `THH:mm[:ss]` (a space instead of the `T` is accepted), a real
 * calendar date between 2005 and 2100. A date in the future is kept: the review warns about it.
 */
export function toPurchasedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) (?=\d)/, '$1T');
  const moment = parsePurchasedAt(text);
  if (!moment) return undefined;
  const year = Number(moment.date.slice(0, 4));
  return year >= MIN_YEAR && year <= MAX_YEAR ? text : undefined;
}

export type EanReading =
  /** Nothing was printed (or a placeholder of zeros). */
  | { kind: 'none' }
  | { kind: 'ean'; ean: string }
  /** Something was given that cannot be a code, or a complete code whose check digit is wrong. */
  | { kind: 'rejected' };

/**
 * A barcode as printed: 4 to 14 digits. A complete GTIN-8, -13 or -14 must carry the right check
 * digit (a misread digit would otherwise map the line to the wrong product); a 12-digit print is
 * kept as it is, because Mega Image prints EAN-13 codes without their check digit; a shorter
 * print is a truncated code and stays truncated.
 */
export function toEan(value: unknown): EanReading {
  if (value === undefined || value === null || value === '') return { kind: 'none' };
  const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof text !== 'string') return { kind: 'rejected' };

  const digits = text.replace(/[\s-]/g, '');
  if (digits === '') return { kind: 'none' };
  if (!/^\d{4,14}$/.test(digits)) return { kind: 'rejected' };
  if (/^0+$/.test(digits)) return { kind: 'none' };
  if ([8, 13, 14].includes(digits.length) && !hasValidCheckDigit(digits)) {
    return { kind: 'rejected' };
  }
  return { kind: 'ean', ean: digits };
}
