import type { Page } from '@playwright/test';
import { SEED_CATEGORIES } from '../../src/domain/seed.ts';
import { makeLine, makeProduct, makeReceipt, makeStore } from '../../src/domain/testing.ts';

const DAIRY = SEED_CATEGORIES[0]?.id ?? '';
const MEAT = SEED_CATEGORIES[1]?.id ?? '';
const HOUSEHOLD = SEED_CATEGORIES[9]?.id ?? '';

export interface DashboardData {
  keptReceiptId: string;
  milkId: string;
}

/**
 * Receipts for the Home and Statistics screens, as the clock of the fixtures (20.11.2026) sees them:
 * METRO in August, Kaufland and Mega Image in November (Kaufland paid 20,00 less, with a packaging
 * voucher), Kaufland in October, a Lidl receipt dated 29.12.2026 and a Lidl draft. The milk costs 5,00
 * lei a litre on 01.10 and 5,99 on 07.11, a price increase. Written straight into the app's IndexedDB
 * with the records the storage layer would write; the page must have loaded so that the database exists.
 */
export async function seedDashboard(page: Page): Promise<DashboardData> {
  const kaufland = makeStore({ chain: 'kaufland', name: 'Kaufland Cluj' });
  const metro = makeStore({ chain: 'metro', name: 'METRO Cluj' });
  const mega = makeStore({ chain: 'mega-image', name: 'Mega Image' });
  const lidl = makeStore({ chain: 'lidl', name: 'Lidl' });
  const milk = makeProduct({ name: 'Lapte UHT', categoryId: DAIRY, baseUnit: 'l' });

  type LineSpec = {
    rawName: string;
    total: number;
    kind?: 'product' | 'deposit' | 'bag';
    categoryId?: string;
    productId?: string;
  };
  const build = (
    store: { id: string },
    purchasedAt: string,
    lines: LineSpec[],
    extra: { totalBani?: number; paidBani?: number; status?: 'draft' | 'confirmed' } = {},
  ) => {
    const receipt = makeReceipt({
      storeId: store.id,
      purchasedAt,
      totalBani: extra.totalBani ?? lines.reduce((sum, line) => sum + line.total, 0),
      ...(extra.paidBani === undefined ? {} : { paidBani: extra.paidBani }),
      status: extra.status ?? 'confirmed',
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'manual', version: '1.0.0', warnings: [] },
    });
    return {
      receipt,
      lines: lines.map((line, idx) =>
        makeLine({
          receiptId: receipt.id,
          idx,
          rawName: line.rawName,
          qty: 1,
          unit: 'buc',
          lineTotalBani: line.total,
          kind: line.kind ?? 'product',
          ...(line.categoryId === undefined ? {} : { categoryId: line.categoryId }),
          ...(line.productId === undefined ? {} : { productId: line.productId }),
          ...(line.productId === milk.id ? { packQty: 1, packUnit: 'l' as const } : {}),
          paidUnitBani: line.total,
          baseUnit: line.productId === milk.id ? 'l' : 'buc',
          pricePerBaseMilliBani: line.total * 1000,
        }),
      ),
    };
  };

  const purchases = [
    build(
      metro,
      '2026-08-12T19:33',
      [
        { rawName: 'COLA 2L', total: 20_000 },
        { rawName: 'ALTE PRODUSE', total: 16_342 },
      ],
      { totalBani: 36_341, paidBani: 36_341 },
    ),
    build(kaufland, '2026-10-01T10:00', [
      { rawName: 'LAPTE UHT 1L', total: 500, productId: milk.id },
      { rawName: 'ALTE PRODUSE', total: 20_000 },
    ]),
    build(mega, '2026-11-03T16:57', [
      { rawName: 'MERE', total: 1789 },
      { rawName: 'PAINE', total: 1499 },
      { rawName: 'ORZ', total: 1299 },
      { rawName: 'CAFEA', total: 1999 },
    ]),
    build(
      kaufland,
      '2026-11-07T18:31',
      [
        { rawName: 'LAPTE UHT 1L', total: 599, productId: milk.id },
        { rawName: 'PULPE DEZOSATE', total: 2299, categoryId: MEAT },
        { rawName: 'HARTIE IG 8ROLE', total: 3477, categoryId: HOUSEHOLD },
        { rawName: 'ALTE PRODUSE', total: 14_434 },
        { rawName: 'GARANTIE AMBALAJ', total: 50, kind: 'deposit' },
        { rawName: 'PUNGA BIO', total: 20, kind: 'bag' },
      ],
      { totalBani: 20_879, paidBani: 18_879 },
    ),
    build(lidl, '2026-11-19T18:00', [{ rawName: 'PAINE', total: 1234 }], { status: 'draft' }),
    build(lidl, '2026-12-29T17:12', [{ rawName: 'SACI MENAJERI', total: 6167 }]),
  ];

  const records = {
    stores: [kaufland, metro, mega, lidl],
    products: [milk],
    receipts: purchases.map((purchase) => purchase.receipt),
    lines: purchases.flatMap((purchase) => purchase.lines),
  };

  await page.evaluate(async (data) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pretometru');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database did not open'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(Object.keys(data), 'readwrite');
      for (const [table, rows] of Object.entries(data)) {
        for (const row of rows) transaction.objectStore(table).put(row);
      }
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('The seed was not written'));
      };
    });
    db.close();
  }, records);

  const kept = purchases[3];
  return { keptReceiptId: kept?.receipt.id ?? '', milkId: milk.id };
}
