import { beforeEach, describe, expect, it } from 'vitest';
import { newId, SEED_CATEGORIES, SEED_UPDATED_AT } from '@/domain';
import { createRecord, ensureSeed, getActive, purgeTombstones, type PretometruDB } from '@/storage';
import {
  addCategory,
  deleteCategory,
  isAdminError,
  listCategories,
  moveCategory,
  updateCategory,
} from '.';
import { addProduct, addReceipt, addStore, SEED, seededTestDb } from './testing';

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

const names = async () => (await listCategories(db)).map((row) => row.category.name);

describe('listCategories', () => {
  it('lists the live categories in the user order, the system one last', async () => {
    const rows = await listCategories(db);

    expect(rows.map((row) => row.category.name)).toEqual(SEED_CATEGORIES.map((c) => c.name));
    expect(rows.filter((row) => row.system).map((row) => row.category.name)).toEqual([
      'Non-produs',
    ]);
    expect(rows.at(-1)?.system).toBe(true);
  });

  it('counts the live products and lines that use each category', async () => {
    const milk = await addProduct(db, 'Lapte', SEED.dairy.id);
    const eggs = await addProduct(db, 'Ouă', SEED.dairy.id);
    await db.products.update(eggs.id, { deletedAt: '2026-11-20T10:00:00.000Z' });
    const store = await addStore(db);
    await addReceipt(db, store.id, {
      lines: [
        { productId: milk.id, categoryId: SEED.dairy.id },
        { categoryId: SEED.dairy.id },
        { categoryId: SEED.meat.id },
      ],
    });

    const rows = await listCategories(db);
    const dairy = rows.find((row) => row.category.id === SEED.dairy.id);
    expect([dairy?.products, dairy?.lines]).toEqual([1, 2]);
    expect(rows.find((row) => row.category.id === SEED.meat.id)?.lines).toBe(1);
  });

  it('follows the order numbers, then the name, and leaves deleted categories out', async () => {
    const first = await createRecord(db.categories, {
      name: 'Ceaiuri',
      color: '#22c55e',
      icon: '🍵',
      order: 1,
    });
    const gone = await addCategory(db, { name: 'Dispărută', icon: '🫥', color: '#000000' });
    await deleteCategory(db, gone.id);

    expect((await names())[0]).toBe('Ceaiuri');
    expect(await names()).not.toContain('Dispărută');
    expect((await listCategories(db))[0]?.category.id).toBe(first.id);
  });
});

describe('addCategory', () => {
  it('adds the category after the last one, with a tidy name and a lower-case colour', async () => {
    const added = await addCategory(db, {
      name: '  Dulciuri   de casă ',
      icon: ' 🍰 ',
      color: '#FFAA00',
    });

    expect(added).toMatchObject({
      name: 'Dulciuri de casă',
      icon: '🍰',
      color: '#ffaa00',
      order: 160,
    });
    const rows = await names();
    expect(rows.at(-2)).toBe('Dulciuri de casă');
    expect(rows.at(-1)).toBe('Non-produs');
  });

  it.each([
    ['an empty name', { name: '   ' }, 'EMPTY_NAME'],
    [
      'a name that exists in another case and without diacritics',
      { name: 'bauturi ALCOOLICE' },
      'DUPLICATE_NAME',
    ],
    ['the name of the system category', { name: 'non-produs' }, 'DUPLICATE_NAME'],
    ['text instead of an emoji', { icon: 'ab' }, 'INVALID_ICON'],
    ['an empty icon', { icon: '' }, 'INVALID_ICON'],
    ['two emoji', { icon: '🥛🥛' }, 'INVALID_ICON'],
    ['a colour name', { color: 'red' }, 'INVALID_COLOR'],
    ['a short hex colour', { color: '#fa0' }, 'INVALID_COLOR'],
  ])('refuses %s and adds nothing', async (_what, input, code) => {
    const before = (await listCategories(db)).length;

    expect(
      await refusal(() =>
        addCategory(db, { name: 'Nouă', icon: '🍰', color: '#112233', ...input }),
      ),
    ).toBe(code);

    expect((await listCategories(db)).length).toBe(before);
  });

  it.each([['🇷🇴'], ['👨‍👩‍👧'], ['1️⃣'], ['❤️'], ['🏷️']])('accepts %s as one emoji', async (icon) => {
    expect((await addCategory(db, { name: `Cu ${icon}`, icon, color: '#112233' })).icon).toBe(icon);
  });
});

