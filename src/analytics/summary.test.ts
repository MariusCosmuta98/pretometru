import { describe, expect, it } from 'vitest';
import { makeProduct } from '@/domain/testing';
import { summarizeProduct } from './summary';
import { observation, paid } from './testing';

const now = new Date('2026-11-20T12:00:00Z');
const roll = makeProduct({ name: 'Hârtie igienică', baseUnit: 'role' });
const mine = (o: ReturnType<typeof paid>) => ({ ...o, productId: roll.id });

describe('summarizeProduct', () => {
  it('lays out the stores cheapest first with how much dearer the others are', () => {
    const summary = summarizeProduct(
      roll,
      [
        paid('kaufland', '2026-11-07', 145_000),
        paid('metro', '2026-11-01', 130_000),
        paid('mega-image', '2026-11-03', 200_000),
      ].map(mine),
      { now },
    );

    expect(summary.stores.map((s) => [s.storeName, s.overCheapestPct])).toEqual([
      ['METRO', 0],
      ['Kaufland', 11.5],
      ['Mega Image', 53.8],
    ]);
    expect(summary.cheapest?.storeName).toBe('METRO');
    expect(summary.cheapest?.best.date).toBe('2026-11-01');
    expect(summary.last?.storeName).toBe('Kaufland'); // the latest purchase, whatever its price
    expect(summary.onlyAt).toBeUndefined();
    expect(summary.windowDays).toBe(90);
  });

  it('says "only at X" for a product bought at one store, however often', () => {
    const summary = summarizeProduct(
      roll,
      [paid('kaufland', '2026-10-01', 150_000), paid('kaufland', '2026-11-07', 145_000)].map(mine),
      { now },
    );
    expect(summary.onlyAt).toEqual({
      storeId: 'store-kaufland',
      storeName: 'Kaufland',
      chain: 'kaufland',
    });
    expect(summary.stores).toHaveLength(1);
  });

  it('judges "only at" over the whole history, not just the window', () => {
    const summary = summarizeProduct(
      roll,
      [paid('metro', '2026-05-01', 130_000), paid('kaufland', '2026-11-07', 145_000)].map(mine),
      { now },
    );
    expect(summary.onlyAt).toBeUndefined();
  });

  it('lists a store last used before the window after the others, with its latest price', () => {
    const summary = summarizeProduct(
      roll,
      [paid('metro', '2026-08-12', 130_000), paid('kaufland', '2026-11-07', 145_000)].map(mine),
      { now },
    );

    expect(
      summary.stores.map((s) => [s.storeName, s.best?.pricePerBaseMilliBani, s.count]),
    ).toEqual([
      ['Kaufland', 145_000, 1],
      ['METRO', undefined, 0], // 100 days ago: shown for reference, not compared
    ]);
    expect(summary.stores[1]!.latest.pricePerBaseMilliBani).toBe(130_000);
    expect(summary.cheapest?.storeName).toBe('Kaufland');
  });

  it('keeps sale prices in the history but can leave them out of the comparison', () => {
    const purchases = [
      paid('metro', '2026-10-01', 150_000),
      paid('metro', '2026-11-01', 130_000, { onSale: true, discountBani: 200 }),
      paid('kaufland', '2026-11-07', 145_000),
    ].map(mine);

    const all = summarizeProduct(roll, purchases, { now });
    expect(all.cheapest?.storeName).toBe('METRO');
    expect(all.cheapest?.best.onSale).toBe(true);

    const regular = summarizeProduct(roll, purchases, { now, excludeSales: true });
    expect(regular.cheapest?.storeName).toBe('Kaufland');
    expect(regular.stores.find((s) => s.storeName === 'METRO')?.best?.pricePerBaseMilliBani).toBe(
      150_000,
    );
    expect(regular.observations).toHaveLength(3); // the sale purchase is still in the history
    expect(regular.observations.some((o) => o.onSale)).toBe(true);
  });

  it('sets purchases in another base unit aside instead of comparing them', () => {
    const unsized = observation({
      productId: roll.id,
      baseUnit: 'buc',
      pricePerBaseMilliBani: 1_600_000,
    });
    const summary = summarizeProduct(roll, [mine(paid('metro', '2026-11-01', 130_000)), unsized], {
      now,
    });
    expect(summary.observations).toHaveLength(1);
    expect(summary.incomparable).toEqual([unsized]);
  });

  it('only takes the purchases of its own product', () => {
    const other = observation({ productId: 'something-else' });
    expect(summarizeProduct(roll, [other], { now }).observations).toEqual([]);
  });

  it('reports the price trend at the latest store', () => {
    const summary = summarizeProduct(
      roll,
      [paid('kaufland', '2026-10-01', 200_000), paid('kaufland', '2026-11-07', 215_000)].map(mine),
      { now },
    );
    expect(summary.change).toMatchObject({ pct: 7.5, direction: 'up' });
  });

  it('is empty, not broken, for a product never bought', () => {
    const summary = summarizeProduct(roll, [], { now });
    expect(summary).toMatchObject({ observations: [], incomparable: [], stores: [] });
    expect(summary.last).toBeUndefined();
    expect(summary.cheapest).toBeUndefined();
    expect(summary.onlyAt).toBeUndefined();
    expect(summary.change).toBeUndefined();
  });
});
