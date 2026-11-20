import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { createProduct, mergeProducts } from '@/catalog';
import { saveTestReceipt } from '@/catalog/testing';
import { deleteReceipt, ensureSeed, saveReceipt, setSetting, softDelete } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { getProductSummary, listProductSummaries, loadObservations } from './queries';

const GROCERY = SEED_CATEGORIES[4]!.id;
const now = new Date('2026-11-20T12:00:00Z');

async function setup() {
  const db = await createTestDb();
  await ensureSeed(db);
  const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: GROCERY, baseUnit: 'l' });
  const bread = await createProduct(db, { name: 'Pâine', categoryId: GROCERY, baseUnit: 'buc' });
  return { db, milk, bread };
}

describe('loadObservations', () => {
  it('turns live product lines of confirmed receipts into observations, per product', async () => {
    const { db, milk, bread } = await setup();
    await saveTestReceipt(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T14:32',
      lines: [
        {
          rawName: 'LAPTE UHT 1L',
          lineTotalBani: 1198,
          qty: 2,
          productId: milk.id,
          pack: { qty: 1, unit: 'l' },
        },
        { rawName: 'PAINE', lineTotalBani: 350, productId: bread.id },
      ],
    });

    const byProduct = await loadObservations(db);

    expect([...byProduct.keys()].sort()).toEqual([milk.id, bread.id].sort());
    expect(byProduct.get(milk.id)).toEqual([
      expect.objectContaining({
        storeName: 'Kaufland',
        chain: 'kaufland',
        date: '2026-11-07',
        purchasedAt: '2026-11-07T14:32',
        rawName: 'LAPTE UHT 1L',
        baseUnit: 'l',
        pricePerBaseMilliBani: 599_000, // 11,98 lei for 2 x 1 l = 5,99 lei per litre
        paidUnitBani: 599,
        onSale: false,
        pack: { qty: 1, unit: 'l' },
      }),
    ]);
  });

  it('leaves out everything that is not a trustworthy price', async () => {
    const { db, milk } = await setup();
    const keep = { rawName: 'LAPTE', lineTotalBani: 600, productId: milk.id };
    await saveTestReceipt(db, { chain: 'kaufland', lines: [keep] });

    // each of these must stay out of the analysis
    await saveTestReceipt(db, { chain: 'lidl', status: 'draft', lines: [keep] });
    const removed = await saveTestReceipt(db, { chain: 'metro', lines: [keep] });
    await deleteReceipt(db, removed.receipt.id);
    await saveTestReceipt(db, {
      chain: 'mega-image',
      lines: [
        { ...keep, kind: 'deposit' },
        { ...keep, kind: 'discount', lineTotalBani: -100 },
        { rawName: 'FARA PRODUS', lineTotalBani: 600 },
        { ...keep, lineTotalBani: 0 },
      ],
    });
    const tombstoned = await saveTestReceipt(db, { chain: 'unknown', lines: [keep, keep] });
    await saveReceipt(db, { ...tombstoned.receipt, totalBani: 600 }, [
      { ...tombstoned.lines[0]!, id: tombstoned.lines[0]!.id },
    ]);

    const observations = (await loadObservations(db)).get(milk.id) ?? [];
    expect(observations.map((o) => o.storeName).sort()).toEqual(['Kaufland', 'Magazin']);
  });

  it('flags a discounted line as a sale price and keeps the price after the discount', async () => {
    const { db, bread } = await setup();
    await saveTestReceipt(db, {
      chain: 'metro',
      lines: [{ rawName: 'PAINE', lineTotalBani: 398, discountBani: 100, productId: bread.id }],
    });
    const [sale] = (await loadObservations(db)).get(bread.id) ?? [];
    expect(sale).toMatchObject({ onSale: true, discountBani: 100, lineTotalBani: 398 });
  });

  it('can be limited to some products and returns oldest first', async () => {
    const { db, milk, bread } = await setup();
    const line = (productId: string) => ({ rawName: 'X', lineTotalBani: 500, productId });
    await saveTestReceipt(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T10:00',
      lines: [line(milk.id)],
    });
    await saveTestReceipt(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-01',
      lines: [line(milk.id), line(bread.id)],
    });

    const only = await loadObservations(db, [milk.id]);
    expect([...only.keys()]).toEqual([milk.id]);
    expect(only.get(milk.id)?.map((o) => o.date)).toEqual(['2026-10-01', '2026-11-07']);
  });

  it('follows a merge: the purchases of the removed product count for the survivor', async () => {
    const { db, milk } = await setup();
    const duplicate = await createProduct(db, {
      name: 'Lapte',
      categoryId: GROCERY,
      baseUnit: 'l',
    });
    await saveTestReceipt(db, {
      chain: 'kaufland',
      lines: [{ rawName: 'LAPTE', lineTotalBani: 600, productId: duplicate.id }],
    });

    await mergeProducts(db, milk.id, [duplicate.id]);

    const byProduct = await loadObservations(db);
    expect(byProduct.has(duplicate.id)).toBe(false);
    expect(byProduct.get(milk.id)).toHaveLength(1);
  });
});

describe('getProductSummary and listProductSummaries', () => {
  it('uses the stored settings for the window and the sale filter unless told otherwise', async () => {
    const { db, milk } = await setup();
    const line = (total: number, extra = {}) => ({
      rawName: 'LAPTE',
      lineTotalBani: total,
      productId: milk.id,
      pack: { qty: 1, unit: 'l' as const },
      ...extra,
    });
    await saveTestReceipt(db, { chain: 'metro', purchasedAt: '2026-10-25', lines: [line(450)] });
    await saveTestReceipt(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-15',
      lines: [line(500, { discountBani: 100 })],
    });

    const byDefault = await getProductSummary(db, milk.id, { now });
    expect(byDefault?.windowDays).toBe(90);
    expect(byDefault?.cheapest?.storeName).toBe('METRO');

    await setSetting(db, 'priceWindowDays', 10);
    const narrow = await getProductSummary(db, milk.id, { now });
    expect(narrow?.windowDays).toBe(10);
    expect(narrow?.cheapest?.storeName).toBe('Kaufland'); // METRO's 26 days ago is out

    await setSetting(db, 'excludeDiscountedPrices', true);
    const regular = await getProductSummary(db, milk.id, { now, days: 90 });
    expect(regular?.cheapest?.storeName).toBe('METRO'); // Kaufland's price was a sale

    const explicit = await getProductSummary(db, milk.id, { now, days: 90, excludeSales: false });
    expect(explicit?.cheapest?.storeName).toBe('METRO');
  });

  it('answers undefined for an unknown or deleted product', async () => {
    const { db, milk } = await setup();
    expect(await getProductSummary(db, '0000000000000000000000000X', { now })).toBeUndefined();
    await softDelete(db.products, milk.id);
    expect(await getProductSummary(db, milk.id, { now })).toBeUndefined();
  });

  it('lists every live product, including the ones never bought', async () => {
    const { db, milk, bread } = await setup();
    await saveTestReceipt(db, {
      chain: 'kaufland',
      lines: [{ rawName: 'PAINE', lineTotalBani: 350, productId: bread.id }],
    });

    const summaries = await listProductSummaries(db, { now });
    const byId = new Map(summaries.map((s) => [s.product.id, s]));
    expect(byId.get(bread.id)?.last?.paidUnitBani).toBe(350);
    expect(byId.get(milk.id)?.observations).toEqual([]);
  });
});
