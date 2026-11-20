import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { createRecord, ensureSeed, getActive, listActive } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { rememberMappings } from './aliases';
import { mergeProducts, splitProduct } from './merge';
import { suggestMappings } from './matching';
import { createProduct } from './products';
import { parsedReceipt, saveTestReceipt } from './testing';

const DAIRY = SEED_CATEGORIES[0]!.id;
const GROCERY = SEED_CATEGORIES[4]!.id;

async function setup() {
  const db = await createTestDb();
  await ensureSeed(db);
  const cream = await createProduct(db, {
    name: 'Smântână 30%',
    categoryId: DAIRY,
    baseUnit: 'kg',
    ean: '5941111111111',
  });
  const brand = await createProduct(db, {
    name: 'Smântână Napolact',
    categoryId: GROCERY,
    baseUnit: 'kg',
    ean: '5942222222222',
  });
  return { db, cream, brand };
}

const productOf = async (db: Awaited<ReturnType<typeof setup>>['db'], id: string) =>
  (await db.lines.get(id))?.productId;

describe('mergeProducts', () => {
  it('moves lines, aliases and list items to the target and deletes the duplicate', async () => {
    const { db, cream, brand } = await setup();
    const { lines } = await saveTestReceipt(db, {
      chain: 'kaufland',
      lines: [
        {
          rawName: 'SMANT NAPOLACT 400G',
          lineTotalBani: 899,
          productId: brand.id,
          categoryId: GROCERY,
        },
      ],
    });
    await rememberMappings(db, 'kaufland', [
      { rawName: 'SMANT NAPOLACT 400G', productId: brand.id },
    ]);
    const list = await createRecord(db.lists, { name: 'Săptămâna asta' });
    const item = await createRecord(db.listItems, {
      listId: list.id,
      productId: brand.id,
      label: 'Smântână',
      checked: false,
      order: 0,
    });

    const result = await mergeProducts(db, cream.id, [brand.id]);

    expect(result).toMatchObject({ product: { id: cream.id }, lines: 1, aliases: 1, listItems: 1 });
    const line = await db.lines.get(lines[0]!.id);
    expect(line).toMatchObject({ productId: cream.id, categoryId: DAIRY });
    expect((await db.listItems.get(item.id))?.productId).toBe(cream.id);
    expect(await getActive(db.products, brand.id)).toBeUndefined();
    expect((await db.products.get(brand.id))?.deletedAt).toBeDefined();

    // the next import of the printed name now lands on the survivor
    const [mapping] = await suggestMappings(
      db,
      parsedReceipt('kaufland', [{ rawName: 'SMANT NAPOLACT 400G' }]),
    );
    expect(mapping).toMatchObject({ productId: cream.id, via: 'alias' });
  });

  it("keeps the duplicate's EAN pointing at the survivor", async () => {
    const { db, cream, brand } = await setup();
    await mergeProducts(db, cream.id, [brand.id]);

    const [mapping] = await suggestMappings(
      db,
      parsedReceipt('lidl', [{ rawName: 'ORICE', ean: brand.ean }]),
    );
    expect(mapping).toMatchObject({ productId: cream.id, via: 'ean' });
    // ...without teaching any printed name: the EAN-only alias cannot match one
    expect(
      (await suggestMappings(db, parsedReceipt('lidl', [{ rawName: 'SMANTANA NAPOLACT' }])))[0]
        ?.via,
    ).not.toBe('alias');
  });

  it('merges several duplicates at once and ignores the target among them', async () => {
    const { db, cream, brand } = await setup();
    const third = await createProduct(db, {
      name: 'Smântână bio',
      categoryId: DAIRY,
      baseUnit: 'kg',
    });
    const result = await mergeProducts(db, cream.id, [brand.id, third.id, cream.id, brand.id]);

    expect((await listActive(db.products)).map((p) => p.id)).toEqual([cream.id]);
    expect(result.product.id).toBe(cream.id);
  });

  it('changes nothing for an unknown or already deleted product', async () => {
    const { db, cream, brand } = await setup();
    await mergeProducts(db, cream.id, [brand.id]);
    await expect(mergeProducts(db, cream.id, [brand.id])).rejects.toThrow(RangeError);
    await expect(mergeProducts(db, brand.id, [cream.id])).rejects.toThrow(RangeError);
    expect(await getActive(db.products, cream.id)).toBeDefined();
  });
});

