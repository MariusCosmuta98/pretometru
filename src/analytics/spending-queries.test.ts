import { describe, expect, it } from 'vitest';
import { createProduct } from '@/catalog';
import { SEED_CATEGORIES } from '@/domain';
import { deleteReceipt, ensureSeed, softDelete, updateRecord } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { currentMonth } from './months';
import { summarizeSpending } from './spending';
import { getSpending, loadSpendingReceipts } from './spending-queries';
import { saveGroundTruth, savePurchase, saveRealReceipts } from './spending-testing';

const DAIRY = SEED_CATEGORIES[0]!.id;
const MEAT = SEED_CATEGORIES[1]!.id;

async function seededDb() {
  const db = await createTestDb();
  await ensureSeed(db);
  return db;
}

const nameAndAmount = (categories: readonly { name: string; amountBani: number }[]) =>
  categories.map((category) => [category.name, category.amountBani]);

describe('spending over the four real receipts (ground truth saved with saveReceipt)', () => {
  it('puts every receipt in the month of its date and counts what was paid', async () => {
    const db = await seededDb();
    await saveRealReceipts(db);

    const receipts = await loadSpendingReceipts(db);

    expect(receipts.map((r) => [r.month, r.storeName, r.paidBani, r.totalBani])).toEqual([
      ['2026-08', 'METRO', 36341, 36341],
      ['2026-11', 'Mega Image', 6586, 6586], // no paid amount printed: the total
      ['2026-11', 'Kaufland', 18879, 20879], // the 20,00 packaging voucher was not paid
      ['2026-12', 'Lidl', 6167, 6167], // dated 29.12.2026, after the 20.11.2026 of the fixtures
    ]);
  });

  it('lists the months, the Lidl receipt in the future December included', async () => {
    const db = await seededDb();
    await saveRealReceipts(db);

    const everything = await getSpending(db);

    expect(everything).toMatchObject({ from: '2026-08', to: '2026-12', totalBani: 67_973 });
    expect(everything.months).toEqual([
      { month: '2026-08', totalBani: 36_341, receiptCount: 1 },
      { month: '2026-11', totalBani: 25_465, receiptCount: 2 },
      { month: '2026-12', totalBani: 6167, receiptCount: 1 },
    ]);
    const filled = await getSpending(db, { from: '2026-08', to: '2026-12' });
    expect(filled.months.map((m) => [m.month, m.totalBani])).toEqual([
      ['2026-08', 36_341],
      ['2026-09', 0],
      ['2026-10', 0],
      ['2026-11', 25_465],
      ['2026-12', 6167],
    ]);
  });

  it('splits November by category and adds up to what was paid', async () => {
    const db = await seededDb();
    await saveRealReceipts(db);

    const november = await getSpending(db, { from: '2026-11', to: '2026-11' });

    expect(nameAndAmount(november.categories)).toEqual([
      ['Fără categorie', 6935], // Mega Image's four lines, and Kaufland's "Delicatese/Convenience/Marinade"
      ['Bacanie', 4386],
      ['Curățenie & menaj', 3477],
      ['Lactate & ouă', 3013],
      ['Băuturi alcoolice', 2799],
      ['Carne & mezeluri', 2299],
      ['Igienă & cosmetice', 2097],
      ['Fructe & legume', 1390],
      ['Casă & bricolaj', 999],
      ['Non-produs', 70], // the 0,50 deposit and the 0,20 carrier bag
    ]);
    expect(november.adjustments).toEqual({ vouchersBani: -2000, roundingBani: 0 });
    expect(november.totalBani).toBe(25_465);
    const parts = november.categories.reduce((sum, c) => sum + c.amountBani, 0);
    expect(parts).toBe(27_465); // the lines of Kaufland (208,79) and Mega Image (65,86)
    expect(parts + november.adjustments.vouchersBani).toBe(november.totalBani);
    expect(november.stores.map((s) => [s.name, s.totalBani])).toEqual([
      ['Kaufland', 18_879],
      ['Mega Image', 6586],
    ]);
  });

  it("keeps METRO's one-ban rounding out of the categories", async () => {
    const db = await seededDb();
    await saveRealReceipts(db);

    const august = await getSpending(db, { from: '2026-08', to: '2026-08' });

    expect(nameAndAmount(august.categories)).toEqual([['Fără categorie', 36_342]]);
    expect(august.adjustments).toEqual({ vouchersBani: 0, roundingBani: -1 });
    expect(august.totalBani).toBe(36_341);
  });

  it('does not count a real receipt that is still a draft', async () => {
    const db = await seededDb();
    await saveGroundTruth(db, 'mega-image-2026-11-03');
    await saveGroundTruth(db, 'kaufland-2026-11-07', { status: 'draft' });

    const november = await getSpending(db, { from: '2026-11', to: '2026-11' });

    expect(november).toMatchObject({ totalBani: 6586, receiptCount: 1 });
  });
});

