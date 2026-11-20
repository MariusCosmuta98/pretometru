/**
 * Test-only helpers: the sanitized ground-truth receipts of tests/fixtures saved the way the importer
 * saves them, and the shared app database the screens read in tests. Never import this from
 * application code.
 */
import { createProduct, rememberMappings } from '@/catalog';
import { importParsedReceipt } from '@/catalog/testing';
import { SEED_CATEGORIES, type Product } from '@/domain';
import { ensureSeed, getDb, type PretometruDB } from '@/storage';
import { getFixture } from '@fixtures';

const MEAT = SEED_CATEGORIES[1]!.id;
const GROCERY = SEED_CATEGORIES[4]!.id;
const HOUSEHOLD = SEED_CATEGORIES[9]!.id;
const BABY = SEED_CATEGORIES[11]!.id;

/**
 * The clock of the fixtures: 20.11.2026, 100 days after METRO's invoice, so METRO is outside the
 * default window of 90 days and inside one of 120.
 */
export const FIXTURE_NOW = new Date(getFixture('kaufland-2026-11-07').now);

/**
 * The shared app database (fake-indexeddb) emptied and seeded with the categories: what the screens
 * read in tests. Import `fake-indexeddb/auto` first in the test file.
 */
export async function resetDb(): Promise<PretometruDB> {
  const db = await getDb();
  await Promise.all(db.tables.map((table) => table.clear()));
  await ensureSeed(db);
  return db;
}

export interface FixtureWorld {
  /** Toilet paper per roll: METRO 1,30 (a sale price) < Kaufland 1,45 < Mega Image 2,00. */
  paper: Product;
  /** Wet wipes, 120 pieces: METRO 3,98 (a sale price) against Kaufland 6,99. */
  wipes: Product;
  /** Boneless chicken thighs per kg: bought once, at Kaufland (24,99 lei/kg). */
  pork: Product;
  /** A catalog product that was never bought. */
  coffee: Product;
}

/**
 * Saves the METRO, Kaufland and Mega Image ground-truth receipts the way the importer does, with the
 * products of plan §7.7 matched by hand (and Mega's unsized toilet paper through an alias that
 * knows it is 10 rolls), plus a product that was never bought.
 */
export async function fixtureWorld(db: PretometruDB): Promise<FixtureWorld> {
  const paper = await createProduct(db, {
    name: 'Hârtie igienică',
    categoryId: HOUSEHOLD,
    baseUnit: 'role',
  });
  const wipes = await createProduct(db, {
    name: 'Șervețele umede 120 buc',
    categoryId: BABY,
    baseUnit: 'buc',
  });
  const pork = await createProduct(db, { name: 'Pulpe de pui', categoryId: MEAT, baseUnit: 'kg' });
  const coffee = await createProduct(db, {
    name: 'Cafea măcinată',
    categoryId: GROCERY,
    baseUnit: 'kg',
  });

  await importParsedReceipt(db, getFixture('metro-invoice-2026-08-12').expected, {
    '8 ROLE FL H IG ALBA 3STR': paper.id,
    '120BUC ARO BABY SERVETELE UMED': wipes.id,
  });
  await importParsedReceipt(db, getFixture('kaufland-2026-11-07').expected, {
    'KLC HARTIE IG 8ROLE': paper.id,
    'BUBUBEBE SERV 120BUC': wipes.id,
    'PULPE DEZOSATE TV': pork.id,
  });
  await rememberMappings(db, 'mega-image', [
    { rawName: 'CARE HARTIE 10R 3S', productId: paper.id, pack: { qty: 10, unit: 'role' } },
  ]);
  await importParsedReceipt(db, getFixture('mega-image-2026-11-03').expected);
  return { paper, wipes, pork, coffee };
}
