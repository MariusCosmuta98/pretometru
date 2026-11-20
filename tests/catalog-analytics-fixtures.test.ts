/**
 * The catalog and the price analytics over the shared fixtures (tests/fixtures): every receipt
 * shape that exists (real and synthetic) must be matched, saved and priced without surprises.
 */
import { describe, expect, it } from 'vitest';
import { getProductSummary, listProductSummaries, loadObservations } from '@/analytics';
import { createProduct, suggestMappings } from '@/catalog';
import { importParsedReceipt } from '@/catalog/testing';
import {
  baseUnitOf,
  NON_PRODUCT_CATEGORY_ID,
  SEED_CATEGORIES,
  type ParsedLine,
  type Product,
} from '@/domain';
import { ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { fixtures, getFixture } from '@fixtures';

const GROCERY = SEED_CATEGORIES[4]!.id;
const categoryName = (id: string | undefined) =>
  SEED_CATEGORIES.find((category) => category.id === id)?.name;

async function freshDb() {
  const db = await createTestDb();
  await ensureSeed(db);
  return db;
}

/** One product per distinct printed product name, in the unit its line is priced in. */
async function oneProductPerName(db: PretometruDB, lines: readonly ParsedLine[]) {
  const products = new Map<string, Product>();
  for (const line of lines) {
    if (line.kind !== 'product' || products.has(line.rawName)) continue;
    products.set(
      line.rawName,
      await createProduct(db, {
        name: line.rawName,
        categoryId: GROCERY,
        baseUnit: baseUnitOf(line.pack?.unit ?? line.qtyUnit),
      }),
    );
  }
  return products;
}

describe.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
  'fixture %s',
  (_id, fixture) => {
    it('is matched, saved and priced; only priced product lines become observations', async () => {
      const db = await freshDb();
      const receipt = fixture.expected;
      const products = await oneProductPerName(db, receipt.lines);

      await suggestMappings(db, receipt);
      await importParsedReceipt(
        db,
        receipt,
        Object.fromEntries([...products].map(([name, product]) => [name, product.id])),
      );

      const observations = [...(await loadObservations(db)).values()].flat();
      const priced = receipt.lines.filter((l) => l.kind === 'product' && l.lineTotalBani > 0);
      // a receipt without a date is saved as a draft, and drafts are not price history
      expect(observations).toHaveLength(receipt.purchasedAt ? priced.length : 0);
      for (const observation of observations) {
        expect(observation.pricePerBaseMilliBani).toBeGreaterThan(0);
        expect(observation.date).toBe(receipt.purchasedAt?.slice(0, 10));
      }

      const now = new Date(fixture.now);
      const summaries = await listProductSummaries(db, { now, days: 3650 });
      for (const summary of summaries) {
        expect(summary.incomparable).toEqual([]); // each product is in its lines' unit
        if (summary.observations.length > 0) {
          expect(summary.cheapest?.storeName).toBe(summary.last?.storeName);
          expect(summary.onlyAt?.storeName).toBe(summary.last?.storeName);
        }
      }
    });
  },
);

describe('price rules on weighed and multipack lines (plan §7.2)', () => {
  it('prices every line per kg, l, roll or piece', async () => {
    const db = await freshDb();
    const receipt = getFixture('weighed-and-multipack').expected;
    const products = await oneProductPerName(db, receipt.lines);
    await importParsedReceipt(
      db,
      receipt,
      Object.fromEntries([...products].map(([name, product]) => [name, product.id])),
    );

    const now = new Date(getFixture('weighed-and-multipack').now);
    const perBase = async (name: string) => {
      const summary = await getProductSummary(db, products.get(name)!.id, { now });
      return [summary?.baseUnit, summary?.last?.pricePerBaseMilliBani];
    };

    expect(await perBase('Cartofi albi 2KG')).toEqual(['kg', 349_500]); // 6,99 lei for 2 kg
    expect(await perBase('Banane')).toEqual(['kg', 598_865]); // 7,39 lei for 1,234 kg
    expect(await perBase('Iaurt 4X125G')).toEqual(['kg', 998_000]); // 2 packs of 500 g for 9,98 lei
    expect(await perBase('Apa plata 6X1,5L')).toEqual(['l', 144_333]); // 12,99 lei for 9 l
    expect(await perBase('Hartie igienica 8 role')).toEqual(['role', 199_875]);
  });
});

