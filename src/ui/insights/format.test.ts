import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatDay,
  formatFutureReceipts,
  formatMonth,
  formatPackPrice,
  formatPercent,
  formatSignedLei,
  formatUnitDelta,
  formatUnitPriceMove,
  lastDays,
} from './format';

describe('dates', () => {
  it('writes months and days the Romanian way', () => {
    expect(formatMonth('2026-11')).toBe('noiembrie 2026');
    expect(formatDay('2026-11-07')).toBe('07.11.2026');
    expect(formatDay('2026-11-07T18:31:47')).toBe('07.11.2026');
  });

  it('counts days the Romanian way, a single one included', () => {
    expect(lastDays(90)).toBe('ultimele 90 de zile');
    expect(lastDays(30)).toBe('ultimele 30 de zile');
    expect(lastDays(7)).toBe('ultimele 7 zile');
    expect(lastDays(1)).toBe('ultima zi');
  });

  it('says that receipts have a date in the future', () => {
    expect(formatFutureReceipts(1, ['2026-12'])).toBe('Un bon are data în viitor (decembrie 2026)');
    expect(formatFutureReceipts(2, ['2026-12', '2027-01'])).toBe(
      '2 bonuri au data în viitor (decembrie 2026, ianuarie 2027)',
    );
    expect(formatFutureReceipts(25, ['2026-12'])).toBe(
      '25 de bonuri au data în viitor (decembrie 2026)',
    );
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

  it('writes an amount that can be a deduction with the same minus', () => {
    expect(formatAmount(21_020)).toBe('210,20 lei');
    expect(formatAmount(-150)).toBe('\u22121,50 lei');
    expect(formatAmount(0)).toBe('0,00 lei');
  });
});

describe('unit prices', () => {
  it('shows both ends of a move with the precision a cheap piece needs', () => {
    expect(formatUnitPriceMove(145_000, 160_000, 'role')).toBe('1,45 → 1,60 lei/rolă');
    expect(formatUnitPriceMove(30_000, 31_500, 'l')).toBe('0,300 → 0,315 lei/l');
    expect(formatUnitPriceMove(3317, 3400, 'buc')).toBe('0,0332 → 0,0340 lei/buc');
    expect(formatUnitDelta(15_000, 160_000, 'role')).toBe('+0,15 lei/rolă');
    expect(formatUnitDelta(-1500, 31_500, 'l')).toBe('\u22120,015 lei/l');
  });

  it('shows the shelf price of a pack only where the unit price is hard to picture', () => {
    const wipes = { unit: 'buc', paidUnitBani: 699, pack: { qty: 120, unit: 'buc' } } as const;
    expect(formatPackPrice(wipes)).toBe('6,99 lei / 120 buc');
    expect(formatPackPrice({ ...wipes, unit: 'kg' })).toBeUndefined(); // weighed
    expect(formatPackPrice({ unit: 'buc', paidUnitBani: 599 })).toBeUndefined(); // no pack
    expect(formatPackPrice({ ...wipes, pack: { qty: 1, unit: 'l' } })).toBeUndefined(); // one base unit
  });
});
