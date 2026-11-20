/**
 * Test-only helpers for the admin logic and its screens: builders that work on any test database
 * and the shared app database (fake-indexeddb) reset to the seed. Never import this from
 * application code.
 */
import {
  SEED_CATEGORIES,
  type Chain,
  type LineKind,
  type Product,
  type Receipt,
  type ReceiptStatus,
  type Store,
} from '@/domain';
import { createRecord, ensureSeed, getDb, saveReceipt, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';

/** Seed categories by what they are called in the tests. */
export const SEED = {
  dairy: SEED_CATEGORIES[0]!,
  meat: SEED_CATEGORIES[1]!,
  grocery: SEED_CATEGORIES[4]!,
  household: SEED_CATEGORIES[9]!,
  other: SEED_CATEGORIES[14]!,
  nonProduct: SEED_CATEGORIES[15]!,
};

/** A fresh in-memory database with the seed categories. */
export async function seededTestDb(): Promise<PretometruDB> {
  const db = await createTestDb();
  await ensureSeed(db);
  return db;
}

/** The shared app database (what the screens open), emptied and seeded. Import `fake-indexeddb/auto` first. */
export async function resetDb(): Promise<PretometruDB> {
  const db = await getDb();
  await Promise.all(db.tables.map((table) => table.clear()));
  await ensureSeed(db);
  return db;
}

export function addStore(
  db: PretometruDB,
  fields: { chain?: Chain; name?: string; branchCode?: string; city?: string } = {},
): Promise<Store> {
  const { chain = 'kaufland', name = 'Kaufland', branchCode, city } = fields;
  return createRecord(db.stores, {
    chain,
    name,
    ...(branchCode ? { branchCode } : {}),
    ...(city ? { city } : {}),
  });
}

export function addProduct(
  db: PretometruDB,
  name: string,
  categoryId: string = SEED.grocery.id,
): Promise<Product> {
  return createRecord(db.products, { name, categoryId, baseUnit: 'buc' });
}

export interface TestLine {
  name?: string;
  totalBani?: number;
  kind?: LineKind;
  productId?: string;
  categoryId?: string;
}

/** A receipt of the store with the given lines (one 5,99 lei product line when none are given). */
export async function addReceipt(
  db: PretometruDB,
  storeId: string,
  {
    status = 'confirmed',
    lines = [{}],
  }: { status?: ReceiptStatus; lines?: readonly TestLine[] } = {},
): Promise<Receipt> {
  const { receipt } = await saveReceipt(
    db,
    {
      storeId,
      purchasedAt: '2026-11-07T14:32',
      docType: 'receipt',
      totalBani: lines.reduce((sum, line) => sum + (line.totalBani ?? 599), 0),
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'test', version: '1.0.0', warnings: [] },
      status,
    },
    lines.map((line, idx) => ({
      idx,
      rawName: line.name ?? `PRODUS ${idx + 1}`,
      qty: 1,
      unit: 'buc',
      lineTotalBani: line.totalBani ?? 599,
      discountBani: 0,
      kind: line.kind ?? 'product',
      ...(line.productId !== undefined ? { productId: line.productId } : {}),
      ...(line.categoryId !== undefined ? { categoryId: line.categoryId } : {}),
    })),
  );
  return receipt;
}
