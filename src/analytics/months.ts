import { parsePurchasedAt, todayKey } from '@/domain';

/**
 * A calendar month as `YYYY-MM`. Receipts are dated in Europe/Bucharest local time (contracts.md),
 * so the month of a receipt is simply the month of its printed date; only "now" needs a time zone.
 */
export type MonthKey = string;

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
const LAST_INDEX = 9999 * 12 + 11;

export function isMonthKey(text: string): boolean {
  return MONTH_KEY.test(text);
}

function monthIndex(month: MonthKey): number {
  const match = MONTH_KEY.exec(month);
  if (!match) throw new RangeError(`Invalid month: ${month}`);
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function monthAt(index: number): MonthKey {
  if (!Number.isSafeInteger(index) || index < 0 || index > LAST_INDEX) {
    throw new RangeError(`Month out of range: ${index}`);
  }
  const year = String(Math.floor(index / 12)).padStart(4, '0');
  return `${year}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** `2026-11-07T18:31` -> `2026-11`; `undefined` for a missing or invalid date. */
export function monthOf(purchasedAt: string | undefined): MonthKey | undefined {
  const moment = purchasedAt === undefined ? undefined : parsePurchasedAt(purchasedAt);
  return moment?.date.slice(0, 7);
}

/** The month it is now in Europe/Bucharest: a few hours after midnight UTC it is already the next one. */
export function currentMonth(now: Date): MonthKey {
  return todayKey(now).slice(0, 7);
}

/** `shiftMonth('2026-01', -1)` -> `'2025-12'`. */
export function shiftMonth(month: MonthKey, delta: number): MonthKey {
  return monthAt(monthIndex(month) + delta);
}

/** The `count` months up to and including the current one: `{ from, to }`, both inclusive. */
export function lastMonths(now: Date, count: number): { from: MonthKey; to: MonthKey } {
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError(`count must be a positive integer, got ${count}`);
  }
  const to = currentMonth(now);
  return { from: shiftMonth(to, 1 - count), to };
}

/** Every month from `from` to `to`, inclusive, oldest first; empty when `from` is after `to`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const first = monthIndex(from);
  const last = monthIndex(to);
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, offset) =>
    monthAt(first + offset),
  );
}
