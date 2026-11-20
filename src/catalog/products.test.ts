import { describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID, SEED_CATEGORIES } from '@/domain';
import { ensureSeed, softDelete } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { createProduct, searchProducts } from './products';

const DAIRY = SEED_CATEGORIES[0]!.id;
const GROCERY = SEED_CATEGORIES[4]!.id;

async function seededDb() {
  const db = await createTestDb();
  await ensureSeed(db);
  return db;
}

describe('createProduct', () => {
  it('stores a tidy product with an id and returns it', async () => {
    const db = await seededDb();
    const product = await createProduct(db, {
      name: '  Smântână   30% ',
      brand: ' Napolact ',
      categoryId: DAIRY,
      ean: '5941234567890',
      baseUnit: 'kg',
    });

    expect(product).toMatchObject({
      name: 'Smântână 30%',
      brand: 'Napolact',
      categoryId: DAIRY,
      ean: '5941234567890',
      baseUnit: 'kg',
    });
    expect(await db.products.get(product.id)).toEqual(product);
  });

  it('omits an empty brand instead of storing an empty string', async () => {
    const db = await seededDb();
    const product = await createProduct(db, {
      name: 'Pâine',
      brand: '  ',
      categoryId: GROCERY,
      baseUnit: 'buc',
    });
    expect(Object.keys(product)).not.toContain('brand');
  });

  it('lets the user keep two products with the same name', async () => {
    const db = await seededDb();
    const input = { name: 'Lapte', categoryId: DAIRY, baseUnit: 'l' as const };
    const [a, b] = [await createProduct(db, input), await createProduct(db, input)];
    expect(a.id).not.toBe(b.id);
  });

  it.each([
    ['an empty name', { name: '   ', categoryId: DAIRY }],
    ['an unknown category', { name: 'Lapte', categoryId: '0000000000SEEDCATEG9999999' }],
    ['the Non-produs category', { name: 'Lapte', categoryId: NON_PRODUCT_CATEGORY_ID }],
  ])('refuses %s and stores nothing', async (_label, input) => {
    const db = await seededDb();
    await expect(createProduct(db, { ...input, baseUnit: 'l' })).rejects.toThrow(RangeError);
    expect(await db.products.count()).toBe(0);
  });

  it('refuses a deleted category', async () => {
    const db = await seededDb();
    await softDelete(db.categories, DAIRY);
    await expect(
      createProduct(db, { name: 'Lapte', categoryId: DAIRY, baseUnit: 'l' }),
    ).rejects.toThrow(RangeError);
  });
});

describe('searchProducts', () => {
  async function catalog() {
    const db = await seededDb();
    const make = (name: string, extra: { brand?: string; ean?: string } = {}) =>
      createProduct(db, { name, categoryId: GROCERY, baseUnit: 'kg', ...extra });
    const cream = await make('Smântână 30%', { brand: 'Napolact' });
    const sourCream = await make('Smântână pentru gătit');
    const milk = await make('Lapte UHT 1,5%', { ean: '5941234567890' });
    const butter = await make('Unt 82%');
    return { db, cream, sourCream, milk, butter };
  }

  it('ignores diacritics, case and punctuation, and finds by brand', async () => {
    const { db, cream } = await catalog();
    expect((await searchProducts(db, 'SMANTANA 30'))[0]).toEqual(cream);
    expect((await searchProducts(db, 'napolact'))[0]).toEqual(cream);
    expect((await searchProducts(db, 'lapte uht 1,5')).map((p) => p.name)).toEqual([
      'Lapte UHT 1,5%',
    ]);
  });

  it('matches word prefixes while typing and ranks the shorter, closer name first', async () => {
    const { db } = await catalog();
    expect((await searchProducts(db, 'smant')).map((p) => p.name)).toEqual([
      'Smântână 30%',
      'Smântână pentru gătit',
    ]);
    expect((await searchProducts(db, 'gatit')).map((p) => p.name)).toEqual([
      'Smântână pentru gătit',
    ]);
  });

  it('finds a product by the start of its EAN', async () => {
    const { db, milk } = await catalog();
    expect(await searchProducts(db, '59412345')).toEqual([milk]);
  });

  it('lists everything by name for an empty query, honours the limit and skips deleted products', async () => {
    const { db, butter } = await catalog();
    expect((await searchProducts(db, '')).map((p) => p.name)).toEqual([
      'Lapte UHT 1,5%',
      'Smântână 30%',
      'Smântână pentru gătit',
      'Unt 82%',
    ]);
    expect(await searchProducts(db, '', 2)).toHaveLength(2);

    await softDelete(db.products, butter.id);
    expect(await searchProducts(db, 'unt')).toEqual([]);
  });

  it('returns nothing for a query that matches nothing', async () => {
    const { db } = await catalog();
    expect(await searchProducts(db, 'xyz')).toEqual([]);
  });
});
