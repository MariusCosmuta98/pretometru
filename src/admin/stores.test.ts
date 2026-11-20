import { beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain';
import { getActive, type PretometruDB } from '@/storage';
import { deleteStore, isAdminError, listStores, mergeStores, renameStore } from '.';
import { addReceipt, addStore, seededTestDb } from './testing';

let db: PretometruDB;
beforeEach(async () => {
  db = await seededTestDb();
});

/** The code of the `AdminError` an action is refused with. */
async function refusal(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();
  } catch (error) {
    return isAdminError(error) ? error.code : `unexpected: ${String(error)}`;
  }
  return 'accepted';
}

const storeIdsOf = async (receiptIds: readonly string[]) =>
  Promise.all(receiptIds.map(async (id) => (await db.receipts.get(id))?.storeId));

describe('listStores', () => {
  it('lists the live stores by name with their live receipts, drafts included', async () => {
    const metro = await addStore(db, { chain: 'metro', name: 'METRO' });
    const cluj = await addStore(db, {
      name: 'Kaufland Cluj',
      branchCode: '1234',
      city: 'Cluj-Napoca',
    });
    const unused = await addStore(db, { chain: 'lidl', name: 'Lidl' });
    await addReceipt(db, cluj.id);
    await addReceipt(db, cluj.id, { status: 'draft' });
    const removed = await addReceipt(db, cluj.id);
    await db.receipts.update(removed.id, { deletedAt: '2026-11-20T10:00:00.000Z' });
    await addReceipt(db, metro.id);

    const rows = await listStores(db);

    expect(rows.map((row) => [row.store.name, row.receipts])).toEqual([
      ['Kaufland Cluj', 2],
      ['Lidl', 0],
      ['METRO', 1],
    ]);
    expect(rows[0]?.store).toMatchObject({
      chain: 'kaufland',
      branchCode: '1234',
      city: 'Cluj-Napoca',
    });
    expect(unused.id).toBe(rows[1]?.store.id);
  });

  it('leaves deleted stores out and sorts Romanian names the Romanian way', async () => {
    await addStore(db, { name: 'Țara' });
    await addStore(db, { name: 'Tigris' });
    await addStore(db, { name: 'Șeptilici' });
    await addStore(db, { name: 'Sora' });
    const gone = await addStore(db, { name: 'Dispărut' });
    await deleteStore(db, gone.id);

    expect((await listStores(db)).map((row) => row.store.name)).toEqual([
      'Sora',
      'Șeptilici',
      'Tigris',
      'Țara',
    ]);
  });
});

describe('renameStore', () => {
  it('changes only the name, tidied, and keeps what identifies the store for the importer', async () => {
    const store = await addStore(db, { name: 'Kaufland', branchCode: '1234', city: 'Cluj-Napoca' });

    const renamed = await renameStore(db, store.id, '  Kaufland   Mărăști ');

    expect(renamed).toMatchObject({
      id: store.id,
      name: 'Kaufland Mărăști',
      chain: 'kaufland',
      branchCode: '1234',
      city: 'Cluj-Napoca',
    });
    expect((await getActive(db.stores, store.id))?.updatedAt).toBe(renamed.updatedAt);
  });

  it('writes nothing when the name stays the same', async () => {
    const store = await addStore(db, { name: 'Kaufland' });

    const same = await renameStore(db, store.id, ' Kaufland ');

    expect(same).toEqual(store);
    expect(await db.stores.get(store.id)).toEqual(store);
  });

  it('refuses an empty name and an unknown or deleted store', async () => {
    const store = await addStore(db);
    const gone = await addStore(db, { name: 'Vechi' });
    await deleteStore(db, gone.id);

    expect(await refusal(() => renameStore(db, store.id, '   '))).toBe('EMPTY_NAME');
    expect(await refusal(() => renameStore(db, newId(), 'Nou'))).toBe('NOT_FOUND');
    expect(await refusal(() => renameStore(db, gone.id, 'Nou'))).toBe('NOT_FOUND');
    expect((await getActive(db.stores, store.id))?.name).toBe('Kaufland');
  });
});