describe('spending over synthetic multi-month data', () => {
  async function world() {
    const db = await seededDb();
    const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: DAIRY, baseUnit: 'l' });

    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-31T23:59',
      lines: [{ lineTotalBani: 5000, productId: milk.id }],
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-01T00:00',
      lines: [{ lineTotalBani: 3000, categoryId: MEAT }],
    });
    // A discounted product (the discount is inside the line), a coupon line, a deposit, a bag, a fee
    // and a voucher: the receipt of the promo-deposit-voucher fixture.
    await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-15',
      paidBani: 4940,
      lines: [
        { lineTotalBani: 4350, discountBani: 150, productId: milk.id },
        { lineTotalBani: -459, kind: 'discount' },
        { lineTotalBani: 200, kind: 'deposit' },
        { lineTotalBani: 50, kind: 'bag' },
        { lineTotalBani: 999, kind: 'fee' },
      ],
    });
    await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-30T23:59:59',
      lines: [{ lineTotalBani: 1000 }],
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-12-01',
      lines: [{ lineTotalBani: 2000, categoryId: MEAT }],
    });
    return { db, milk };
  }

  it('assigns every receipt to its month, the last second of a month included', async () => {
    const { db } = await world();

    const quarter = await getSpending(db, { from: '2026-10', to: '2026-12' });

    expect(quarter.months).toEqual([
      { month: '2026-10', totalBani: 5000, receiptCount: 1 },
      { month: '2026-11', totalBani: 3000 + 4940 + 1000, receiptCount: 3 },
      { month: '2026-12', totalBani: 2000, receiptCount: 1 },
    ]);
  });

  it('counts discounts as they are inside the lines, and vouchers as paid less', async () => {
    const { db } = await world();

    const november = await getSpending(db, { from: '2026-11', to: '2026-11' });

    expect(nameAndAmount(november.categories)).toEqual([
      ['Lactate & ouă', 4350],
      ['Carne & mezeluri', 3000],
      ['Fără categorie', 1000],
      ['Non-produs', 200 + 50 + 999 - 459],
    ]);
    expect(november.adjustments).toEqual({ vouchersBani: -200, roundingBani: 0 });
    expect(november.totalBani).toBe(8940);
  });

  it('never counts drafts, deleted receipts or lines that a later save replaced', async () => {
    const { db } = await world();
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-10T10:00',
      status: 'draft',
      lines: [{ lineTotalBani: 77_700 }],
    });
    const deleted = await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-11T10:00',
      lines: [{ lineTotalBani: 88_800 }],
    });
    await deleteReceipt(db, deleted.receipt.id);
    const edited = await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-12T10:00',
      lines: [{ lineTotalBani: 100 }, { lineTotalBani: 999_900 }],
    });
    await savePurchase(db, {
      id: edited.receipt.id,
      chain: 'lidl',
      purchasedAt: '2026-11-12T10:00',
      lines: [{ lineTotalBani: 100 }],
    });

    const november = await getSpending(db, { from: '2026-11', to: '2026-11' });

    expect(november.totalBani).toBe(8940 + 100);
    expect(november.receiptCount).toBe(4);
    const parts = november.categories.reduce((sum, c) => sum + c.amountBani, 0);
    expect(parts + november.adjustments.vouchersBani).toBe(november.totalBani);
  });

  it('follows the catalog: recategorizing a product moves its past purchases, deleting the category shows them as uncategorized', async () => {
    const { db, milk } = await world();
    const october = { from: '2026-10', to: '2026-10' } as const;
    expect(nameAndAmount((await getSpending(db, october)).categories)).toEqual([
      ['Lactate & ouă', 5000],
    ]);

    await updateRecord(db.products, milk.id, { categoryId: MEAT });
    expect(nameAndAmount((await getSpending(db, october)).categories)).toEqual([
      ['Carne & mezeluri', 5000],
    ]);

    await softDelete(db.categories, MEAT);
    expect(nameAndAmount((await getSpending(db, october)).categories)).toEqual([
      ['Fără categorie', 5000],
    ]);
  });

  it('names a store that was removed since, and shows "Magazin necunoscut" for one that is gone', async () => {
    const { db } = await world();
    const lidl = await db.stores.where('chain').equals('lidl').first();
    await softDelete(db.stores, lidl!.id);
    expect((await getSpending(db)).stores.map((s) => s.name)).toContain('Lidl');

    await db.stores.delete(lidl!.id);
    expect((await getSpending(db)).stores.map((s) => s.name)).toContain('Magazin necunoscut');
  });

  it('takes the month of "now" in Europe/Bucharest for the period of the current month', async () => {
    const { db } = await world();
    // 22:30 UTC on 30.11.2026 is 00:30 on 1 December in Bucharest.
    const now = new Date('2026-11-30T22:30:00Z');
    const month = currentMonth(now);

    const receipts = await loadSpendingReceipts(db);
    const spending = summarizeSpending(receipts, { from: month, to: month });

    expect(month).toBe('2026-12');
    expect(spending.totalBani).toBe(2000);
  });
});
