import { describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID, SEED_CATEGORIES } from '@/domain';
import { createRecord, ensureSeed, softDelete } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { rememberMappings } from './aliases';
import { suggestMappings } from './matching';
import { createProduct } from './products';
import { parsedReceipt } from './testing';

const DAIRY = SEED_CATEGORIES[0]!.id;
const GROCERY = SEED_CATEGORIES[4]!.id;

async function setup() {
  const db = await createTestDb();
  await ensureSeed(db);
  const milk = await createProduct(db, {
    name: 'Lapte UHT 1,5%',
    categoryId: DAIRY,
    baseUnit: 'l',
  });
  return { db, milk };
}

describe('suggestMappings', () => {
  it('returns one mapping per line, in order, and nothing for an empty receipt', async () => {
    const { db } = await setup();
    expect(await suggestMappings(db, parsedReceipt('kaufland', []))).toEqual([]);

    const mappings = await suggestMappings(
      db,
      parsedReceipt('kaufland', [{ rawName: 'PAINE' }, { rawName: 'APA' }, { rawName: 'OUA' }]),
    );
    expect(mappings).toHaveLength(3);
  });

  describe('alias', () => {
    it('assigns the remembered product for the same chain and printed name', async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'kaufland', [
        { rawName: 'LAPTE UHT 1,5% 1L', productId: milk.id },
      ]);

      // Case, spacing and punctuation do not matter: both normalise to "lapte uht 1.5 1l".
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('kaufland', [{ rawName: 'Lapte UHT 1.5% 1 L' }]),
      );

      expect(mapping).toEqual({
        productId: milk.id,
        categoryId: DAIRY,
        via: 'alias',
        candidates: [{ product: milk, score: 1 }],
      });
    });

    it("does not assign another chain's alias, but offers its product as a candidate", async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'kaufland', [{ rawName: 'LAPTE UHT 1L', productId: milk.id }]);

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('lidl', [{ rawName: 'LAPTE UHT 1L' }]),
      );
      expect(mapping?.productId).toBeUndefined();
      expect(mapping?.via).toBe('fuzzy');
      expect(mapping?.candidates.map((c) => c.product.id)).toEqual([milk.id]);
    });

    it('applies an alias without a chain to every chain, but prefers the chain-specific one', async () => {
      const { db, milk } = await setup();
      const cream = await createProduct(db, {
        name: 'Smântână',
        categoryId: DAIRY,
        baseUnit: 'kg',
      });
      await createRecord(db.aliases, { normName: 'lapte uht 1l', productId: milk.id });
      await rememberMappings(db, 'lidl', [{ rawName: 'LAPTE UHT 1L', productId: cream.id }]);

      const [mega] = await suggestMappings(
        db,
        parsedReceipt('mega-image', [{ rawName: 'LAPTE UHT 1L' }]),
      );
      const [lidl] = await suggestMappings(
        db,
        parsedReceipt('lidl', [{ rawName: 'LAPTE UHT 1L' }]),
      );
      expect(mega?.productId).toBe(milk.id);
      expect(lidl?.productId).toBe(cream.id);
    });

    it('ignores an alias whose product was deleted', async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'kaufland', [{ rawName: 'LAPTE', productId: milk.id }]);
      await softDelete(db.products, milk.id);

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('kaufland', [{ rawName: 'LAPTE' }]),
      );
      expect(mapping?.via).toBe('none');
    });

    it('does not assign an alias remembered for the "unknown" chain: that is any shop nobody recognised', async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'unknown', [{ rawName: 'LAPTE UHT 1L', productId: milk.id }]);

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('unknown', [{ rawName: 'LAPTE UHT 1L' }]),
      );
      expect(mapping?.productId).toBeUndefined();
      expect(mapping?.via).toBe('fuzzy');
      expect(mapping?.candidates.map((c) => c.product.id)).toEqual([milk.id]);
    });

    it('wins over an EAN match', async () => {
      const { db, milk } = await setup();
      const other = await createProduct(db, {
        name: 'Lapte bio',
        categoryId: DAIRY,
        baseUnit: 'l',
        ean: '5941234567890',
      });
      await rememberMappings(db, 'metro', [{ rawName: 'LAPTE', productId: milk.id }]);

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('metro', [{ rawName: 'LAPTE', ean: other.ean }]),
      );
      expect(mapping?.productId).toBe(milk.id);
      expect(mapping?.via).toBe('alias');
    });
  });

  describe('EAN', () => {
    it('assigns the product that carries the code, whatever the printed name', async () => {
      const { db } = await setup();
      const juice = await createProduct(db, {
        name: 'Suc de portocale',
        categoryId: GROCERY,
        baseUnit: 'l',
        ean: '5941234567890',
      });

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('mega-image', [{ rawName: 'SUC PORTOC', ean: '5941234567890' }]),
      );
      expect(mapping).toMatchObject({ productId: juice.id, categoryId: GROCERY, via: 'ean' });
    });

    it('matches a code learned through an alias of another chain and takes its pack size', async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'metro', [
        {
          rawName: 'LAPTE UHT BUCEGI',
          ean: '5941234567890',
          productId: milk.id,
          pack: { qty: 1, unit: 'l' },
        },
      ]);

      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('mega-image', [{ rawName: 'LAPTE BUCEGI', ean: '5941234567890' }]),
      );
      expect(mapping).toMatchObject({
        productId: milk.id,
        via: 'ean',
        pack: { qty: 1, unit: 'l' },
      });
    });

    it('treats UPC-A and EAN-13 spellings of one code as the same', async () => {
      const { db } = await setup();
      const product = await createProduct(db, {
        name: 'Biscuiți',
        categoryId: GROCERY,
        baseUnit: 'kg',
        ean: '012345678905',
      });
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('lidl', [{ rawName: 'BISC', ean: '0012345678905' }]),
      );
      expect(mapping?.productId).toBe(product.id);
    });

    it('does not guess when several products claim the code: they become candidates', async () => {
      const { db } = await setup();
      const ean = '5941234567890';
      const a = await createProduct(db, { name: 'A', categoryId: GROCERY, baseUnit: 'buc', ean });
      const b = await createProduct(db, { name: 'B', categoryId: GROCERY, baseUnit: 'buc', ean });

      const [mapping] = await suggestMappings(db, parsedReceipt('lidl', [{ rawName: 'X', ean }]));
      expect(mapping?.productId).toBeUndefined();
      expect(mapping?.via).toBe('fuzzy');
      expect(mapping?.candidates.map((c) => c.product.id).sort()).toEqual([a.id, b.id].sort());
    });

    it('does not assign on a truncated code (under 8 digits): a human confirms', async () => {
      const { db } = await setup();
      const product = await createProduct(db, {
        name: 'Ciocolată',
        categoryId: GROCERY,
        baseUnit: 'buc',
        ean: '594123',
      });
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('mega-image', [{ rawName: 'CIOCO', ean: '594123' }]),
      );
      expect(mapping?.productId).toBeUndefined();
      expect(mapping?.candidates.map((c) => c.product.id)).toEqual([product.id]);
    });

    describe('Mega Image prints 12 digits, METRO and the others 13', () => {
      const metroCode = '5949065034825';
      const megaPrint = '594906503482'; // the same code without its check digit
      const mega = (ean: string) => parsedReceipt('mega-image', [{ rawName: 'CARE HARTIE', ean }]);

      it('joins the 12-digit print with the 13-digit code that completes it', async () => {
        const { db } = await setup();
        const paper = await createProduct(db, {
          name: 'Hârtie igienică',
          categoryId: GROCERY,
          baseUnit: 'role',
          ean: metroCode,
        });
        const [mapping] = await suggestMappings(db, mega(megaPrint));
        expect(mapping).toMatchObject({ productId: paper.id, via: 'ean' });
      });

      it('and the other way round: the product knows the truncated print, METRO prints it whole', async () => {
        const { db } = await setup();
        const paper = await createProduct(db, {
          name: 'Hârtie igienică',
          categoryId: GROCERY,
          baseUnit: 'role',
          ean: megaPrint,
        });
        const [mapping] = await suggestMappings(
          db,
          parsedReceipt('metro', [{ rawName: 'FL H IG ALBA', ean: metroCode }]),
        );
        expect(mapping).toMatchObject({ productId: paper.id, via: 'ean' });
      });

      it('also finds it through an alias another chain learned, with its pack size', async () => {
        const { db, milk } = await setup();
        await rememberMappings(db, 'metro', [
          {
            rawName: 'FL H IG ALBA',
            ean: metroCode,
            productId: milk.id,
            pack: { qty: 8, unit: 'role' },
          },
        ]);
        const [mapping] = await suggestMappings(db, mega(megaPrint));
        expect(mapping).toMatchObject({
          productId: milk.id,
          via: 'ean',
          pack: { qty: 8, unit: 'role' },
        });
      });

      it('does not join a 13-digit code whose check digit is wrong: a misread is not an article', async () => {
        const { db } = await setup();
        await createProduct(db, {
          name: 'Alt articol',
          categoryId: GROCERY,
          baseUnit: 'role',
          ean: '5949065034821',
        });
        // a name that resembles nothing, so only the code could have matched
        const [mapping] = await suggestMappings(
          db,
          parsedReceipt('mega-image', [{ rawName: 'ZZZ QQQ', ean: megaPrint }]),
        );
        expect(mapping).toEqual({ via: 'none', candidates: [] });
      });

      it('prefers an exact print over the other spelling of a code', async () => {
        const { db } = await setup();
        const exact = await createProduct(db, {
          name: 'Cafea',
          categoryId: GROCERY,
          baseUnit: 'buc',
          ean: megaPrint,
        });
        await createProduct(db, {
          name: 'Hârtie igienică',
          categoryId: GROCERY,
          baseUnit: 'role',
          ean: metroCode,
        });
        const [mapping] = await suggestMappings(db, mega(megaPrint));
        expect(mapping).toMatchObject({ productId: exact.id, via: 'ean' });
      });
    });

    it('never assigns on a placeholder of zeros', async () => {
      const { db } = await setup();
      await createProduct(db, {
        name: 'Fără cod',
        categoryId: GROCERY,
        baseUnit: 'buc',
        ean: '0000000000000',
      });
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('lidl', [{ rawName: 'ALTCEVA', ean: '0000000000000' }]),
      );
      expect(mapping).toEqual({ via: 'none', candidates: [] });
    });
  });

  describe('fuzzy', () => {
    it('only offers similar products: nothing is assigned without a human', async () => {
      const { db, milk } = await setup();
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('lidl', [{ rawName: 'LAPTE UHT 1.5% 1L' }]),
      );
      expect(mapping?.via).toBe('fuzzy');
      expect(mapping?.productId).toBeUndefined();
      expect(mapping?.candidates.map((c) => c.product.id)).toEqual([milk.id]);
      expect(mapping?.candidates[0]?.score).toBeLessThan(1);
    });

    it('keeps the header category next to the candidates', async () => {
      const { db, milk } = await setup();
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('kaufland', [
          { rawName: 'LAPTE UHT 1.5%', storeCategoryHint: 'Mopro/Brânză/Ouă' },
        ]),
      );
      expect(mapping).toMatchObject({ via: 'fuzzy', categoryId: DAIRY });
      expect(mapping?.candidates[0]?.product.id).toBe(milk.id);
    });
  });

  describe('category', () => {
    it('maps a printed section header onto a seed category when nothing else matched', async () => {
      const { db } = await setup();
      const [mapping] = await suggestMappings(
        db,
        parsedReceipt('kaufland', [
          { rawName: 'BRANZA TOPITA', storeCategoryHint: 'Mopro/Brânză/Ouă' },
        ]),
      );
      expect(mapping).toEqual({ categoryId: DAIRY, via: 'category-hint', candidates: [] });
    });

    it('leaves the category open for an unknown header or a deleted category', async () => {
      const { db } = await setup();
      await softDelete(db.categories, DAIRY);
      const mappings = await suggestMappings(
        db,
        parsedReceipt('kaufland', [
          { rawName: 'BRANZA', storeCategoryHint: 'Mopro/Brânză/Ouă' },
          { rawName: 'ALTCEVA', storeCategoryHint: 'Raionul 7' },
        ]),
      );
      expect(mappings.map((m) => m.via)).toEqual(['none', 'none']);
      expect(mappings.map((m) => m.categoryId)).toEqual([undefined, undefined]);
    });

    it('puts non-product lines in Non-produs and never matches them', async () => {
      const { db, milk } = await setup();
      await rememberMappings(db, 'kaufland', [{ rawName: 'GARANTIE AMBALAJ', productId: milk.id }]);

      const [deposit, discount] = await suggestMappings(
        db,
        parsedReceipt('kaufland', [
          { rawName: 'GARANTIE AMBALAJ', kind: 'deposit' },
          { rawName: 'REDUCERE', kind: 'discount', lineTotalBani: -100 },
        ]),
      );
      const expected = { categoryId: NON_PRODUCT_CATEGORY_ID, via: 'none', candidates: [] };
      expect(deposit).toEqual(expected);
      expect(discount).toEqual(expected);
    });
  });

  describe('pack size', () => {
    const lines = [
      { rawName: 'HARTIE IGIENICA' },
      { rawName: 'HARTIE IGIENICA', pack: { qty: 4, unit: 'role' as const } },
      { rawName: 'HARTIE IGIENICA', qtyUnit: 'kg' as const, qty: 0.5 },
    ];

    it('fills in the size an alias remembers, only where the printed name has none', async () => {
      const { db } = await setup();
      const paper = await createProduct(db, {
        name: 'Hârtie igienică',
        categoryId: GROCERY,
        baseUnit: 'role',
      });
      await rememberMappings(db, 'mega-image', [
        {
          rawName: 'HARTIE IGIENICA',
          productId: paper.id,
          pack: { qty: 8, unit: 'role', unitsPerPack: 1 },
        },
      ]);

      const mappings = await suggestMappings(db, parsedReceipt('mega-image', lines));
      expect(mappings.map((m) => m.pack)).toEqual([
        { qty: 8, unit: 'role', unitsPerPack: 1 },
        undefined, // the printed 4 role wins
        undefined, // weighed item: a pack size means nothing
      ]);
    });
  });
});
