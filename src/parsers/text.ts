import { BaniSchema, MAX_QTY, parseBani, parsePurchasedAt } from '@/domain';

/**
 * `parseBani` for the amounts the contract can hold (±10,000,000 RON): a larger one is a runaway
 * read (a lost decimal mark, a merged column), not data, so it counts as unreadable.
 */
export function parseAmount(text: string): number | undefined {
  const bani = parseBani(text);
  return bani !== undefined && BaniSchema.safeParse(bani).success ? bani : undefined;
}

/**
 * `0,920` or `0.920` -> `0.92`: a quantity with up to 3 decimals, positive and within the
 * contract's bound; `undefined` for anything else.
 */
export function parseQuantity(text: string): number | undefined {
  const match = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return undefined;
  const value = Number(`${match[1]}.${match[2] ?? '0'}`);
  return value > 0 && value <= MAX_QTY ? value : undefined;
}

/**
 * `07.11.26` (or `07.11.2026`, `07/11/26`, `7-11-2026`) plus an optional time -> `purchasedAt`
 * (`2026-11-07T18:31:47`). Two-digit years are 20xx. `undefined` unless it is a real calendar date.
 */
export function toPurchasedAt(
  date: { day: string; month: string; year: string },
  time?: { hour: string; minute: string; second?: string },
): string | undefined {
  const year = date.year.length === 2 ? `20${date.year}` : date.year;
  const base = `${year}-${date.month.padStart(2, '0')}-${date.day.padStart(2, '0')}`;
  const text = time
    ? `${base}T${time.hour.padStart(2, '0')}:${time.minute}${time.second ? `:${time.second}` : ''}`
    : base;
  return parsePurchasedAt(text) ? text : undefined;
}
