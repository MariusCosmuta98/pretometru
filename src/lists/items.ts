import { QtySchema, type ListItem, type Product, type QtyUnit } from '@/domain';
import {
  createRecord,
  getActive,
  softDelete,
  updateRecord,
  type PretometruDB,
  type RecordPatch,
  type StorageContext,
} from '@/storage';
import { pinClock, tidy } from './support';

const byOrder = (a: ListItem, b: ListItem): number => a.order - b.order || a.id.localeCompare(b.id);
const nextOrder = (items: readonly ListItem[]): number =>
  items.reduce((max, item) => Math.max(max, item.order), -1) + 1;

/** The live items of a list in list order (`order`, then id). */
export async function liveItems(db: PretometruDB, listId: string): Promise<ListItem[]> {
  const items = await db.listItems
    .where('listId')
    .equals(listId)
    .filter((item) => item.deletedAt === undefined)
    .toArray();
  return items.sort(byOrder);
}

async function requireList(db: PretometruDB, listId: string): Promise<void> {
  if (!(await getActive(db.lists, listId))) throw new RangeError(`Unknown list ${listId}`);
}

/** The live product, or a `RangeError`. */
export async function requireProduct(db: PretometruDB, productId: string): Promise<Product> {
  const product = await getActive(db.products, productId);
  if (!product) throw new RangeError(`Unknown product ${productId}`);
  return product;
}

/** `added`: a new item; `already`: the product was still to buy on the list; `reopened`: it was checked and is to buy again. */
export type AddStatus = 'added' | 'already' | 'reopened';

export interface AddResult {
  item: ListItem;
  status: AddStatus;
}

/**
 * Puts a product at the end of a list, unless the list already has it to buy; a checked one is
 * unchecked and moved to the end instead (it is needed again). Runs inside the caller's transaction.
 */
export async function insertProduct(
  db: PretometruDB,
  listId: string,
  product: Product,
  context?: StorageContext,
): Promise<AddResult> {
  const items = await liveItems(db, listId);
  const same = items.filter((item) => item.productId === product.id);
  const open = same.find((item) => !item.checked);
  if (open) return { item: open, status: 'already' };

  const order = nextOrder(items);
  const checked = same.at(-1);
  if (checked) {
    const item = await updateRecord(
      db.listItems,
      checked.id,
      { checked: false, checkedAt: undefined, order },
      context,
    );
    if (item) return { item, status: 'reopened' };
  }
  const item = await createRecord(
    db.listItems,
    { listId, productId: product.id, label: product.name, checked: false, order },
    context,
  );
  return { item, status: 'added' };
}

/** Adds a catalog product to a list (see `insertProduct` for a product that is already there). */
export function addProductToList(
  db: PretometruDB,
  listId: string,
  productId: string,
  context?: StorageContext,
): Promise<AddResult> {
  return db.transaction('rw', [db.lists, db.listItems, db.products], async () => {
    await requireList(db, listId);
    return insertProduct(db, listId, await requireProduct(db, productId), context);
  });
}

/** Adds a free-text item (no product, so no price) at the end of a list. Throws a `RangeError` for an empty text. */
export async function addTextItem(
  db: PretometruDB,
  listId: string,
  label: string,
  context?: StorageContext,
): Promise<ListItem> {
  const text = tidy(label);
  if (text === '') throw new RangeError('An item needs a name');
  return db.transaction('rw', [db.lists, db.listItems], async () => {
    await requireList(db, listId);
    const order = nextOrder(await liveItems(db, listId));
    return createRecord(db.listItems, { listId, label: text, checked: false, order }, context);
  });
}

/** Fields of an item a user edits. A key that is present with `undefined` clears the field; an absent key leaves it alone. */
export interface ItemPatch {
  label?: string;
  qty?: number | undefined;
  unit?: QtyUnit | undefined;
  note?: string | undefined;
}

/**
 * Edits an item; `undefined` when it does not exist (any more). Throws a `RangeError` for an empty
 * label or a quantity that is not positive, above a million or finer than 3 decimals.
 */