describe('updateCategory', () => {
  it('renames, recolours and re-icons a built-in category, and the edit beats the seed', async () => {
    const edited = await updateCategory(db, SEED.grocery.id, {
      name: ' Alimente de bază ',
      color: '#0EA5E9',
      icon: '🥣',
    });
    await ensureSeed(db);

    const stored = await getActive(db.categories, SEED.grocery.id);
    expect(stored).toMatchObject({
      name: 'Alimente de bază',
      color: '#0ea5e9',
      icon: '🥣',
      order: 50,
    });
    expect(stored?.updatedAt).toBe(edited.updatedAt);
    expect(edited.updatedAt > SEED_UPDATED_AT).toBe(true);
  });

  it('writes nothing when nothing changes', async () => {
    const before = await getActive(db.categories, SEED.dairy.id);

    await updateCategory(db, SEED.dairy.id, {
      name: SEED.dairy.name,
      icon: SEED.dairy.icon,
      color: SEED.dairy.color.toUpperCase(),
    });

    expect(await getActive(db.categories, SEED.dairy.id)).toEqual(before);
  });

  it('lets a category change the case of its own name but not take another one’s', async () => {
    await updateCategory(db, SEED.dairy.id, { name: 'lactate & OUA' });
    expect((await getActive(db.categories, SEED.dairy.id))?.name).toBe('lactate & OUA');

    expect(await refusal(() => updateCategory(db, SEED.dairy.id, { name: 'Bacanie' }))).toBe(
      'DUPLICATE_NAME',
    );
    expect(await refusal(() => updateCategory(db, SEED.dairy.id, { name: ' ' }))).toBe(
      'EMPTY_NAME',
    );
  });

  it('keeps the system category’s name, but may recolour it', async () => {
    expect(await refusal(() => updateCategory(db, SEED.nonProduct.id, { name: 'Altceva' }))).toBe(
      'SYSTEM_CATEGORY',
    );
    expect(await refusal(() => updateCategory(db, SEED.nonProduct.id, { name: ' ' }))).toBe(
      'SYSTEM_CATEGORY',
    );
    expect(await names()).toContain('Non-produs');

    const recoloured = await updateCategory(db, SEED.nonProduct.id, {
      color: '#111111',
      name: 'Non-produs',
    });
    expect(recoloured).toMatchObject({ color: '#111111', name: 'Non-produs', system: true });
  });

  it('refuses an unknown or deleted category', async () => {
    const gone = await addCategory(db, { name: 'Trecută', icon: '🍰', color: '#112233' });
    await deleteCategory(db, gone.id);

    expect(await refusal(() => updateCategory(db, gone.id, { name: 'X' }))).toBe('NOT_FOUND');
    expect(await refusal(() => updateCategory(db, newId(), { name: 'X' }))).toBe('NOT_FOUND');
  });
});

