import { describe, expect, it } from 'vitest';
import {
  dateKey,
  isFutureDate,
  isValidPurchasedAt,
  parsePurchasedAt,
  shiftDateKey,
  todayKey,
} from './dates';

describe('isValidPurchasedAt', () => {
  it.each([
    '2026-11-07',
    '2026-11-07T14:32',
    '2026-11-07T14:32:09',
    '2024-02-29',
    '2026-12-31T23:59:59',
  ])('accepts %s', (text) => {
    expect(isValidPurchasedAt(text)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['not a leap year', '2026-02-29'],
    ['month 13', '2026-13-01'],
    ['month 0', '2026-00-10'],
    ['day 31 in a 30-day month', '2026-11-31'],
    ['hour 24', '2026-11-07T24:00'],
    ['minute 60', '2026-11-07T14:60'],
    ['second 60', '2026-11-07T14:32:60'],
    ['space instead of T', '2026-11-07 14:32'],
    ['printed Romanian format', '07.11.2026'],
    ['zone suffix (local time is implied)', '2026-11-07T14:32Z'],
  ])('rejects %s', (_label, text) => {
    expect(isValidPurchasedAt(text)).toBe(false);
  });
});

describe('parsePurchasedAt / dateKey', () => {
  it('splits date and time', () => {
    expect(parsePurchasedAt('2026-11-07T14:32')).toEqual({ date: '2026-11-07', time: '14:32:00' });
    expect(parsePurchasedAt('2026-11-07')).toEqual({ date: '2026-11-07' });
    expect(parsePurchasedAt('nope')).toBeUndefined();
  });

  it('reduces a purchase time to its calendar day', () => {
    expect(dateKey('2026-11-07T14:32')).toBe('2026-11-07');
    expect(dateKey('2026-11-07')).toBe('2026-11-07');
  });
});

describe('todayKey', () => {
  it.each([
    ['2026-11-19T10:00:00Z', '2026-11-19'],
    ['2026-11-19T22:30:00Z', '2026-11-20'], // 00:30 in Bucharest (EET, UTC+2)
    ['2026-07-01T20:59:00Z', '2026-07-01'], // 23:59 in Bucharest (EEST, UTC+3)
    ['2026-07-01T21:30:00Z', '2026-07-02'], // 00:30 in Bucharest
  ])('is the Bucharest calendar day of %s: %s', (instant, expected) => {
    expect(todayKey(new Date(instant))).toBe(expected);
  });

  it('can use another time zone', () => {
    expect(todayKey(new Date('2026-11-19T22:30:00Z'), 'UTC')).toBe('2026-11-19');
  });
});

describe('shiftDateKey', () => {
  it.each([
    ['2026-03-01', -1, '2026-02-28'],
    ['2024-03-01', -1, '2024-02-29'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2026-11-20', -90, '2026-08-22'],
    ['2026-11-20', 0, '2026-11-20'],
  ])('%s shifted by %i days is %s', (key, days, expected) => {
    expect(shiftDateKey(key, days)).toBe(expected);
  });

  it('refuses an invalid day key', () => {
    expect(() => shiftDateKey('2026-02-30', 1)).toThrow(RangeError);
  });
});

describe('isFutureDate (injectable now)', () => {
  const now = new Date('2026-11-19T20:00:00Z'); // 22:00 in Bucharest

  it('flags a date after today (the Lidl sample is printed 2026-12-29)', () => {
    expect(isFutureDate('2026-12-29', now)).toBe(true);
  });

  it('does not flag today or the past', () => {
    expect(isFutureDate('2026-11-19', now)).toBe(false);
    expect(isFutureDate('2026-11-07', now)).toBe(false);
  });

  it('compares the time of day when the receipt has one', () => {
    expect(isFutureDate('2026-11-19T23:59', now)).toBe(true);
    expect(isFutureDate('2026-11-19T21:00', now)).toBe(false);
  });

  it('uses the Bucharest day, not the UTC day', () => {
    const justAfterMidnight = new Date('2026-11-19T22:30:00Z'); // already 2026-11-20 in Bucharest
    expect(isFutureDate('2026-11-20', justAfterMidnight)).toBe(false);
    expect(isFutureDate('2026-11-21', justAfterMidnight)).toBe(true);
  });

  it('does not judge text that is not a purchase date', () => {
    expect(isFutureDate('garbage', now)).toBe(false);
  });

  it('stops flagging the Lidl date once the clock passes it', () => {
    expect(isFutureDate('2026-12-29', new Date('2027-01-05T09:00:00Z'))).toBe(false);
  });
});
