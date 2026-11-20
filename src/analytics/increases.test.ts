import { describe, expect, it } from 'vitest';
import { createProduct } from '@/catalog';
import { SEED_CATEGORIES } from '@/domain';
import { makeProduct } from '@/domain/testing';
import { ensureSeed, setSetting } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { loadPriceIncreases, priceIncreases } from './increases';
import { savePurchase } from './spending-testing';
import { observation, paid } from './testing';

const now = new Date('2026-11-20T12:00:00Z');
const paper = makeProduct({ id: 'product-1', name: 'Hârtie igienică', baseUnit: 'role' });
const milk = makeProduct({ id: 'product-2', name: 'Lapte UHT', baseUnit: 'l' });

function group(...purchases: ReturnType<typeof paid>[]) {
  const byProduct = new Map<string, ReturnType<typeof paid>[]>();
  for (const purchase of purchases) {
    byProduct.set(purchase.productId, [...(byProduct.get(purchase.productId) ?? []), purchase]);
  }
  return byProduct;
}

describe('priceIncreases', () => {
  it('finds a product that got dearer at the store it was bought at, with the size of the move', () => {
    const found = priceIncreases(
      [paper],
      group(paid('kaufland', '2026-10-01', 145_000), paid('kaufland', '2026-11-07', 160_000)),
      { now, days: 90 },
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      product: { name: 'Hârtie igienică' },
      baseUnit: 'role',
      change: { deltaMilliBani: 15_000, pct: 10.3, direction: 'up' },
    });
    expect(found[0]?.change.from.date).toBe('2026-10-01');
    expect(found[0]?.change.to.storeName).toBe('Kaufland');
  });

  it('is silent about falls, unchanged prices, single purchases and noise under half a percent', () => {
    const found = priceIncreases(
      [paper, milk],
      group(
        paid('kaufland', '2026-10-01', 160_000),
        paid('kaufland', '2026-11-07', 145_000), // cheaper now
        paid('metro', '2026-10-01', 130_000),
        paid('metro', '2026-11-07', 130_000), // the same
        paid('mega-image', '2026-11-07', 200_000), // once
        paid('kaufland', '2026-10-01', 100_000, { productId: 'product-2', baseUnit: 'l' }),
        paid('kaufland', '2026-11-07', 100_400, { productId: 'product-2', baseUnit: 'l' }), // +0,4 %
      ),
      { now, days: 90 },
    );

    expect(found).toEqual([]);
  });

  it('compares a store with itself: a dearer purchase elsewhere is no increase', () => {
    const found = priceIncreases(
      [paper],
      group(paid('kaufland', '2026-10-01', 145_000), paid('mega-image', '2026-11-07', 200_000)),
      { now, days: 90 },
    );

    expect(found).toEqual([]);
  });

  it('lists a product once per store where it got dearer', () => {
    const found = priceIncreases(
      [paper],
      group(
        paid('kaufland', '2026-10-01', 140_000),
        paid('kaufland', '2026-11-07', 150_000),
        paid('metro', '2026-10-05', 100_000),
        paid('metro', '2026-11-18', 120_000),
      ),
      { now, days: 90 },
    );

    expect(found.map((i) => [i.change.to.storeName, i.change.pct])).toEqual([
      ['METRO', 20],
      ['Kaufland', 7.1],
    ]);
  });

  it('only the latest move at a store counts: a rise that was followed by a fall is gone', () => {
    const found = priceIncreases(
      [paper],
      group(
        paid('kaufland', '2026-10-01', 100_000),
        paid('kaufland', '2026-10-20', 130_000),
        paid('kaufland', '2026-11-07', 120_000),
      ),
      { now, days: 90 },
    );

    expect(found).toEqual([]);
  });

  it('wants the increase to be seen inside the window; the earlier purchase may be older', () => {
    const purchases = group(
      paid('kaufland', '2026-01-10', 100_000),
      paid('kaufland', '2026-11-07', 120_000),
    );

    expect(priceIncreases([paper], purchases, { now, days: 90 })).toHaveLength(1);
    // 2026-11-07 is 13 days before the 20th; a window of 10 days no longer reaches it.
    expect(priceIncreases([paper], purchases, { now, days: 10 })).toEqual([]);
    expect(priceIncreases([paper], purchases, { now, days: 13 })).toHaveLength(1);
  });

  it('counts a future-dated purchase as the latest', () => {
    const found = priceIncreases(
      [paper],
      group(paid('kaufland', '2026-11-07', 100_000), paid('kaufland', '2026-12-29', 120_000)),
      { now, days: 30 },
    );

    expect(found).toHaveLength(1);
  });

  it('can leave sale prices out: a price that was only reduced and is back to normal is no increase', () => {
    const purchases = group(
      paid('kaufland', '2026-10-01', 130_000, { onSale: true, discountBani: 200 }),
      paid('kaufland', '2026-11-07', 160_000),
    );

    expect(priceIncreases([paper], purchases, { now, days: 90 })).toHaveLength(1);
    expect(priceIncreases([paper], purchases, { now, days: 90, excludeSales: true })).toEqual([]);
  });

  it('compares only prices in the product base unit', () => {
    const purchases = group(
      paid('kaufland', '2026-10-01', 145_000),
      observation({
        storeId: 'store-kaufland',
        date: '2026-11-07',
        purchasedAt: '2026-11-07T10:00',
        baseUnit: 'buc',
        pricePerBaseMilliBani: 999_000,
      }),
    );

    expect(priceIncreases([paper], purchases, { now, days: 90 })).toEqual([]);
  });

  it('puts the biggest relative increase first, then the biggest in money', () => {
    const found = priceIncreases(
      [paper, milk],
      group(
        paid('kaufland', '2026-10-01', 100_000),
        paid('kaufland', '2026-11-07', 110_000), // +10 %, 10 bani
        paid('kaufland', '2026-10-01', 1_000_000, { productId: 'product-2', baseUnit: 'l' }),
        paid('kaufland', '2026-11-07', 1_100_000, { productId: 'product-2', baseUnit: 'l' }), // +10 %, 100 bani
      ),
      { now, days: 90 },
    );

    expect(found.map((i) => i.product.name)).toEqual(['Lapte UHT', 'Hârtie igienică']);
  });
});

