import { describe, expect, it } from 'vitest';
import { summarizeProduct, type PriceOptions } from '@/analytics';
import { observation, paid } from '@/analytics/testing';
import { makeProduct } from '@/domain/testing';
import { estimateCost, hasStore, quoteItem } from './pricing';

const now = new Date('2026-11-20T12:00:00Z');
const paper = makeProduct({ id: 'product-1', name: 'Hârtie igienică', baseUnit: 'role' });

const summarize = (
  purchases: Parameters<typeof summarizeProduct>[1],
  options: Partial<PriceOptions> = {},
) => summarizeProduct(paper, purchases, { now, ...options });

describe('estimateCost', () => {
  const pack = { unit: 'buc', paidUnitBani: 1042, pricePerBaseMilliBani: 130_250 } as const;
  const weighed = { unit: 'kg', paidUnitBani: 2499, pricePerBaseMilliBani: 2_498_913 } as const;

  it('multiplies counted pieces by what one piece cost: the pack as the store sells it', () => {
    expect(estimateCost({ qty: 2, unit: 'buc' }, pack, 'role')).toBe(2084);
    expect(estimateCost({ qty: 0.5, unit: 'buc' }, pack, 'role')).toBe(521);
  });

  it('counts one unit in the unit of the price when there is no quantity or no unit', () => {
    expect(estimateCost({}, pack, 'role')).toBe(1042);
    expect(estimateCost({ qty: 3 }, pack, 'role')).toBe(3126);
    expect(estimateCost({}, weighed, 'kg')).toBe(2499); // 1 kg: 24,99 lei
    expect(estimateCost({ qty: 2 }, weighed, 'kg')).toBe(4998);
  });

  it('prices a weight or a volume per base unit, whatever size the purchase was', () => {
    expect(estimateCost({ qty: 0.5, unit: 'kg' }, weighed, 'kg')).toBe(1249); // from 2,498913 lei/kg, not the rounded 24,99
    expect(estimateCost({ qty: 0.4, unit: 'kg' }, pack, 'kg')).toBe(52); // a pack bought by the piece, compared per kg
    expect(estimateCost({ qty: 1.5, unit: 'l' }, pack, 'l')).toBe(195);
  });

  it('has no estimate when the unit does not fit the price', () => {
    expect(estimateCost({ qty: 1, unit: 'kg' }, pack, 'role')).toBeUndefined(); // kg of something priced per roll
    expect(estimateCost({ qty: 1, unit: 'l' }, weighed, 'kg')).toBeUndefined();
    expect(estimateCost({ qty: 3, unit: 'buc' }, weighed, 'kg')).toBeUndefined(); // pieces of something weighed
  });
});

describe('quoteItem', () => {
  it('is unlinked without a product summary (free text, or a product that is gone)', () => {
    expect(quoteItem({}, undefined)).toEqual({ kind: 'unlinked' });
  });

  it('is never-bought for a product without a purchase', () => {
    expect(quoteItem({}, summarize([]))).toEqual({ kind: 'never-bought' });
  });

  it('names the cheapest store of the window, with its date, price and the estimated cost', () => {
    const metro = paid('metro', '2026-09-20', 130_250, { paidUnitBani: 1042 });
    const summary = summarize([
      paid('kaufland', '2026-11-07', 145_000),
      metro,
      paid('mega-image', '2026-11-03', 200_000),
    ]);

    const quote = quoteItem({ qty: 2, unit: 'buc' }, summary);
    expect(quote).toEqual({
      kind: 'cheapest',
      store: { id: 'store-metro', name: 'METRO', chain: 'metro' },
      price: metro,
      baseUnit: 'role',
      estimateBani: 2084,
    });
    expect(hasStore(quote)).toBe(true);
  });

  it('says only-at for a product bought at one store, at its last price', () => {
    const summary = summarize([
      paid('kaufland', '2026-10-01', 160_000),
      paid('kaufland', '2026-11-07', 145_000, { paidUnitBani: 1160 }),
    ]);

    expect(quoteItem({}, summary)).toMatchObject({
      kind: 'only-at',
      store: { name: 'Kaufland' },
      price: { date: '2026-11-07', pricePerBaseMilliBani: 145_000 },
      estimateBani: 1160,
    });
  });

  it('keeps only-at when the only purchase is older than the window or on sale: nothing to compare', () => {
    const old = summarize([paid('metro', '2026-05-01', 130_250)]);
    expect(quoteItem({}, old)).toMatchObject({ kind: 'only-at', store: { name: 'METRO' } });

    const sale = summarize([paid('metro', '2026-11-07', 130_250, { onSale: true })], {
      excludeSales: true,
    });
    expect(quoteItem({}, sale)).toMatchObject({ kind: 'only-at', price: { onSale: true } });
  });

  it('suggests no store when every purchase of a compared product is older than the window', () => {
    const last = paid('kaufland', '2026-06-01', 145_000);
    const summary = summarize([paid('metro', '2026-05-01', 130_250), last]);

    expect(quoteItem({}, summary)).toEqual({ kind: 'no-recent-price', last });
  });

  it('leaves sale prices out of the choice when asked: the regular price wins', () => {
    const purchases = [
      paid('metro', '2026-11-01', 130_250, { onSale: true, discountBani: 359 }),
      paid('kaufland', '2026-11-07', 145_000),
    ];

    expect(quoteItem({}, summarize(purchases))).toMatchObject({
      kind: 'cheapest',
      store: { name: 'METRO' },
      price: { onSale: true },
    });
    expect(quoteItem({}, summarize(purchases, { excludeSales: true }))).toMatchObject({
      kind: 'cheapest',
      store: { name: 'Kaufland' },
      price: { onSale: false },
    });
  });

  it('suggests no store when only sale prices exist at several stores and sales are left out', () => {
    const summary = summarize(
      [
        paid('metro', '2026-11-01', 130_250, { onSale: true }),
        paid('kaufland', '2026-11-07', 145_000, { onSale: true }),
      ],
      { excludeSales: true },
    );

    expect(quoteItem({}, summary)).toMatchObject({ kind: 'no-recent-price' });
  });

  it('is incomparable when the purchases have no size to compare', () => {
    const summary = summarize([observation({ baseUnit: 'buc', pricePerBaseMilliBani: 1_160_000 })]);
    expect(quoteItem({}, summary)).toEqual({ kind: 'incomparable' });
  });

  it('keeps the store but no estimate when the unit does not fit the price', () => {
    const quote = quoteItem(
      { qty: 2, unit: 'kg' },
      summarize([paid('metro', '2026-11-07', 130_250)]),
    );
    expect(quote).toMatchObject({ kind: 'only-at', store: { name: 'METRO' } });
    expect(quote).not.toHaveProperty('estimateBani');
  });
});
