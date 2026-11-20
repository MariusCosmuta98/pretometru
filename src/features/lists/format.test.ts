import { describe, expect, it } from 'vitest';
import {
  formatDay,
  formatPackPrice,
  formatDays,
  formatItems,
  formatQuantity,
  formatUnitPrice,
  parseQuantityInput,
} from './format';

describe('formatCount', () => {
  it('uses the singular for one and puts "de" before the noun from 20 on', () => {
    expect([0, 1, 2, 19, 20, 21, 90, 100, 101, 119, 120].map(formatItems)).toEqual([
      '0 articole',
      '1 articol',
      '2 articole',
      '19 articole',
      '20 de articole',
      '21 de articole',
      '90 de articole',
      '100 de articole',
      '101 articole',
      '119 articole',
      '120 de articole',
    ]);
    expect([1, 10, 30, 90].map(formatDays)).toEqual([
      '1 zi',
      '10 zile',
      '30 de zile',
      '90 de zile',
    ]);
  });
});

describe('formatQuantity', () => {
  it('shows what was typed: a number, a unit, or both; a unit alone means one', () => {
    expect(formatQuantity(2, 'buc')).toBe('2 buc');
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
    expect(formatQuantity(3, undefined)).toBe('3');
    expect(formatQuantity(undefined, 'l')).toBe('1 l');
    expect(formatQuantity(undefined, undefined)).toBeUndefined();
  });
});

describe('parseQuantityInput', () => {
  it('reads a positive number with up to 3 decimals, with a comma or a point', () => {
    expect(parseQuantityInput('2')).toBe(2);
    expect(parseQuantityInput(' 1,5 ')).toBe(1.5);
    expect(parseQuantityInput('0.250')).toBe(0.25);
  });

  it('takes empty text as "no quantity" and everything else that is not a quantity as invalid', () => {
    expect(parseQuantityInput('')).toBeUndefined();
    expect(parseQuantityInput('   ')).toBeUndefined();
    for (const text of ['0', '0,000', '-1', '1,2345', 'doi', '1,5 kg', '1.000.000', '1000001']) {
      expect(parseQuantityInput(text)).toBeNull();
    }
  });
});

describe('prices and dates', () => {
  it('writes a unit price with the precision the price needs, per unit of its base', () => {
    expect(formatUnitPrice(130_250, 'role')).toBe('1,30 lei/rolă');
    expect(formatUnitPrice(33_167, 'buc')).toBe('0,332 lei/buc');
    expect(formatUnitPrice(3317, 'buc')).toBe('0,0332 lei/buc'); // a wet wipe: 6,99 lei for 120
    expect(formatUnitPrice(2_498_913, 'kg')).toBe('24,99 lei/kg');
  });

  it('adds the shelf price of a pack when the unit price alone is hard to picture', () => {
    const wipes = { unit: 'buc', paidUnitBani: 398, pack: { qty: 120, unit: 'buc' } } as const;
    expect(formatPackPrice(wipes)).toBe('3,98 lei / 120 buc');
    expect(formatPackPrice({ ...wipes, pack: { qty: 1.5, unit: 'l' } })).toBe('3,98 lei / 1,5 l');
    expect(formatPackPrice({ ...wipes, pack: { qty: 1, unit: 'l' } })).toBeUndefined(); // = the unit price
    expect(formatPackPrice({ unit: 'kg', paidUnitBani: 2499 })).toBeUndefined();
    expect(formatPackPrice({ unit: 'buc', paidUnitBani: 599 })).toBeUndefined();
  });

  it('writes a day the Romanian way', () => {
    expect(formatDay('2026-08-12')).toBe('12.08.2026');
  });
});