describe('moveCategory', () => {
  it('swaps a category with its neighbour and only writes the two that changed', async () => {
    expect(await moveCategory(db, SEED.grocery.id, 'up')).toBe(true);

    const order = (await names()).slice(0, 6);
    expect(order).toEqual([
      'Lactate & ouă',
      'Carne & mezeluri',
      'Fructe & legume',
      'Bacanie',
      'Panificație & cereale',
      'Snacks & dulciuri',
    ]);
    expect((await getActive(db.categories, SEED.grocery.id))?.order).toBe(40);
    expect((await getActive(db.categories, SEED.dairy.id))?.updatedAt).toBe(SEED_UPDATED_AT);

    expect(await moveCategory(db, SEED.grocery.id, 'down')).toBe(true);
    expect((await names()).slice(0, 5)).toEqual(SEED_CATEGORIES.slice(0, 5).map((c) => c.name));
  });

  it('does nothing at either end, and the system category cannot move', async () => {
    expect(await moveCategory(db, SEED.dairy.id, 'up')).toBe(false);
    expect(await moveCategory(db, SEED.other.id, 'down')).toBe(false);
    expect(await refusal(() => moveCategory(db, SEED.nonProduct.id, 'up'))).toBe('SYSTEM_CATEGORY');
    expect(await refusal(() => moveCategory(db, newId(), 'up'))).toBe('NOT_FOUND');
    expect((await names()).at(-1)).toBe('Non-produs');
  });

  it('numbers categories that two devices gave the same order apart again', async () => {
    const a = await createRecord(db.categories, {
      name: 'Alfa',
      color: '#112233',
      icon: '🅰️',
      order: 500,
    });
    const b = await createRecord(db.categories, {
      name: 'Beta',
      color: '#112233',
      icon: '🅱️',
      order: 500,
    });

    expect(await moveCategory(db, b.id, 'up')).toBe(true);

    const rows = await listCategories(db);
    const tail = rows.slice(-3).map((row) => row.category.name);
    expect(tail).toEqual(['Beta', 'Alfa', 'Non-produs']);
    expect(rows.map((row) => row.category.order).slice(0, -1)).toEqual(
      Array.from({ length: rows.length - 1 }, (_, i) => (i + 1) * 10),
    );
    expect(a.id).not.toBe(b.id);
  });
});

