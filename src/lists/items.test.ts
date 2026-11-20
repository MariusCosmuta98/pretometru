import { beforeEach, describe, expect, it } from 'vitest';
import { SEED_CATEGORIES, type List, type Product } from '@/domain';
import { createRecord, softDelete, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import {
  addProductToList,
  addTextItem,
  liveItems,
  moveItem,
  removeCheckedItems,
  removeItem,
  setItemChecked,
  uncheckAll,
  updateItem,
} from './items';
import { createList } from './lists';

const BASE = Date.UTC(2026, 10, 20, 10, 0, 0);
let db: PretometruDB;
let list: List;
let tick: number;
// A clock that moves one second per reading, so every write gets its own `updatedAt`.
const clock = { now: () => new Date(BASE + 1000 * tick++) };

const labels = async (listId = list.id) => (await liveItems(db, listId)).map((item) => item.label);

async function product(name = 'Lapte UHT'): Promise<Product> {
  return createRecord(db.products, { name, categoryId: SEED_CATEGORIES[0]!.id, baseUnit: 'l' });
}

beforeEach(async () => {
  db = await createTestDb();
  tick = 0;
  list = await createList(db, 'Cumpărături');
});

describe('addTextItem', () => {
  it('adds free-text items at the end, with a tidy label and nothing checked', async () => {
    const first = await addTextItem(db, list.id, '  Pâine   neagră ');
    const second = await addTextItem(db, list.id, 'Ouă');

    expect(first).toMatchObject({
      listId: list.id,
      label: 'Pâine neagră',
      checked: false,
      order: 0,
    });
    expect(first.productId).toBeUndefined();
    expect(second.order).toBe(1);
    expect(await labels()).toEqual(['Pâine neagră', 'Ouă']);
  });

  it('refuses an empty text and a list that does not exist', async () => {
    await expect(addTextItem(db, list.id, '  ')).rejects.toThrow(RangeError);
    await expect(addTextItem(db, 'missing', 'Pâine')).rejects.toThrow(RangeError);
    expect(await db.listItems.count()).toBe(0);
  });
});

describe('addProductToList', () => {
  it('puts a catalog product at the end of the list under its name', async () => {
    await addTextItem(db, list.id, 'Pâine');
    const milk = await product();

    const { item, status } = await addProductToList(db, list.id, milk.id);

    expect(status).toBe('added');
    expect(item).toMatchObject({
      productId: milk.id,
      label: 'Lapte UHT',
      checked: false,
      order: 1,
    });
  });

  it('does not add a product that is still to buy: it answers with the item that is there', async () => {
    const milk = await product();
    const first = await addProductToList(db, list.id, milk.id);

    const again = await addProductToList(db, list.id, milk.id);

    expect(again).toEqual({ item: first.item, status: 'already' });
    expect(await db.listItems.count()).toBe(1);
  });

  it('wants a checked product again: unchecked and moved to the end', async () => {
    const milk = await product();
    const { item } = await addProductToList(db, list.id, milk.id);
    await addTextItem(db, list.id, 'Pâine');
    await setItemChecked(db, item.id, true);

    const again = await addProductToList(db, list.id, milk.id);

    expect(again.status).toBe('reopened');
    expect(again.item).toMatchObject({ id: item.id, checked: false, order: 2 });
    expect(again.item.checkedAt).toBeUndefined();
    expect(await labels()).toEqual(['Pâine', 'Lapte UHT']);
  });

  it('keeps the same product on two lists apart', async () => {
    const milk = await product();
    const other = await createList(db, 'Altă listă');
    await addProductToList(db, list.id, milk.id);

    expect((await addProductToList(db, other.id, milk.id)).status).toBe('added');
  });

  it('refuses a product that does not exist or was deleted, and a missing list', async () => {
    const milk = await product();
    await softDelete(db.products, milk.id);

    await expect(addProductToList(db, list.id, milk.id)).rejects.toThrow(RangeError);
    await expect(addProductToList(db, list.id, 'missing')).rejects.toThrow(RangeError);
    await expect(addProductToList(db, 'missing', milk.id)).rejects.toThrow(RangeError);
    expect(await db.listItems.count()).toBe(0);
  });
});

describe('updateItem', () => {
  it('sets the quantity, the unit and a note, tidied', async () => {
    const { id } = await addTextItem(db, list.id, 'Banane');

    const item = await updateItem(db, id, { qty: 1.5, unit: 'kg', note: '  mai verzi  ' });

    expect(item).toMatchObject({ id, qty: 1.5, unit: 'kg', note: 'mai verzi', label: 'Banane' });
  });

  it('clears a field set to undefined and leaves the fields it does not mention alone', async () => {
    const { id } = await addTextItem(db, list.id, 'Banane');
    await updateItem(db, id, { qty: 2, unit: 'kg', note: 'verzi' });

    const item = await updateItem(db, id, { qty: undefined, note: '   ' });

    expect(item).toMatchObject({ unit: 'kg' });
    expect(item?.qty).toBeUndefined();
    expect(item?.note).toBeUndefined();
  });

  it('renames an item', async () => {
    const { id } = await addTextItem(db, list.id, 'Banane');
    expect((await updateItem(db, id, { label: ' Banane  bio ' }))?.label).toBe('Banane bio');
  });

  it.each([0, -1, 1.2345, 1_000_001, Number.NaN])('refuses the quantity %s', async (qty) => {
    const { id } = await addTextItem(db, list.id, 'Banane');
    await expect(updateItem(db, id, { qty })).rejects.toThrow(RangeError);
    expect((await db.listItems.get(id))?.qty).toBeUndefined();
  });

  it('refuses an empty label and answers undefined for an item that does not exist', async () => {
    const { id } = await addTextItem(db, list.id, 'Banane');
    await expect(updateItem(db, id, { label: ' ' })).rejects.toThrow(RangeError);
    expect(await updateItem(db, 'missing', { qty: 1 })).toBeUndefined();

    await removeItem(db, id);
    expect(await updateItem(db, id, { qty: 1 })).toBeUndefined();
  });
});

describe('setItemChecked', () => {
  it('checks at the current moment and clears the moment when unchecking', async () => {
    const { id } = await addTextItem(db, list.id, 'Pâine');

    const checked = await setItemChecked(db, id, true, clock);
    expect(checked).toMatchObject({ checked: true, checkedAt: '2026-11-20T10:00:00.000Z' });
    expect(checked?.updatedAt).toBe(checked?.checkedAt);

    const unchecked = await setItemChecked(db, id, false, clock);
    expect(unchecked?.checked).toBe(false);
    expect(unchecked?.checkedAt).toBeUndefined();
    expect(unchecked?.updatedAt).toBe('2026-11-20T10:00:01.000Z');
  });

  it('writes nothing when the item is already in the asked state', async () => {
    const { id } = await addTextItem(db, list.id, 'Pâine', clock);
    const checked = await setItemChecked(db, id, true, clock);

    expect(await setItemChecked(db, id, true, clock)).toEqual(checked);
    const unchecked = await setItemChecked(db, id, false, clock);
    expect(await setItemChecked(db, id, false, clock)).toEqual(unchecked);
  });

  it('answers undefined for an item that does not exist', async () => {
    expect(await setItemChecked(db, 'missing', true)).toBeUndefined();
  });
});

describe('removeItem', () => {
  it('leaves a tombstone and hides the item', async () => {
    const { id } = await addTextItem(db, list.id, 'Pâine');
    await addTextItem(db, list.id, 'Ouă');

    expect(await removeItem(db, id, clock)).toBe(true);

    expect(await labels()).toEqual(['Ouă']);
    expect((await db.listItems.get(id))?.deletedAt).toBe('2026-11-20T10:00:00.000Z');
    expect(await removeItem(db, id)).toBe(false);
  });

  it('numbers the next item after the highest one, so a removal leaves no clash', async () => {
    const first = await addTextItem(db, list.id, 'a');
    await addTextItem(db, list.id, 'b');
    await removeItem(db, first.id);

    expect((await addTextItem(db, list.id, 'c')).order).toBe(2);
  });
});

describe('moveItem', () => {
  let ids: Record<string, string>;

  beforeEach(async () => {
    ids = {};
    for (const label of ['a', 'b', 'c', 'd'])
      ids[label] = (await addTextItem(db, list.id, label)).id;
  });

  const orders = async () => (await liveItems(db, list.id)).map((item) => [item.label, item.order]);

  it('moves an item before another one and numbers the list again', async () => {
    expect(await moveItem(db, ids['d']!, { before: ids['b']! })).toBe(true);
    expect(await orders()).toEqual([
      ['a', 0],
      ['d', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('moves an item after another one', async () => {
    expect(await moveItem(db, ids['a']!, { after: ids['c']! })).toBe(true);
    expect(await orders()).toEqual([
      ['b', 0],
      ['c', 1],
      ['a', 2],
      ['d', 3],
    ]);
  });

  it('writes only the items whose position changed', async () => {
    const before = new Map(
      (await liveItems(db, list.id)).map((item) => [item.label, item.updatedAt]),
    );

    await moveItem(db, ids['c']!, { before: ids['b']! }, clock);

    const after = await liveItems(db, list.id);
    expect(after.map((item) => item.label)).toEqual(['a', 'c', 'b', 'd']);
    expect(
      after.filter((item) => item.updatedAt !== before.get(item.label)).map((i) => i.label),
    ).toEqual(['c', 'b']);
  });

  it('does nothing when the item is already there', async () => {
    expect(await moveItem(db, ids['b']!, { after: ids['a']! })).toBe(false);
    expect(await moveItem(db, ids['a']!, { before: ids['b']! })).toBe(false);
    expect(await orders()).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
      ['d', 3],
    ]);
  });

  it('copes with numbers that clash or have gaps, as two devices can leave them', async () => {
    await db.listItems.clear();
    const make = (label: string, order: number) =>
      createRecord(db.listItems, { listId: list.id, label, checked: false, order });
    const x = await make('x', 5);
    const y = await make('y', 5);
    const z = await make('z', 9);

    expect(await moveItem(db, z.id, { before: x.id })).toBe(true);
    expect(await orders()).toEqual([
      ['z', 0],
      ['x', 1],
      ['y', 2],
    ]);
    expect(await moveItem(db, z.id, { after: y.id })).toBe(true);
    expect(await orders()).toEqual([
      ['x', 0],
      ['y', 1],
      ['z', 2],
    ]);
  });

  it('refuses what makes no sense: unknown, deleted or foreign items, and itself', async () => {
    const other = await createList(db, 'Altă listă');
    const foreign = await addTextItem(db, other.id, 'străin');
    await removeItem(db, ids['d']!);

    expect(await moveItem(db, 'missing', { before: ids['a']! })).toBe(false);
    expect(await moveItem(db, ids['a']!, { before: 'missing' })).toBe(false);
    expect(await moveItem(db, ids['a']!, { before: foreign.id })).toBe(false);
    expect(await moveItem(db, ids['a']!, { after: ids['d']! })).toBe(false);
    expect(await moveItem(db, ids['a']!, { after: ids['a']! })).toBe(false);
    expect(await orders()).toEqual([
      ['a', 0],
      ['b', 1],
      ['c', 2],
    ]);
  });
});

describe('uncheckAll and removeCheckedItems', () => {
  async function checkedList() {
    const other = await createList(db, 'Altă listă');
    const stray = await addTextItem(db, other.id, 'străin');
    await setItemChecked(db, stray.id, true);
    for (const label of ['a', 'b', 'c']) {
      const { id } = await addTextItem(db, list.id, label);
      if (label !== 'b') await setItemChecked(db, id, true);
    }
    return { other, stray };
  }

  it('unchecks the whole list and nothing else', async () => {
    const { other } = await checkedList();

    expect(await uncheckAll(db, list.id)).toBe(2);

    const items = await liveItems(db, list.id);
    expect(items.every((item) => !item.checked && item.checkedAt === undefined)).toBe(true);
    expect((await liveItems(db, other.id)).map((item) => item.checked)).toEqual([true]);
    expect(await uncheckAll(db, list.id)).toBe(0);
  });

  it('removes what was bought and keeps the rest', async () => {
    const { other } = await checkedList();

    expect(await removeCheckedItems(db, list.id)).toBe(2);

    expect(await labels()).toEqual(['b']);
    expect(await labels(other.id)).toEqual(['străin']);
  });
});