describe('loadPriceIncreases', () => {
  async function world() {
    const db = await createTestDb();
    await ensureSeed(db);
    const dairy = SEED_CATEGORIES[0]!.id;
    const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: dairy, baseUnit: 'l' });
    const butter = await createProduct(db, { name: 'Unt', categoryId: dairy, baseUnit: 'kg' });
    const line = (productId: string, lineTotalBani: number, unit: 'l' | 'g', qty: number) => ({
      rawName: 'ARTICOL',
      lineTotalBani,
      productId,
      pack: { qty, unit },
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-01T09:00',
      lines: [line(milk.id, 500, 'l', 1), line(butter.id, 1000, 'g', 200)],
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T09:00',
      lines: [line(milk.id, 600, 'l', 1), line(butter.id, 1100, 'g', 200)],
    });
    return { db };
  }

  it('lists the increases of the stored purchases, biggest first', async () => {
    const { db } = await world();

    const found = await loadPriceIncreases(db, { now });

    expect(found.map((i) => [i.product.name, i.change.pct])).toEqual([
      ['Lapte UHT', 20],
      ['Unt', 10],
    ]);
  });

  it('keeps to the most wanted ones with a limit', async () => {
    const { db } = await world();

    expect((await loadPriceIncreases(db, { now, limit: 1 })).map((i) => i.product.name)).toEqual([
      'Lapte UHT',
    ]);
  });

  it('takes the window and the sale filter from the settings', async () => {
    const { db } = await world();
    await setSetting(db, 'priceWindowDays', 10); // the later purchase is 13 days old

    expect(await loadPriceIncreases(db, { now })).toEqual([]);
    expect(await loadPriceIncreases(db, { now, days: 30 })).toHaveLength(2);
  });
});