export async function updateItem(
  db: PretometruDB,
  itemId: string,
  patch: ItemPatch,
  context?: StorageContext,
): Promise<ListItem | undefined> {
  const changes: RecordPatch<ListItem> = {};
  if (patch.label !== undefined) {
    const label = tidy(patch.label);
    if (label === '') throw new RangeError('An item needs a name');
    changes.label = label;
  }
  if ('qty' in patch) {
    if (patch.qty !== undefined && !QtySchema.safeParse(patch.qty).success) {
      throw new RangeError(`Invalid quantity ${patch.qty}`);
    }
    changes.qty = patch.qty;
  }
  if ('unit' in patch) changes.unit = patch.unit;
  if ('note' in patch) {
    const note = tidy(patch.note ?? '');
    changes.note = note === '' ? undefined : note;
  }
  return updateRecord(db.listItems, itemId, changes, context);
}

/**
 * Checks an item (`checkedAt` is the moment) or unchecks it. Asking for the state the item is
 * already in changes nothing. `undefined` when the item does not exist (any more).
 */
export function setItemChecked(
  db: PretometruDB,
  itemId: string,
  checked: boolean,
  context?: StorageContext,
): Promise<ListItem | undefined> {
  return db.transaction('rw', db.listItems, async () => {
    const item = await getActive(db.listItems, itemId);
    if (!item || item.checked === checked) return item;
    const { stamp, context: pinned } = pinClock(context);
    return updateRecord(
      db.listItems,
      itemId,
      checked ? { checked, checkedAt: stamp } : { checked, checkedAt: undefined },
      pinned,
    );
  });
}

/** Removes an item (a tombstone, so the removal syncs). `false` when it does not exist (any more). */
export function removeItem(
  db: PretometruDB,
  itemId: string,
  context?: StorageContext,
): Promise<boolean> {
  return softDelete(db.listItems, itemId, context);
}

/**
 * Moves an item to just before or just after another item of the same list, then numbers the
 * list 0, 1, 2... again (only the items whose position changed are written). `false` when nothing
 * moved: an unknown item, items of different lists, or the item is already there.
 */
export function moveItem(
  db: PretometruDB,
  itemId: string,
  to: { before: string } | { after: string },
  context?: StorageContext,
): Promise<boolean> {
  return db.transaction('rw', db.listItems, async () => {
    const item = await getActive(db.listItems, itemId);
    const anchor = await getActive(db.listItems, 'before' in to ? to.before : to.after);
    if (!item || !anchor || item.listId !== anchor.listId || item.id === anchor.id) return false;

    const sequence = (await liveItems(db, item.listId)).filter(({ id }) => id !== item.id);
    const at = sequence.findIndex(({ id }) => id === anchor.id);
    sequence.splice('before' in to ? at : at + 1, 0, item);

    let moved = false;
    for (const [order, entry] of sequence.entries()) {
      if (entry.order === order) continue;
      await updateRecord(db.listItems, entry.id, { order }, context);
      moved = true;
    }
    return moved;
  });
}

/** Unchecks every item of a list ("start again"); returns how many changed. */
export function uncheckAll(
  db: PretometruDB,
  listId: string,
  context?: StorageContext,
): Promise<number> {
  return db.transaction('rw', db.listItems, async () => {
    const checked = (await liveItems(db, listId)).filter((item) => item.checked);
    for (const item of checked) {
      await updateRecord(db.listItems, item.id, { checked: false, checkedAt: undefined }, context);
    }
    return checked.length;
  });
}

/** Removes the checked items of a list (what was bought); returns how many went. */
export function removeCheckedItems(
  db: PretometruDB,
  listId: string,
  context?: StorageContext,
): Promise<number> {
  return db.transaction('rw', db.listItems, async () => {
    const checked = (await liveItems(db, listId)).filter((item) => item.checked);
    for (const item of checked) await softDelete(db.listItems, item.id, context);
    return checked.length;
  });
}