describe('splitProduct', () => {
  async function twoBrands() {
    const { db, cream } = await setup();
    const kaufland = await saveTestReceipt(db, {
      chain: 'kaufland',
      lines: [
        { rawName: 'SMANTANA NAPOLACT 400G', lineTotalBani: 899, productId: cream.id },
        { rawName: 'SMANTANA HOCHLAND 400G', lineTotalBani: 1099, productId: cream.id },
      ],
    });
    const later = await saveTestReceipt(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-14T10:00',
      lines: [{ rawName: 'SMANTANA NAPOLACT 400G', lineTotalBani: 919, productId: cream.id }],
    });
    await rememberMappings(db, 'kaufland', [
      { rawName: 'SMANTANA NAPOLACT 400G', productId: cream.id },
      { rawName: 'SMANTANA HOCHLAND 400G', productId: cream.id },
    ]);
    return {
      db,
      cream,
      napolact: [kaufland.lines[0]!, later.lines[0]!],
      hochland: kaufland.lines[1]!,
    };
  }

  it('moves the chosen lines to a new product and takes their alias along', async () => {
    const { db, cream, napolact, hochland } = await twoBrands();

    const result = await splitProduct(db, cream.id, {
      lineIds: napolact.map((line) => line.id),
      target: { create: { name: 'Smântână Napolact', categoryId: DAIRY, baseUnit: 'kg' } },
    });

    expect(result).toMatchObject({ lines: 2, aliases: 1, product: { name: 'Smântână Napolact' } });
    expect(await productOf(db, napolact[0]!.id)).toBe(result.product.id);
    expect(await productOf(db, napolact[1]!.id)).toBe(result.product.id);
    expect(await productOf(db, hochland.id)).toBe(cream.id);

    const mappings = await suggestMappings(
      db,
      parsedReceipt('kaufland', [
        { rawName: 'SMANTANA NAPOLACT 400G' },
        { rawName: 'SMANTANA HOCHLAND 400G' },
      ]),
    );
    expect(mappings.map((m) => m.productId)).toEqual([result.product.id, cream.id]);
  });

  it('leaves an alias with the source while some of its lines stay behind', async () => {
    const { db, cream, napolact } = await twoBrands();
    const result = await splitProduct(db, cream.id, {
      lineIds: [napolact[0]!.id], // the 14.11 purchase of the same printed name stays
      target: { create: { name: 'Smântână Napolact', categoryId: DAIRY, baseUnit: 'kg' } },
    });

    expect(result.aliases).toBe(0);
    const [mapping] = await suggestMappings(
      db,
      parsedReceipt('kaufland', [{ rawName: 'SMANTANA NAPOLACT 400G' }]),
    );
    expect(mapping?.productId).toBe(cream.id);
  });

  it('can move lines to an existing product', async () => {
    const { db, cream, napolact } = await twoBrands();
    const other = await createProduct(db, {
      name: 'Smântână',
      categoryId: GROCERY,
      baseUnit: 'kg',
    });
    const result = await splitProduct(db, cream.id, {
      lineIds: napolact.map((line) => line.id),
      target: { productId: other.id },
    });

    expect(result.product.id).toBe(other.id);
    expect((await db.lines.get(napolact[0]!.id))?.categoryId).toBe(GROCERY);
  });

  it.each([
    ['an empty selection', () => []],
    ['a line of another product', (ids: { other: string }) => [ids.other]],
  ])('refuses %s and changes nothing', async (_label, pick) => {
    const { db, cream, napolact } = await twoBrands();
    const elsewhere = await createProduct(db, {
      name: 'Alt produs',
      categoryId: DAIRY,
      baseUnit: 'kg',
    });
    const stray = await saveTestReceipt(db, {
      chain: 'lidl',
      lines: [{ rawName: 'ALT PRODUS', lineTotalBani: 500, productId: elsewhere.id }],
    });

    await expect(
      splitProduct(db, cream.id, {
        lineIds: [...pick({ other: stray.lines[0]!.id }), ...[]],
        target: { create: { name: 'Nou', categoryId: DAIRY, baseUnit: 'kg' } },
      }),
    ).rejects.toThrow(RangeError);
    expect(await productOf(db, napolact[0]!.id)).toBe(cream.id);
    expect((await listActive(db.products)).map((p) => p.name)).not.toContain('Nou');
  });

  it('refuses to split a product into itself', async () => {
    const { db, cream, napolact } = await twoBrands();
    await expect(
      splitProduct(db, cream.id, { lineIds: [napolact[0]!.id], target: { productId: cream.id } }),
    ).rejects.toThrow(RangeError);
  });
});
