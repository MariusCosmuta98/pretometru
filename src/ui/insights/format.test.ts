import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatDay,
  formatMonth,
  formatMonthTitle,
  formatPercent,
  formatSignedLei,
  formatUnitDelta,
  formatUnitPrice,
  formatUnitPriceMove,
} from './format';

describe('dates', () => {
  it('writes months and days the Romanian way', () => {
    expect(formatMonth('2026-11')).toBe('noiembrie 2026');
    expect(formatMonthTitle('2026-03')).toBe('Martie 2026');
    expect(formatDay('2026-11-07')).toBe('07.11.2026');
    expect(formatDay('2026-11-07T18:31:47')).toBe('07.11.2026');
  });
});

describe('formatCount', () => {
  it.each([
    [0, '0 de bonuri'],
    [1, '1 bon'],
    [2, '2 bonuri'],
    [19, '19 bonuri'],
    [20, '20 de bonuri'],
    [21, '21 de bonuri'],
    [100, '100 de bonuri'],
    [101, '101 bonuri'],
    [119, '119 bonuri'],
    [120, '120 de bonuri'],
    [365, '365 de bonuri'],
  ])('%i -> %s', (count, text) => {
    expect(formatCount(count, 'bon', 'bonuri')).toBe(text);
  });

  it('counts days the same way', () => {
    expect(formatCount(90, 'zi', 'zile')).toBe('90 de zile');
    expect(formatCount(30, 'zi', 'zile')).toBe('30 de zile');
  });
});

describe('money and percentages', () => {
  it('signs a change with a typographic minus', () => {
    expect(formatSignedLei(2500)).toBe('+25,00 lei');
    expect(formatSignedLei(-10_876)).toBe('\u2212108,76 lei');
    expect(formatSignedLei(0)).toBe('0,00 lei');
    expect(formatPercent(7.5)).toBe('+7,5%');
    expect(formatPercent(-3.25)).toBe('\u22123,3%');
    expect(formatPercent(0)).toBe('0,0%');
  });

  it('shows a price per unit with the precision a cheap piece needs', () => {
    expect(formatUnitPrice(145_000, 'role')).toBe('1,45 lei/rolă');
    expect(formatUnitPrice(33_170, 'buc')).toBe('0,332 lei/buc');
    expect(formatUnitPrice(3317, 'buc')).toBe('0,0332 lei/buc');
    expect(formatUnitPriceMove(145_000, 160_000, 'role')).toBe('1,45 → 1,60 lei/rolă');
    expect(formatUnitPriceMove(30_000, 31_500, 'l')).toBe('0,300 → 0,315 lei/l');
    expect(formatUnitDelta(15_000, 160_000, 'role')).toBe('+0,15 lei/rolă');
    expect(formatUnitDelta(-1500, 31_500, 'l')).toBe('\u22120,015 lei/l');
  });
});
