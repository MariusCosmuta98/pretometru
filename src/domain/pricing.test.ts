import { describe, expect, it } from 'vitest';
import { unitPricing } from './pricing';

describe('unitPricing', () => {
  it('prices weighed items per kg: Kaufland pulpe 22,99 for 0,920 kg is 24,99 lei/kg', () => {
    expect(unitPricing({ lineTotalBani: 2299, qty: 0.92, qtyUnit: 'kg' })).toEqual({
      paidUnitBani: 2499,
      baseUnit: 'kg',
      pricePerBaseMilliBani: 2_498_913,
    });
  });

  it('prices toilet paper per roll: 8 rolls for 10,40 is 1,30 lei/roll', () => {
    expect(
      unitPricing({ lineTotalBani: 1040, qty: 1, qtyUnit: 'buc', pack: { qty: 8, unit: 'role' } }),
    ).toEqual({ paidUnitBani: 1040, baseUnit: 'role', pricePerBaseMilliBani: 130_000 });
  });

  it('keeps sub-ban precision for cheap pieces: 120 wet wipes for 3,98 is 3,317 bani each', () => {
    expect(
      unitPricing({ lineTotalBani: 398, qty: 1, qtyUnit: 'buc', pack: { qty: 120, unit: 'buc' } }),
    ).toEqual({ paidUnitBani: 398, baseUnit: 'buc', pricePerBaseMilliBani: 3317 });
  });

  it('divides the line total by quantity and by the content of each sold unit', () => {
    // 2 x 400 g for 5,98: 2,99 per pack, 7,475 lei per kg
    expect(
      unitPricing({ lineTotalBani: 598, qty: 2, qtyUnit: 'buc', pack: { qty: 400, unit: 'g' } }),
    ).toEqual({ paidUnitBani: 299, baseUnit: 'kg', pricePerBaseMilliBani: 747_500 });

    // 3 x 425 ml for 3,99: 1,33 per can, about 3,129 lei per litre
    expect(
      unitPricing({ lineTotalBani: 399, qty: 3, qtyUnit: 'buc', pack: { qty: 425, unit: 'ml' } }),
    ).toEqual({ paidUnitBani: 133, baseUnit: 'l', pricePerBaseMilliBani: 312_941 });
  });

  it('falls back to price per piece when the pack size is unknown', () => {
    expect(unitPricing({ lineTotalBani: 350, qty: 2, qtyUnit: 'buc' })).toEqual({
      paidUnitBani: 175,
      baseUnit: 'buc',
      pricePerBaseMilliBani: 175_000,
    });
  });

  it('ignores a pack for items sold by weight or volume', () => {
    const withPack = unitPricing({
      lineTotalBani: 1000,
      qty: 0.5,
      qtyUnit: 'kg',
      pack: { qty: 200, unit: 'g' },
    });
    const without = unitPricing({ lineTotalBani: 1000, qty: 0.5, qtyUnit: 'kg' });
    expect(withPack).toEqual(without);
    expect(without).toEqual({
      paidUnitBani: 2000,
      baseUnit: 'kg',
      pricePerBaseMilliBani: 2_000_000,
    });
  });

  it('rounds the paid unit price half away from zero', () => {
    expect(unitPricing({ lineTotalBani: 1000, qty: 3, qtyUnit: 'buc' }).paidUnitBani).toBe(333);
    expect(unitPricing({ lineTotalBani: 1001, qty: 2, qtyUnit: 'buc' }).paidUnitBani).toBe(501);
  });

  it('handles discount lines (negative totals) and free items', () => {
    expect(unitPricing({ lineTotalBani: -150, qty: 1, qtyUnit: 'buc' })).toEqual({
      paidUnitBani: -150,
      baseUnit: 'buc',
      pricePerBaseMilliBani: -150_000,
    });
    expect(unitPricing({ lineTotalBani: 0, qty: 1, qtyUnit: 'buc' }).paidUnitBani).toBe(0);
  });

  it.each([0, -1, Number.NaN])('rejects quantity %d', (qty) => {
    expect(() => unitPricing({ lineTotalBani: 100, qty, qtyUnit: 'buc' })).toThrow(RangeError);
  });

  it('rejects a pack with no content', () => {
    expect(() =>
      unitPricing({ lineTotalBani: 100, qty: 1, qtyUnit: 'buc', pack: { qty: 0, unit: 'g' } }),
    ).toThrow(RangeError);
  });
});
