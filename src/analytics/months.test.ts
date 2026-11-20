import { describe, expect, it } from 'vitest';
import { currentMonth, isMonthKey, lastMonths, monthOf, monthRange, shiftMonth } from './months';

describe('monthOf', () => {
  it('is the month of the printed date, with or without a time', () => {
    expect(monthOf('2026-11-07T18:31:47')).toBe('2026-11');
    expect(monthOf('2026-11-07T18:31')).toBe('2026-11');
    expect(monthOf('2026-12-01')).toBe('2026-12');
  });

  it('does not move a receipt across a month end: the printed time is already local', () => {
    expect(monthOf('2026-10-31T23:59:59')).toBe('2026-10');
    expect(monthOf('2026-11-01T00:00')).toBe('2026-11');
  });

  it('has no month for a missing or invalid date', () => {
    expect(monthOf(undefined)).toBeUndefined();
    expect(monthOf('2026-02-30')).toBeUndefined();
    expect(monthOf('07.11.2026')).toBeUndefined();
  });
});

describe('currentMonth', () => {
  it.each([
    // Bucharest is UTC+2 in winter and UTC+3 in summer: the new month starts before it does in UTC.
    ['2026-11-30T21:59:59Z', '2026-11'],
    ['2026-11-30T22:00:00Z', '2026-12'],
    ['2026-06-30T20:59:59Z', '2026-06'],
    ['2026-06-30T21:00:00Z', '2026-07'],
    ['2026-12-31T22:30:00Z', '2027-01'],
  ])('%s is %s in Europe/Bucharest', (instant, month) => {
    expect(currentMonth(new Date(instant))).toBe(month);
  });
});

describe('shiftMonth and monthRange', () => {
  it('counts across the year end in both directions', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-11', -13)).toBe('2025-10');
    expect(shiftMonth('2026-11', 0)).toBe('2026-11');
  });

  it('refuses what is not a month, or leaves the years that exist', () => {
    expect(() => shiftMonth('2026-13', 1)).toThrow(RangeError);
    expect(() => shiftMonth('2026-1', 1)).toThrow(RangeError);
    expect(() => shiftMonth('0000-01', -1)).toThrow(RangeError);
    expect(() => shiftMonth('9999-12', 1)).toThrow(RangeError);
  });

  it('lists every month of a range, both ends included', () => {
    expect(monthRange('2026-10', '2027-01')).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(monthRange('2026-11', '2026-11')).toEqual(['2026-11']);
    expect(monthRange('2026-11', '2026-10')).toEqual([]);
  });

  it('validates month keys', () => {
    expect(isMonthKey('2026-11')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-11-07')).toBe(false);
  });
});

describe('lastMonths', () => {
  const now = new Date('2026-11-20T12:00:00Z');

  it('ends with the current month', () => {
    expect(lastMonths(now, 1)).toEqual({ from: '2026-11', to: '2026-11' });
    expect(lastMonths(now, 3)).toEqual({ from: '2026-09', to: '2026-11' });
    expect(lastMonths(now, 12)).toEqual({ from: '2025-12', to: '2026-11' });
  });

  it('follows the Bucharest calendar, not UTC', () => {
    expect(lastMonths(new Date('2026-11-30T22:30:00Z'), 2)).toEqual({
      from: '2026-11',
      to: '2026-12',
    });
  });

  it('needs at least one month', () => {
    expect(() => lastMonths(now, 0)).toThrow(RangeError);
    expect(() => lastMonths(now, 1.5)).toThrow(RangeError);
  });
});
