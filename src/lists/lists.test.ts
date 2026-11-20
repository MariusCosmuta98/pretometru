import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_CATEGORIES, type Product } from '@/domain';
import { createRecord, listActive, softDelete, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { addProductToList, addTextItem, liveItems, setItemChecked } from './items';
import {
  archiveList,
  createList,
  createListWithProduct,
  deleteList,
  renameList,
  restoreList,
} from './lists';
import { listOpenLists, loadListsOverview } from './queries';

const BASE = Date.UTC(2026, 10, 20, 10, 0, 0);
let db: PretometruDB;
let tick: number;
// A clock that moves one second per reading, so every write gets its own `updatedAt`.
const clock = { now: () => new Date(BASE + 1000 * tick++) };

async function product(name = 'Lapte UHT'): Promise<Product> {
  return createRecord(db.products, {
    name,
    categoryId: SEED_CATEGORIES[0]!.id,
    baseUnit: 'l',
  });
}

beforeEach(async () => {
  db = await createTestDb();
  tick = 0;
});

describe('createList and renameList', () => {
  it('creates an empty list with a tidy name', async () => {
    const list = await createList(db, '  Săptămâna   asta ', clock);

    expect(list).toMatchObject({ name: 'Săptămâna asta', updatedAt: '2026-11-20T10:00:00.000Z' });
    expect(list.archivedAt).toBeUndefined();
    expect(await listActive(db.lists)).toEqual([list]);
  });

  it('refuses an empty name', async () => {
    await expect(createList(db, '   ')).rejects.toThrow(RangeError);
    expect(await db.lists.count()).toBe(0);
  });

  it('renames a list and leaves it alone when the new name is empty', async () => {
    const list = await createList(db, 'Petrecere', clock);

    const renamed = await renameList(db, list.id, ' Aniversare ', clock);
    expect(renamed).toMatchObject({ name: 'Aniversare', updatedAt: '2026-11-20T10:00:01.000Z' });

    await expect(renameList(db, list.id, '')).rejects.toThrow(RangeError);
    expect((await db.lists.get(list.id))?.name).toBe('Aniversare');
  });

  it('answers undefined for a list that does not exist or was deleted', async () => {
    const list = await createList(db, 'Veche');
    await deleteList(db, list.id);

    expect(await renameList(db, list.id, 'Nouă')).toBeUndefined();
    expect(await renameList(db, 'missing', 'Nouă')).toBeUndefined();
  });
});

describe('archiveList and restoreList', () => {
  it('archives a list at the current moment and brings it back', async () => {
    const list = await createList(db, 'Weekend', clock);

    const archived = await archiveList(db, list.id, clock);
    expect(archived?.archivedAt).toBe('2026-11-20T10:00:01.000Z');
    expect(archived?.updatedAt).toBe(archived?.archivedAt);

    const restored = await restoreList(db, list.id, clock);
    expect(restored?.archivedAt).toBeUndefined();
    expect(restored?.updatedAt).toBe('2026-11-20T10:00:02.000Z');
    expect(restored).toMatchObject({ id: list.id, name: 'Weekend' });
  });

  it('writes nothing when the list is already in the asked state', async () => {
    const list = await createList(db, 'Weekend', clock);
    expect((await restoreList(db, list.id, clock))?.updatedAt).toBe(list.updatedAt);

    const archived = await archiveList(db, list.id, clock);
    expect(await archiveList(db, list.id, clock)).toEqual(archived);
  });

  it('answers undefined for a list that does not exist', async () => {
    expect(await archiveList(db, 'missing')).toBeUndefined();
    expect(await restoreList(db, 'missing')).toBeUndefined();
  });
});

describe('deleteList', () => {
  it('leaves tombstones for the list and its items, and only for them', async () => {
    const doomed = await createList(db, 'De șters', clock);
    const kept = await createList(db, 'De păstrat', clock);
    const milk = await product();
    await addProductToList(db, doomed.id, milk.id, clock);
    const bread = await addTextItem(db, doomed.id, 'Pâine', clock);
    await softDelete(db.listItems, bread.id, clock); // already gone: keeps its own tombstone
    await addTextItem(db, kept.id, 'Ouă', clock);

    expect(await deleteList(db, doomed.id, clock)).toBe(true);

    expect(await listActive(db.lists)).toMatchObject([{ id: kept.id }]);
    expect((await listActive(db.listItems)).map((item) => item.label)).toEqual(['Ouă']);
    const tombstones = await db.listItems.where('listId').equals(doomed.id).toArray();
    expect(tombstones).toHaveLength(2);
    expect(tombstones.every((item) => item.deletedAt !== undefined)).toBe(true);
    // the item removed earlier keeps the moment it was removed at
    expect((await db.listItems.get(bread.id))?.deletedAt).not.toBe(
      (await db.lists.get(doomed.id))?.deletedAt,
    );
  });

  it('gives the list and the items deleted with it the same moment', async () => {
    const list = await createList(db, 'Lista', clock);
    const item = await addTextItem(db, list.id, 'Pâine', clock);

    await deleteList(db, list.id, clock);

    const stamp = (await db.lists.get(list.id))?.deletedAt;
    expect(stamp).toBeDefined();
    expect(await db.listItems.get(item.id)).toMatchObject({ deletedAt: stamp, updatedAt: stamp });
  });

  it('says false for a list that is gone already', async () => {
    const list = await createList(db, 'Lista');
    expect(await deleteList(db, list.id)).toBe(true);
    expect(await deleteList(db, list.id)).toBe(false);
    expect(await deleteList(db, 'missing')).toBe(false);
  });
});

describe('createListWithProduct', () => {
  it('creates the list and puts the product on it, all or nothing', async () => {
    const milk = await product();

    const result = await createListWithProduct(db, ' Cumpărături ', milk.id, clock);

    expect(result).toMatchObject({ status: 'added', list: { name: 'Cumpărături' } });
    expect(result.item).toMatchObject({
      listId: result.list.id,
      productId: milk.id,
      label: 'Lapte UHT',
    });
    expect(await liveItems(db, result.list.id)).toEqual([result.item]);

    await expect(createListWithProduct(db, 'Alta', 'missing', clock)).rejects.toThrow(RangeError);
    await expect(createListWithProduct(db, ' ', milk.id, clock)).rejects.toThrow(RangeError);
    expect(await db.lists.count()).toBe(1);
  });
});

describe('the overview', () => {
  it('counts the items of every list and splits the archived ones off', async () => {
    const first = await createList(db, 'Prima');
    const second = await createList(db, 'A doua');
    const third = await createList(db, 'A treia');
    const gone = await createList(db, 'Ștearsă');
    for (const label of ['a', 'b', 'c']) await addTextItem(db, first.id, label);
    const done = await addTextItem(db, first.id, 'd');
    await setItemChecked(db, done.id, true);
    await addTextItem(db, second.id, 'x');
    await addTextItem(db, gone.id, 'y');
    await deleteList(db, gone.id);
    await archiveList(db, second.id, clock);
    await archiveList(db, third.id, clock);

    const { active, archived } = await loadListsOverview(db);

    expect(
      active.map(({ list, itemCount, checkedCount }) => [list.name, itemCount, checkedCount]),
    ).toEqual([['Prima', 4, 1]]);
    // the most recently archived list first
    expect(archived.map(({ list, itemCount }) => [list.name, itemCount])).toEqual([
      ['A treia', 0],
      ['A doua', 1],
    ]);
  });

  it('lists the newest list first', async () => {
    await createList(db, 'Veche');
    await createList(db, 'Nouă');
    expect((await loadListsOverview(db)).active.map(({ list }) => list.name)).toEqual([
      'Nouă',
      'Veche',
    ]);
  });

  it('offers a product only the lists that are in use', async () => {
    const used = await createList(db, 'În uz');
    const newer = await createList(db, 'Mai nouă');
    const old = await createList(db, 'Arhivată');
    await archiveList(db, old.id);

    expect((await listOpenLists(db)).map((list) => list.id)).toEqual([newer.id, used.id]);
  });
});
