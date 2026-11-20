import type { Store } from '@/domain';
import {
  getActive,
  listActive,
  softDelete,
  updateRecord,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { AdminError } from './errors';
import { compareNames, tidyName } from './text';

const isLive = (record: { deletedAt?: string | undefined }) => record.deletedAt === undefined;

const liveReceipts = (db: PretometruDB, storeId: string) =>
  db.receipts.where('storeId').equals(storeId).filter(isLive);

export interface StoreRow {
  store: Store;
  /** Live receipts, drafts included. */
  receipts: number;
}

function compareStores(a: Store, b: Store): number {
  return (
    compareNames(a.name, b.name) ||
    a.chain.localeCompare(b.chain) ||
    (a.branchCode ?? '').localeCompare(b.branchCode ?? '') ||
    a.id.localeCompare(b.id)
  );
}

/** The live stores by name, with how many receipts each has. */
export function listStores(db: PretometruDB): Promise<StoreRow[]> {
  return db.transaction('r', [db.stores, db.receipts], async () => {
    const stores = (await listActive(db.stores)).sort(compareStores);
    return Promise.all(
      stores.map(async (store) => ({ store, receipts: await liveReceipts(db, store.id).count() })),
    );
  });
}

/**
 * Renames a store. Only the name changes: what identifies a store for the importer (its chain,
 * branch and city) stays, so receipts keep arriving at the same store. Writes nothing when the
 * name is the same. Throws `EMPTY_NAME` or `NOT_FOUND`.
 */
export function renameStore(
  db: PretometruDB,
  id: string,
  name: string,
  context?: StorageContext,
): Promise<Store> {
  const tidy = tidyName(name);
  if (tidy === '') return Promise.reject(new AdminError('EMPTY_NAME', 'A store needs a name'));

  return db.transaction('rw', db.stores, async () => {
    const current = await getActive(db.stores, id);
    if (!current) throw new AdminError('NOT_FOUND', `Unknown store ${id}`);
    if (current.name === tidy) return current;
    return (await updateRecord(db.stores, id, { name: tidy }, context)) ?? current;
  });
}

export interface StoreMergeResult {
  /** The store that was kept. */
  store: Store;
  /** The store that was merged into it, now a tombstone. */
  merged: Store;
  /** Receipts that moved to the kept store. */
  receipts: number;
}

/**
 * Folds the duplicate store `fromId` into `intoId`: its live receipts (drafts too) now belong to
 * `intoId`, which keeps its own name, chain and branch, and `fromId` becomes a tombstone. All or
 * nothing. Throws `AdminError`: `SAME_STORE`, or `NOT_FOUND` for a missing or deleted store.
 */
export function mergeStores(
  db: PretometruDB,
  intoId: string,
  fromId: string,
  context?: StorageContext,
): Promise<StoreMergeResult> {
  if (intoId === fromId) {
    return Promise.reject(new AdminError('SAME_STORE', 'A store cannot be merged into itself'));
  }

  return db.transaction('rw', [db.stores, db.receipts], async () => {
    const into = await getActive(db.stores, intoId);
    if (!into) throw new AdminError('NOT_FOUND', `Unknown store ${intoId}`);
    const from = await getActive(db.stores, fromId);
    if (!from) throw new AdminError('NOT_FOUND', `Unknown store ${fromId}`);

    const receipts = await liveReceipts(db, fromId).toArray();
    for (const receipt of receipts) {
      await updateRecord(db.receipts, receipt.id, { storeId: intoId }, context);
    }
    await softDelete(db.stores, fromId, context);
    return { store: into, merged: from, receipts: receipts.length };
  });
}

/** Deletes a store that has no receipts (a tombstone). Throws `HAS_RECEIPTS` otherwise, or `NOT_FOUND`. */
export function deleteStore(
  db: PretometruDB,
  id: string,
  context?: StorageContext,
): Promise<Store> {
  return db.transaction('rw', [db.stores, db.receipts], async () => {
    const store = await getActive(db.stores, id);
    if (!store) throw new AdminError('NOT_FOUND', `Unknown store ${id}`);
    const receipts = await liveReceipts(db, id).count();
    if (receipts > 0) {
      throw new AdminError(
        'HAS_RECEIPTS',
        `The store has ${receipts} receipt(s): merge it instead`,
      );
    }
    await softDelete(db.stores, id, context);
    return store;
  });
}
