import Dexie from 'dexie';
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { SYNCED_ENTITY_SCHEMAS } from '@/domain';
import { makeAlias, makeLine, makeReceipt, makeStore } from '@/domain/testing';
import { applyMigrations, MIGRATIONS, type Migration } from './migrations';
import { memoizeUntilFailure, openDb } from './open';
import { createTestDb, testDb, uniqueTestDbName } from './testing';

describe('memoizeUntilFailure (behind getDb)', () => {
  it('opens once and shares the result between concurrent and later callers', async () => {
    let calls = 0;
    const get = memoizeUntilFailure(() => Promise.resolve(++calls));
    expect(await Promise.all([get(), get()])).toEqual([1, 1]);
    expect(await get()).toBe(1);
  });

  it('retries after a failed open instead of caching the failure forever', async () => {
    let calls = 0;
    const get = memoizeUntilFailure(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('blocked')) : Promise.resolve(calls);
    });
    await expect(get()).rejects.toThrow('blocked');
    expect(await get()).toBe(2);
  });
});

describe('released migrations', () => {
  it('are immutable: schema v1 is exactly this (add a version instead of editing it)', () => {
    expect(MIGRATIONS).toEqual([
      {
        version: 1,
        stores: {
          stores: 'id, chain, [chain+branchCode], deletedAt, updatedAt',
          receipts:
            'id, storeId, purchasedAt, status, [storeId+purchasedAt], source.fileHash, deletedAt, updatedAt',
          lines: 'id, receiptId, [receiptId+idx], productId, categoryId, ean, deletedAt, updatedAt',
          products: 'id, categoryId, ean, name, deletedAt, updatedAt',
          aliases: 'id, normName, ean, productId, [chain+normName], deletedAt, updatedAt',
          categories: 'id, parentId, order, deletedAt, updatedAt',
          lists: 'id, deletedAt, updatedAt',
          listItems: 'id, listId, productId, deletedAt, updatedAt',
          settings: 'key, updatedAt',
          syncState: 'key',
        },
      },
    ]);
  });
});

describe('openDb', () => {
  it('opens the database and seeds the categories, again and again across restarts', async () => {
    const name = uniqueTestDbName();
    const dexie = { indexedDB, IDBKeyRange };

    const first = await openDb({ name, dexie });
    expect(await first.categories.count()).toBe(16);
    first.close();

    const second = await openDb({ name, dexie });
    try {
      expect(await second.categories.count()).toBe(16);
    } finally {
      await second.delete();
    }
  });
});

describe('schema v1', () => {
  it('creates every table of plan §6', async () => {
    const db = await createTestDb();
    expect(db.tables.map((table) => table.name).sort()).toEqual([
      'aliases',
      'categories',
      'lines',
      'listItems',
      'lists',
      'products',
      'receipts',
      'settings',
      'stores',
      'syncState',
    ]);
  });

  it('is covered by the backup registry: every synced table, and only those, are exported', async () => {
    const db = await createTestDb();
    const keyValueTables = ['settings', 'syncState'];
    const synced = db.tables.map((t) => t.name).filter((name) => !keyValueTables.includes(name));
    expect(synced.sort()).toEqual(Object.keys(SYNCED_ENTITY_SCHEMAS).sort());
  });

  it('supports the lookups other modules rely on (duplicate detection, line and alias lookup)', async () => {
    const db = await createTestDb();
    const storeId = makeStore().id;
    const receipt = makeReceipt({ storeId, purchasedAt: '2026-11-07T14:32' });
    const other = makeReceipt({ storeId, purchasedAt: '2026-11-08', source: { kind: 'manual' } });
    await db.receipts.bulkAdd([receipt, other]);
    await db.lines.bulkAdd([
      makeLine({ receiptId: receipt.id, idx: 1 }),
      makeLine({ receiptId: receipt.id, idx: 0 }),
    ]);
    const alias = makeAlias({ chain: 'lidl', normName: 'lapte 1l' });
    await db.aliases.bulkAdd([alias, makeAlias({ chain: 'kaufland', normName: 'lapte 1l' })]);

    const byHash = await db.receipts.where('source.fileHash').equals('a'.repeat(64)).primaryKeys();
    expect(byHash).toEqual([receipt.id]);

    const sameDay = await db.receipts
      .where('[storeId+purchasedAt]')
      .between([storeId, '2026-11-07'], [storeId, '2026-11-07\uffff'])
      .primaryKeys();
    expect(sameDay).toEqual([receipt.id]);

    const lines = await db.lines
      .where('[receiptId+idx]')
      .between([receipt.id, 0], [receipt.id, 99])
      .toArray();
    expect(lines.map((line) => line.idx)).toEqual([0, 1]);

    const aliases = await db.aliases
      .where('[chain+normName]')
      .equals(['lidl', 'lapte 1l'])
      .primaryKeys();
    expect(aliases).toEqual([alias.id]);
  });
});

describe('applyMigrations', () => {
  it('rejects versions that are not strictly ascending', () => {
    const db = new Dexie(uniqueTestDbName());
    expect(() =>
      applyMigrations(db, [
        { version: 2, stores: {} },
        { version: 1, stores: {} },
      ]),
    ).toThrow(/ascending/i);
  });

  it('upgrades existing data and builds a new index in a later version', async () => {
    const name = uniqueTestDbName();
    const v1 = testDb(name);
    await v1.open();
    const { city: _city, ...withoutCity } = makeStore({ name: 'Lidl Dorobanți' });
    await v1.stores.add(withoutCity);
    v1.close();

    const v2: Migration = {
      version: 2,
      stores: { stores: 'id, chain, [chain+branchCode], deletedAt, updatedAt, city' },
      upgrade: (tx) =>
        tx
          .table<{ city?: string }>('stores')
          .toCollection()
          .modify((store) => {
            store.city = 'București';
          }),
    };
    const upgraded = testDb(name, [...MIGRATIONS, v2]);
    try {
      await upgraded.open();
      const stores = await upgraded.stores.where('city').equals('București').toArray();
      expect(stores.map((store) => store.name)).toEqual(['Lidl Dorobanți']);
    } finally {
      await upgraded.delete();
    }
  });
});
