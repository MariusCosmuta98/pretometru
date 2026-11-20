import type Dexie from 'dexie';
import type { Transaction } from 'dexie';

export interface Migration {
  /** Dexie schema version: a positive integer, strictly ascending; never reuse or edit a released one. */
  version: number;
  /**
   * Only the tables whose indexes change in this version (Dexie merges with the earlier versions);
   * `null` drops a table. Adding a non-indexed field to a record needs no migration at all.
   */
  stores: Record<string, string | null>;
  /** Data migration, run once for databases opened below `version`. */
  upgrade?: (tx: Transaction) => PromiseLike<unknown> | void;
}

// `id`/`key` is the primary key. `deletedAt` and `updatedAt` serve tombstone purging and sync
// ("changed since"). Compound indexes cover duplicate detection and alias lookup.
export const SCHEMA_V1: Record<string, string> = {
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
};

/** Append new versions at the end; see docs/architecture.md for how to write one. */
export const MIGRATIONS: readonly Migration[] = [{ version: 1, stores: SCHEMA_V1 }];

export function applyMigrations(db: Dexie, migrations: readonly Migration[] = MIGRATIONS): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= previous) {
      throw new RangeError(
        `Migration versions must be strictly ascending integers, got ${migration.version} after ${previous}`,
      );
    }
    previous = migration.version;
    const version = db.version(migration.version).stores(migration.stores);
    if (migration.upgrade) version.upgrade(migration.upgrade);
  }
}
