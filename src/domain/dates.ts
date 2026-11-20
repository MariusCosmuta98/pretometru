import { z } from 'zod';

/** `purchasedAt`: ISO-8601 local time without zone (Europe/Bucharest implied) or a bare date. */
const PURCHASED_AT = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const DEFAULT_TIME_ZONE = 'Europe/Bucharest';

export interface PurchaseMoment {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm:ss`, absent for date-only receipts. */
  time?: string;
}

export function parsePurchasedAt(text: string): PurchaseMoment | undefined {
  const match = PURCHASED_AT.exec(text);
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second] = match;

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const calendar = new Date(Date.UTC(y, m - 1, d));
  const validDate =
    calendar.getUTCFullYear() === y &&
    calendar.getUTCMonth() === m - 1 &&
    calendar.getUTCDate() === d;
  if (!validDate) return undefined;

  const date = `${year}-${month}-${day}`;
  if (hour === undefined || minute === undefined) return { date };
  if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return undefined;
  return { date, time: `${hour}:${minute}:${second ?? '00'}` };
}

export function isValidPurchasedAt(text: string): boolean {
  return parsePurchasedAt(text) !== undefined;
}

export const PurchasedAtSchema = z
  .string()
  .refine(
    isValidPurchasedAt,
    'Invalid purchase date (expected YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss])',
  );

/** Calendar day (`YYYY-MM-DD`) of a purchase time. */
export function dateKey(purchasedAt: string): string {
  const moment = parsePurchasedAt(purchasedAt);
  if (!moment) throw new RangeError(`Invalid purchase date: ${purchasedAt}`);
  return moment.date;
}

function localParts(now: Date, timeZone: string): Required<PurchaseMoment> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}:${part('second')}`,
  };
}

/** The calendar day of `now` where the receipts are issued (default Europe/Bucharest). */
export function todayKey(now: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return localParts(now, timeZone).date;
}

/** `shiftDateKey('2026-11-20', -90)` -> `'2026-08-22'`. Pure calendar arithmetic, no time zones. */
export function shiftDateKey(key: string, days: number): string {
  const moment = parsePurchasedAt(key);
  if (!moment || key.length !== 10) throw new RangeError(`Invalid date key: ${key}`);
  const [year = 0, month = 1, day = 1] = moment.date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * True when the printed purchase time is after `now` (pass the clock in: the Lidl sample is dated
 * in the future). Date-only receipts are future only when the day is after today.
 */
export function isFutureDate(
  purchasedAt: string,
  now: Date,
  timeZone = DEFAULT_TIME_ZONE,
): boolean {
  const moment = parsePurchasedAt(purchasedAt);
  if (!moment) return false;
  const local = localParts(now, timeZone);
  if (moment.date !== local.date) return moment.date > local.date;
  return moment.time !== undefined && moment.time > local.time;
}
