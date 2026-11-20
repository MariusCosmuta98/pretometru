import type { List } from '@/domain';
import {
  createRecord,
  getActive,
  softDelete,
  updateRecord,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { insertProduct, liveItems, requireProduct, type AddResult } from './items';
import { pinClock, tidy } from './support';

function requireName(name: string): string {
  const tidied = tidy(name);
  if (tidied === '') throw new RangeError('A list needs a name');
  return tidied;
}

/** Creates an empty list. Names need not be unique. Throws a `RangeError` for an empty name. */
export async function createList(
  db: PretometruDB,
  name: string,
  context?: StorageContext,
): Promise<List> {
  return createRecord(db.lists, { name: requireName(name) }, context);
}

/** Creates a list that starts with one product (the "add to a new list" action of the product page). */
export async function createListWithProduct(
  db: PretometruDB,
  name: string,
  productId: string,
  context?: StorageContext,
): Promise<AddResult & { list: List }> {
  const listName = requireName(name);
  return db.transaction('rw', [db.lists, db.listItems, db.products], async () => {
    const product = await requireProduct(db, productId);
    const list = await createRecord(db.lists, { name: listName }, context);
    return { list, ...(await insertProduct(db, list.id, product, context)) };
  });
}

/** Renames a list; `undefined` when it does not exist (any more). Throws a `RangeError` for an empty name. */
export async function renameList(
  db: PretometruDB,
  listId: string,
  name: string,
  context?: StorageContext,
): Promise<List | undefined> {
  return updateRecord(db.lists, listId, { name: requireName(name) }, context);
}

/** Archives a list (`archivedAt` is the moment); one that is archived already stays as it is. */
export function archiveList(
  db: PretometruDB,
  listId: string,
  context?: StorageContext,
): Promise<List | undefined> {
  return db.transaction('rw', db.lists, async () => {
    const list = await getActive(db.lists, listId);
    if (!list || list.archivedAt !== undefined) return list;
    const { stamp, context: pinned } = pinClock(context);
    return updateRecord(db.lists, listId, { archivedAt: stamp }, pinned);
  });
}

/** Brings an archived list back; a list that is not archived stays as it is. */
export function restoreList(
  db: PretometruDB,
  listId: string,
  context?: StorageContext,
): Promise<List | undefined> {
  return db.transaction('rw', db.lists, async () => {
    const list = await getActive(db.lists, listId);
    if (!list || list.archivedAt === undefined) return list;
    return updateRecord(db.lists, listId, { archivedAt: undefined }, context);
  });
}

/** Deletes a list and its items (tombstones, so the deletion syncs). `false` when it does not exist (any more). */
export function deleteList(
  db: PretometruDB,
  listId: string,
  context?: StorageContext,
): Promise<boolean> {
  const { context: pinned } = pinClock(context);
  return db.transaction('rw', [db.lists, db.listItems], async () => {
    if (!(await softDelete(db.lists, listId, pinned))) return false;
    for (const item of await liveItems(db, listId)) await softDelete(db.listItems, item.id, pinned);
    return true;
  });
}
