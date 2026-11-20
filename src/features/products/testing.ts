/**
 * Test-only helpers for the product screens: the shared app database (fake-indexeddb) reset to
 * the seed categories, and the plan §7.7 toilet paper bought at three stores. Import
 * `fake-indexeddb/auto` first in the test file. Never import this from application code.
 */
import { createProduct } from '@/catalog';
import { saveTestReceipt } from '@/catalog/testing';
import { SEED_CATEGORIES } from '@/domain';
import { ensureSeed, getDb } from '@/storage';

export const HOUSEHOLD = SEED_CATEGORIES[9]!.id;
export const DAIRY = SEED_CATEGORIES[0]!.id;

/** The clock the screens see in tests: 100 days after METRO's invoice, as in the fixtures. */
export const NOW = new Date('2026-11-20T12:00:00Z');

export async function resetDb() {
  const db = await getDb();
  await Promise.all(db.tables.map((table) => table.clear()));
  await ensureSeed(db);
  return db;
}

/**
 * Toilet paper per roll: METRO 1,30 (on sale) · Kaufland 1,60 then 1,45 · Mega 2,00; milk only at
 * Kaufland.
 */
export async function seedWorld() {
  const db = await resetDb();
  const paper = await createProduct(db, {
    name: 'Hârtie igienică',
    categoryId: HOUSEHOLD,
    baseUnit: 'role',
  });
  const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: DAIRY, baseUnit: 'l' });
  const roll = { rawName: 'HARTIE IGIENICA 8 ROLE', pack: { qty: 8, unit: 'role' as const } };

  await saveTestReceipt(db, {
    chain: 'metro',
    purchasedAt: '2026-09-20T10:00',
    lines: [{ ...roll, lineTotalBani: 1042, discountBani: 359, productId: paper.id }],
  });
  await saveTestReceipt(db, {
    chain: 'kaufland',
    purchasedAt: '2026-10-01T09:15',
    lines: [{ ...roll, lineTotalBani: 1280, productId: paper.id }],
  });
  await saveTestReceipt(db, {
    chain: 'kaufland',
    purchasedAt: '2026-11-07T18:31',
    lines: [
      { ...roll, lineTotalBani: 1160, productId: paper.id },
      {
        rawName: 'LAPTE UHT 1L',
        lineTotalBani: 599,
        pack: { qty: 1, unit: 'l' },
        productId: milk.id,
      },
    ],
  });
  await saveTestReceipt(db, {
    chain: 'mega-image',
    purchasedAt: '2026-11-03T16:20',
    lines: [{ ...roll, rawName: 'HARTIE IGIENICA', lineTotalBani: 1600, productId: paper.id }],
  });
  return { db, paper, milk };
}
