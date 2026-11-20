import type { Page } from '@playwright/test';
import { SEED_CATEGORIES } from '../../src/domain/seed.ts';
import { makeLine, makeProduct, makeReceipt, makeStore } from '../../src/domain/testing.ts';

const HOUSEHOLD = SEED_CATEGORIES[9]?.id ?? '';

const daysAgo = (days: number) => {
  const date = new Date(Date.now() - days * 86_400_000);
  return `${date.toISOString().slice(0, 10)}T10:00`;
};

export interface SeededData {
  receiptId: string;
  productId: string;
}

/**
 * Toilet paper bought at two stores (so the product page has a comparison and a chart), written into
 * the app's IndexedDB with the records the storage layer would write. The database is opened by the
 * app first (it creates the schema and the seed categories), so the page must have loaded.
 */
export async function seedPriceHistory(page: Page): Promise<SeededData> {
  const kaufland = makeStore({ chain: 'kaufland', name: 'Kaufland Cluj' });
  const metro = makeStore({ chain: 'metro', name: 'METRO Cluj' });
  const product = makeProduct({ name: 'Hârtie igienică', categoryId: HOUSEHOLD, baseUnit: 'role' });
  const purchases = [
    { store: metro, total: 1042, discount: 359, at: daysAgo(40) },
    { store: kaufland, total: 1280, discount: 0, at: daysAgo(20) },
    { store: kaufland, total: 1160, discount: 0, at: daysAgo(5) },
  ].map((purchase) => {
    const receipt = makeReceipt({
      storeId: purchase.store.id,
      purchasedAt: purchase.at,
      totalBani: purchase.total,
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'manual', version: '1.0.0', warnings: [] },
    });
    const line = makeLine({
      receiptId: receipt.id,
      rawName: 'HARTIE IGIENICA 8 ROLE',
      qty: 1,
      unit: 'buc',
      lineTotalBani: purchase.total,
      discountBani: purchase.discount,
      productId: product.id,
      categoryId: HOUSEHOLD,
      packQty: 8,
      packUnit: 'role',
      paidUnitBani: purchase.total,
      baseUnit: 'role',
      pricePerBaseMilliBani: Math.round((purchase.total * 1000) / 8),
    });
    return { receipt, line };
  });

  const records = {
    stores: [kaufland, metro],
    products: [product],
    receipts: purchases.map((purchase) => purchase.receipt),
    lines: purchases.map((purchase) => purchase.line),
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
    const tables = Object.keys(data);
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(tables, 'readwrite');
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

  const [first] = records.receipts;
  return { receiptId: first?.id ?? '', productId: product.id };
}