describe('deleteCategory', () => {
  async function usedGrocery() {
    const store = await addStore(db);
    const rice = await addProduct(db, 'Orez', SEED.grocery.id);
    const flour = await addProduct(db, 'Făină', SEED.grocery.id);
    const unrelated = await addProduct(db, 'Lapte', SEED.dairy.id);
    const receipt = await addReceipt(db, store.id, {
      lines: [
        { productId: rice.id, categoryId: SEED.grocery.id },
        { categoryId: SEED.grocery.id },
        { productId: unrelated.id, categoryId: SEED.dairy.id },
      ],
    });
    return { rice, flour, unrelated, receipt };
  }

  it('moves its products and lines to the chosen category and leaves a tombstone', async () => {
    const { rice, flour, unrelated, receipt } = await usedGrocery();

    const result = await deleteCategory(db, SEED.grocery.id, { reassignTo: SEED.household.id });

    expect([result.products, result.lines, result.children]).toEqual([2, 2, 0]);
    expect(result.reassignedTo?.id).toBe(SEED.household.id);
    expect((await db.products.get(rice.id))?.categoryId).toBe(SEED.household.id);
    expect((await db.products.get(flour.id))?.categoryId).toBe(SEED.household.id);
    expect((await db.products.get(unrelated.id))?.categoryId).toBe(SEED.dairy.id);
    const lines = await db.lines.where('receiptId').equals(receipt.id).sortBy('idx');
    expect(lines.map((line) => line.categoryId)).toEqual([
      SEED.household.id,
      SEED.household.id,
      SEED.dairy.id,
    ]);
    expect(await getActive(db.categories, SEED.grocery.id)).toBeUndefined();
    expect((await db.categories.get(SEED.grocery.id))?.deletedAt).toBeDefined();
    expect(await names()).not.toContain('Bacanie');
  });

  it('leaves deleted products and lines alone', async () => {
    const dead = await addProduct(db, 'Vechi', SEED.grocery.id);
    await db.products.update(dead.id, { deletedAt: '2026-11-01T10:00:00.000Z' });

    const result = await deleteCategory(db, SEED.grocery.id);

    expect(result.products).toBe(0);
    expect((await db.products.get(dead.id))?.categoryId).toBe(SEED.grocery.id);
  });

  it('wants a category to move to while anything uses it, and then changes nothing', async () => {
    const { rice } = await usedGrocery();

    expect(await refusal(() => deleteCategory(db, SEED.grocery.id))).toBe('TARGET_REQUIRED');

    expect(await getActive(db.categories, SEED.grocery.id)).toBeDefined();
    expect((await db.products.get(rice.id))?.categoryId).toBe(SEED.grocery.id);
  });

  it('refuses a target that is missing, deleted, the system category or the category itself', async () => {
    const { rice } = await usedGrocery();
    const gone = await addCategory(db, { name: 'Trecută', icon: '🍰', color: '#112233' });
    await deleteCategory(db, gone.id);

    for (const reassignTo of [newId(), gone.id, SEED.nonProduct.id, SEED.grocery.id]) {
      expect(await refusal(() => deleteCategory(db, SEED.grocery.id, { reassignTo }))).toBe(
        'INVALID_TARGET',
      );
    }
    expect(await getActive(db.categories, SEED.grocery.id)).toBeDefined();
    expect((await db.products.get(rice.id))?.categoryId).toBe(SEED.grocery.id);
  });

  it('deletes a category nothing uses without asking for a target', async () => {
    const result = await deleteCategory(db, SEED.other.id);

    expect(result).toMatchObject({ products: 0, lines: 0, reassignedTo: undefined });
    expect(await names()).not.toContain('Altele');
  });

  it('never deletes the system category', async () => {
    expect(await refusal(() => deleteCategory(db, SEED.nonProduct.id))).toBe('SYSTEM_CATEGORY');
    expect(
      await refusal(() => deleteCategory(db, SEED.nonProduct.id, { reassignTo: SEED.other.id })),
    ).toBe('SYSTEM_CATEGORY');

    await db.categories.update(SEED.nonProduct.id, { system: undefined });
    expect(await refusal(() => deleteCategory(db, SEED.nonProduct.id))).toBe('SYSTEM_CATEGORY');
    expect(await getActive(db.categories, SEED.nonProduct.id)).toBeDefined();
  });

  it('refuses an unknown or already deleted category', async () => {
    await deleteCategory(db, SEED.other.id);

    expect(await refusal(() => deleteCategory(db, SEED.other.id))).toBe('NOT_FOUND');
    expect(await refusal(() => deleteCategory(db, newId()))).toBe('NOT_FOUND');
  });

  it('is not brought back by the seed, and its tombstone survives purging', async () => {
    await deleteCategory(db, SEED.other.id);

    await ensureSeed(db);
    await purgeTombstones(db.categories, new Date('2100-01-01T00:00:00Z'));
    await ensureSeed(db);

    expect(await getActive(db.categories, SEED.other.id)).toBeUndefined();
    expect((await db.categories.get(SEED.other.id))?.deletedAt).toBeDefined();
  });

  it('hangs the sub-categories from the deleted category’s own parent', async () => {
    const make = (name: string, parentId?: string) =>
      createRecord(db.categories, {
        name,
        color: '#112233',
        icon: '🍰',
        order: 900,
        ...(parentId ? { parentId } : {}),
      });
    const parent = await make('Părinte', SEED.dairy.id);
    const child = await make('Copil', parent.id);

    const result = await deleteCategory(db, parent.id);

    expect(result.children).toBe(1);
    expect((await db.categories.get(child.id))?.parentId).toBe(SEED.dairy.id);
    await deleteCategory(db, SEED.dairy.id);
    expect((await db.categories.get(child.id))?.parentId).toBeUndefined();
  });

  it('is all or nothing: a product that cannot be saved stops the whole deletion', async () => {
    const { rice } = await usedGrocery();
    // A record that no longer satisfies its schema, sorted after the valid ones.
    await db.products.put({
      id: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      updatedAt: '2026-11-01T10:00:00.000Z',
      name: '',
      categoryId: SEED.grocery.id,
      baseUnit: 'buc',
    });

    await expect(
      deleteCategory(db, SEED.grocery.id, { reassignTo: SEED.household.id }),
    ).rejects.toThrow();

    expect((await db.products.get(rice.id))?.categoryId).toBe(SEED.grocery.id);
    expect(await getActive(db.categories, SEED.grocery.id)).toBeDefined();
  });
});