describe('non-product lines (plan §7.5)', () => {
  it('never become observations, whatever their kind', async () => {
    const db = await freshDb();
    const fixture = getFixture('promo-deposit-voucher');
    const products = await oneProductPerName(db, fixture.expected.lines);
    await importParsedReceipt(
      db,
      fixture.expected,
      Object.fromEntries([...products].map(([name, product]) => [name, product.id])),
    );

    const observations = [...(await loadObservations(db)).values()].flat();
    expect(observations.map((o) => o.rawName).sort()).toEqual([
      'BERE BLONDA 0,5L',
      'LAPTE UHT 1,5% 1L',
    ]);
  });
});

describe('product codes of every length (fixture truncated-ean)', () => {
  it('assigns by EAN from 8 digits up, but never by a 4-digit PLU or a prefix of another code', async () => {
    const db = await freshDb();
    const receipt = getFixture('truncated-ean').expected;
    const bought = new Map<number, Product>();
    for (const line of receipt.lines) {
      bought.set(
        line.idx,
        await createProduct(db, {
          name: line.rawName,
          categoryId: GROCERY,
          baseUnit: 'buc',
          ...(line.ean ? { ean: line.ean } : {}),
        }),
      );
    }

    // the same articles printed under names nobody has seen
    const renamed = {
      ...receipt,
      lines: receipt.lines.map((line) => ({ ...line, rawName: `ARTICOL ${line.idx}` })),
    };
    const mappings = await suggestMappings(db, renamed);

    // EAN-13, EAN-8 and the 12-digit print (the first 12 digits of the 13-digit code of line 0)
    expect(mappings.slice(0, 3).map((m) => [m.via, m.productId])).toEqual([
      ['ean', bought.get(0)!.id],
      ['ean', bought.get(1)!.id],
      ['ean', bought.get(2)!.id],
    ]);
    // the 4-digit PLU of a weighed line is not an article code: suggested, never assigned
    expect(mappings[3]?.via).toBe('fuzzy');
    expect(mappings[3]?.productId).toBeUndefined();
    expect(mappings[3]?.candidates.map((c) => c.product.id)).toEqual([bought.get(3)!.id]);
  });
});

describe('section headers of the real Kaufland receipt (plan §6: "se mapează automat")', () => {
  it('give every line its category or leave it open, deposits and bags go to Non-produs', async () => {
    const db = await freshDb();
    const receipt = getFixture('kaufland-2026-11-07').expected;
    const mappings = await suggestMappings(db, receipt);

    const byLine = receipt.lines.map((line, i) => [
      line.rawName,
      mappings[i]?.via,
      mappings[i]?.categoryId === NON_PRODUCT_CATEGORY_ID
        ? 'Non-produs'
        : categoryName(mappings[i]?.categoryId),
    ]);
    expect(byLine).toEqual([
      ['ROSII DEPELATE425ML', 'category-hint', 'Bacanie'],
      ['MAXIM NAUT 400G', 'category-hint', 'Bacanie'],
      ['PACHET PRAF COPT', 'category-hint', 'Bacanie'],
      ['OETKER ZAH.VAN8G*4', 'category-hint', 'Bacanie'],
      ['TORTILLA GRAU 245G', 'category-hint', 'Bacanie'],
      ['PURCARI VIN 0,75L', 'category-hint', 'Băuturi alcoolice'],
      ['GARANTIE AMBALAJ', 'none', 'Non-produs'],
      ['PULPE DEZOSATE TV', 'category-hint', 'Carne & mezeluri'],
      ['UMERASE LEMN', 'category-hint', 'Casă & bricolaj'],
      ['VDR BORS 1L', 'none', undefined], // "Delicatese/Convenience/Marinade" is too broad to guess
      ['KLC HARTIE IG 8ROLE', 'category-hint', 'Curățenie & menaj'],
      ['MERE GOLDEN DEL.', 'category-hint', 'Fructe & legume'],
      ['USTUROI', 'category-hint', 'Fructe & legume'],
      ['K-BIO BANANE', 'category-hint', 'Fructe & legume'],
      ['BUBUBEBE SERV 120BUC', 'category-hint', 'Igienă & cosmetice'],
      ['OUA ECOLOGICE6', 'category-hint', 'Lactate & ouă'],
      ['VDR SMANTANA400G', 'category-hint', 'Lactate & ouă'],
      ['PUNGA BIO', 'none', 'Non-produs'],
    ]);
  });
});