describe('mergeStores', () => {
  async function twoKauflands() {
    const keep = await addStore(db, { name: 'Kaufland Cluj', branchCode: '1234' });
    const duplicate = await addStore(db, { name: 'Kaufland', chain: 'unknown' });
    const kept = [await addReceipt(db, keep.id), await addReceipt(db, keep.id)];
    const moving = [
      await addReceipt(db, duplicate.id),
      await addReceipt(db, duplicate.id, { status: 'draft' }),
    ];
    return { keep, duplicate, kept, moving };
  }

  it('moves the receipts to the kept store and tombstones the other one', async () => {
    const { keep, duplicate, kept, moving } = await twoKauflands();

    const result = await mergeStores(db, keep.id, duplicate.id);

    expect(result.receipts).toBe(2);
    expect(result.store.id).toBe(keep.id);
    expect(result.merged.id).toBe(duplicate.id);
    expect(await storeIdsOf(moving.map((receipt) => receipt.id))).toEqual([keep.id, keep.id]);
    expect(await storeIdsOf(kept.map((receipt) => receipt.id))).toEqual([keep.id, keep.id]);
    expect(await getActive(db.stores, duplicate.id)).toBeUndefined();
    expect((await db.stores.get(duplicate.id))?.deletedAt).toBeDefined();
    expect(await db.stores.get(keep.id)).toEqual(keep);
    expect((await listStores(db)).map((row) => [row.store.id, row.receipts])).toEqual([
      [keep.id, 4],
    ]);
  });

  it('moves only the receipts, leaving their lines and the rest of each receipt as they were', async () => {
    const { keep, duplicate, moving } = await twoKauflands();
    const before = await db.receipts.get(moving[0]!.id);
    const linesBefore = await db.lines.where('receiptId').equals(moving[0]!.id).toArray();

    await mergeStores(db, keep.id, duplicate.id);

    const after = await db.receipts.get(moving[0]!.id);
    expect({ ...after, storeId: undefined, updatedAt: undefined }).toEqual({
      ...before,
      storeId: undefined,
      updatedAt: undefined,
    });
    expect(after?.linesUpdatedAt).toBe(before?.linesUpdatedAt);
    expect(await db.lines.where('receiptId').equals(moving[0]!.id).toArray()).toEqual(linesBefore);
  });

  it('leaves the deleted receipts of the other store where they are', async () => {
    const { keep, duplicate } = await twoKauflands();
    const removed = await addReceipt(db, duplicate.id);
    await db.receipts.update(removed.id, { deletedAt: '2026-11-20T10:00:00.000Z' });

    const result = await mergeStores(db, keep.id, duplicate.id);

    expect(result.receipts).toBe(2);
    expect((await db.receipts.get(removed.id))?.storeId).toBe(duplicate.id);
  });

  it('merges a store without receipts too', async () => {
    const keep = await addStore(db);
    const empty = await addStore(db, { name: 'Gol' });

    expect((await mergeStores(db, keep.id, empty.id)).receipts).toBe(0);
    expect(await getActive(db.stores, empty.id)).toBeUndefined();
  });

  it('refuses a store merged into itself, and an unknown or deleted one, changing nothing', async () => {
    const { keep, duplicate, moving } = await twoKauflands();
    const gone = await addStore(db, { name: 'Vechi' });
    await deleteStore(db, gone.id);

    expect(await refusal(() => mergeStores(db, keep.id, keep.id))).toBe('SAME_STORE');
    expect(await refusal(() => mergeStores(db, keep.id, newId()))).toBe('NOT_FOUND');
    expect(await refusal(() => mergeStores(db, newId(), duplicate.id))).toBe('NOT_FOUND');
    expect(await refusal(() => mergeStores(db, gone.id, duplicate.id))).toBe('NOT_FOUND');
    expect(await refusal(() => mergeStores(db, keep.id, gone.id))).toBe('NOT_FOUND');

    expect(await getActive(db.stores, duplicate.id)).toBeDefined();
    expect(await storeIdsOf(moving.map((receipt) => receipt.id))).toEqual([
      duplicate.id,
      duplicate.id,
    ]);
  });

  it('is all or nothing: a receipt that cannot be saved stops the merge', async () => {
    const { keep, duplicate, moving } = await twoKauflands();
    // A record that no longer satisfies its schema, sorted after the valid ones.
    await db.receipts.put({
      ...moving[0]!,
      id: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      docType: 'nonsense' as never,
    });

    await expect(mergeStores(db, keep.id, duplicate.id)).rejects.toThrow();

    expect(await storeIdsOf(moving.map((receipt) => receipt.id))).toEqual([
      duplicate.id,
      duplicate.id,
    ]);
    expect(await getActive(db.stores, duplicate.id)).toBeDefined();
  });
});

describe('deleteStore', () => {
  it('deletes a store that has no receipts, leaving a tombstone', async () => {
    const store = await addStore(db, { name: 'Gol' });

    const deleted = await deleteStore(db, store.id);

    expect(deleted.id).toBe(store.id);
    expect(await getActive(db.stores, store.id)).toBeUndefined();
    expect((await db.stores.get(store.id))?.deletedAt).toBeDefined();
  });

  it('refuses a store with receipts (drafts included) and changes nothing', async () => {
    const store = await addStore(db);
    await addReceipt(db, store.id, { status: 'draft' });

    expect(await refusal(() => deleteStore(db, store.id))).toBe('HAS_RECEIPTS');

    expect(await getActive(db.stores, store.id)).toBeDefined();
  });

  it('does not count deleted receipts', async () => {
    const store = await addStore(db);
    const removed = await addReceipt(db, store.id);
    await db.receipts.update(removed.id, { deletedAt: '2026-11-20T10:00:00.000Z' });

    await deleteStore(db, store.id);

    expect(await getActive(db.stores, store.id)).toBeUndefined();
  });

  it('refuses an unknown or already deleted store', async () => {
    const store = await addStore(db);
    await deleteStore(db, store.id);

    expect(await refusal(() => deleteStore(db, store.id))).toBe('NOT_FOUND');
    expect(await refusal(() => deleteStore(db, newId()))).toBe('NOT_FOUND');
  });
});
