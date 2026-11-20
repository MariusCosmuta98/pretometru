import { describe, expect, it } from 'vitest';
import { observation } from '@/analytics/testing';
import {
  formatDay,
  formatPack,
  formatPackPrice,
  formatPercent,
  formatQuantity,
  formatUnitPrice,
  formatVersusLast,
  paidEach,
} from './format';

describe('formatUnitPrice', () => {
  it('uses two decimals from one leu and shows more for cheap pieces', () => {
    expect(formatUnitPrice(130_250, 'role')).toBe('1,30 lei/rolă');
    expect(formatUnitPrice(2_498_913, 'kg')).toBe('24,99 lei/kg');
    expect(formatUnitPrice(3317, 'buc')).toBe('0,0332 lei/buc');
    expect(formatUnitPrice(33_167, 'buc')).toBe('0,332 lei/buc');
  });
});

describe('formatPackPrice and paidEach', () => {
  const wipes = observation({ unit: 'buc', paidUnitBani: 699, pack: { qty: 120, unit: 'buc' } });

  it('shows the shelf price of a pack when the unit price alone is hard to picture', () => {
    expect(formatPackPrice(wipes)).toBe('6,99 lei / 120 buc');
    expect(formatPackPrice({ ...wipes, paidUnitBani: 615, pack: { qty: 400, unit: 'g' } })).toBe(
      '6,15 lei / 400 g',
    );
  });

  it('says nothing for a weighed line, an unsized one, or a pack that is one base unit', () => {
    expect(formatPackPrice({ ...wipes, unit: 'kg' })).toBeUndefined();
    expect(formatPackPrice({ ...wipes, pack: undefined })).toBeUndefined();
    expect(formatPackPrice({ ...wipes, pack: { qty: 1, unit: 'l' } })).toBeUndefined();
    expect(formatPackPrice({ ...wipes, pack: { qty: 1000, unit: 'g' } })).toBeUndefined();
  });

  it('writes what one sold unit cost the way the receipt prints it', () => {
    expect(paidEach(wipes)).toBe('6,99 lei');
    expect(paidEach({ ...wipes, unit: 'kg', paidUnitBani: 2499 })).toBe('24,99 lei/kg');
  });
});

describe('formatDay', () => {
  it('writes the day the Romanian way', () => {
    expect(formatDay('2026-11-07')).toBe('07.11.2026');
  });
});

describe('formatPercent', () => {
  it('signs the change and uses a decimal comma', () => {
    expect(formatPercent(7.5)).toBe('+7,5%');
    expect(formatPercent(-3.25)).toBe('−3,3%');
    expect(formatPercent(0)).toBe('0,0%');
    expect(formatPercent(75.6)).toBe('+75,6%');
  });
});

describe('formatVersusLast', () => {
  it('says how the best price compares with the last one, and nothing when they are equal', () => {
    expect(formatVersusLast(-10.3)).toBe('cu 10,3% mai ieftin decât ultimul preț');
    expect(formatVersusLast(4)).toBe('cu 4,0% mai scump decât ultimul preț');
    expect(formatVersusLast(0)).toBeUndefined();
  });
});

describe('pack and quantity labels', () => {
  it('use a decimal comma', () => {
    expect(formatPack({ qty: 8, unit: 'role' })).toBe('8 role');
    expect(formatPack({ qty: 1.5, unit: 'l' })).toBe('1,5 l');
    expect(formatQuantity(0.92, 'kg')).toBe('0,92 kg');
    expect(formatQuantity(3, 'buc')).toBe('3 buc');
  });
});
