import { describe, expect, it } from 'vitest';
import { IdSchema, SEED_CATEGORIES } from '@/domain';
import { makeLine, makeStore } from '@/domain/testing';
import {
  createRecord,
  getActive,
  listActive,
  purgeTombstones,
  softDelete,
  updateRecord,
} from './records';
import { saveReceipt } from './receipts';
import { ensureSeed } from './seed';
import { createTestDb } from './testing';

const at = (iso: string) => ({ now: () => new Date(iso) });
const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-20T11:00:00.000Z';
const T3 = '2026-11-20T12:00:00.000Z';

const newProduct = (name = 'Lapte') => ({
  name,
  categoryId: '0000000000SEEDCATEG0000001',
  baseUnit: 'l' as const,
});

describe('createRecord', () => {
  it('stamps a ULID and updatedAt, stores the record and returns it', async () => {
    const db = await createTestDb();
    const product = await createRecord(db.products, newProduct(), at(T1));

    expect(IdSchema.safeParse(product.id).success).toBe(true);
    expect(product.updatedAt).toBe(T1);
    expect(await db.products.get(product.id)).toEqual(product);
  });

  it('refuses a record that breaks the contract and writes nothing', async () => {
    const db = await createTestDb();
    await expect(createRecord(db.products, newProduct(''))).rejects.toThrow();
    expect(await db.products.count()).toBe(0);
  });

  it('refuses a duplicate id instead of overwriting the stored record', async () => {
    const db = await createTestDb();
    const store = makeStore({ name: 'Original' });
    await createRecord(db.stores, store);
    await expect(createRecord(db.stores, { ...store, name: 'Impostor' })).rejects.toThrow();
    expect((await db.stores.get(store.id))?.name).toBe('Original');
  });
});

describe('updateRecord', () => {
  it('merges the patch, bumps updatedAt and keeps the id', async () => {
    const db = await createTestDb();
    const created = await createRecord(db.products, newProduct(), at(T1));
    const updated = await updateRecord(db.products, created.id, { name: 'Lapte UHT' }, at(T2));

    expect(updated).toEqual({ ...created, name: 'Lapte UHT', updatedAt: T2 });
    expect(await db.products.get(created.id)).toEqual(updated);
  });

  it('returns undefined for a missing or deleted record', async () => {
    const db = await createTestDb();
    const created = await createRecord(db.products, newProduct());
    await softDelete(db.products, created.id);

    expect(await updateRecord(db.products, created.id, { name: 'Zombie' })).toBeUndefined();
    expect(await updateRecord(db.products, makeStore().id, { name: 'Nobody' })).toBeUndefined();
  });

  it('rejects a patch that makes the record invalid and keeps the stored one', async () => {
    const db = await createTestDb();
    const created = await createRecord(db.products, newProduct(), at(T1));

    await expect(updateRecord(db.products, created.id, { name: '' }, at(T2))).rejects.toThrow();
    expect(await db.products.get(created.id)).toEqual(created);
  });
});

describe('softDelete and reads', () => {
  it('hides the record but keeps a tombstone that sync can propagate', async () => {
    const db = await createTestDb();
    const product = await createRecord(db.products, newProduct(), at(T1));

    expect(await softDelete(db.products, product.id, at(T3))).toBe(true);
    expect(await getActive(db.products, product.id)).toBeUndefined();
    expect(await listActive(db.products)).toEqual([]);
    expect(await db.products.get(product.id)).toMatchObject({ deletedAt: T3, updatedAt: T3 });
  });

  it('deleting twice, or deleting nothing, is a no-op that reports false', async () => {
    const db = await createTestDb();
    const product = await createRecord(db.products, newProduct());
    await softDelete(db.products, product.id, at(T2));

    expect(await softDelete(db.products, product.id, at(T3))).toBe(false);
    expect((await db.products.get(product.id))?.deletedAt).toBe(T2);
    expect(await softDelete(db.products, makeStore().id)).toBe(false);
  });

  it('lists live records in creation order', async () => {
    const db = await createTestDb();
    const a = await createRecord(db.products, newProduct('A'));
    const b = await createRecord(db.products, newProduct('B'));
    const c = await createRecord(db.products, newProduct('C'));
    await softDelete(db.products, b.id);

    expect((await listActive(db.products)).map((p) => p.id)).toEqual([a.id, c.id]);
  });
});

describe('purgeTombstones', () => {
  it('physically removes only tombstones older than the cutoff', async () => {
    const db = await createTestDb();
    const oldOne = await createRecord(db.products, newProduct('old'));
    const recent = await createRecord(db.products, newProduct('recent'));
    const live = await createRecord(db.products, newProduct('live'));
    await softDelete(db.products, oldOne.id, at(T1));
    await softDelete(db.products, recent.id, at(T3));

    expect(await purgeTombstones(db.products, new Date(T2))).toBe(1);
    expect(await db.products.get(oldOne.id)).toBeUndefined();
    expect(await db.products.get(recent.id)).toBeDefined();
    expect(await db.products.get(live.id)).toBeDefined();
  });

  it('keeps the tombstone of a deleted seed category, so the seed does not bring it back', async () => {
    const db = await createTestDb();
    await ensureSeed(db);
    const seeded = SEED_CATEGORIES[0]!;
    await softDelete(db.categories, seeded.id, at(T1));

    expect(await purgeTombstones(db.categories, new Date(T3))).toBe(0);
    await ensureSeed(db);
    expect((await listActive(db.categories)).some((c) => c.id === seeded.id)).toBe(false);
  });
});

describe('lines are only written through saveReceipt or updated with their prices re-derived', () => {
  const receiptInput = {
    storeId: makeStore().id,
    purchasedAt: '2026-11-07',
    docType: 'receipt' as const,
    totalBani: 398,
    source: { kind: 'manual' as const },
    extraction: { engine: 'manual' as const, parser: 'manual', version: '1.0.0', warnings: [] },
    status: 'confirmed' as const,
  };

  it('re-derives the unit prices when a line gains a pack size (what alias.defaultPack does)', async () => {
    const db = await createTestDb();
    const { lines } = await saveReceipt(db, receiptInput, [
      {
        idx: 0,
        rawName: 'SERVETELE UMEDE',
        qty: 1,
        unit: 'buc',
        lineTotalBani: 398,
        discountBani: 0,
        kind: 'product',
      },
    ]);
    expect(lines[0]).toMatchObject({ baseUnit: 'buc', pricePerBaseMilliBani: 398_000 });

    const updated = await updateRecord(db.lines, lines[0]!.id, { packQty: 120, packUnit: 'buc' });
    expect(updated).toMatchObject({
      paidUnitBani: 398,
      baseUnit: 'buc',
      pricePerBaseMilliBani: 3317,
    });
    expect(await db.lines.get(lines[0]!.id)).toEqual(updated);
  });

  it('refuses createRecord on lines: new lines need their prices derived by saveReceipt', async () => {
    const db = await createTestDb();
    const { id: _id, updatedAt: _updatedAt, ...fields } = makeLine();
    await expect(createRecord(db.lines, fields)).rejects.toThrow(/saveReceipt/);
  });
});
