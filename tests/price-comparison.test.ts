/**
 * Plan §7.7 acceptance: the same product is compared across stores per base unit, from receipts
 * saved the way the importer saves them.
 *
 *   toilet paper: METRO ≈ 1,30 lei/roll < Kaufland 1,45 < Mega 2,00
 *   wet wipes 120 buc: 3,98 (METRO, after discount) vs 6,99 (Kaufland)
 *
 * The receipts are the sanitized ground truth of tests/fixtures (`expected.json`, not the noisy OCR
 * variants). Mega prints no pack size ("CARE HARTIE 10R 3S"), so its 10 rolls come from the alias
 * `defaultPack`.
 */
import { describe, expect, it } from 'vitest';
import { getProductSummary } from '@/analytics';
import { createProduct, rememberMappings } from '@/catalog';
import { importParsedReceipt } from '@/catalog/testing';
import { formatBani, formatMilliBani, SEED_CATEGORIES } from '@/domain';
import { ensureSeed } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { getFixture } from '@fixtures';

const HOUSEHOLD = SEED_CATEGORIES[9]!.id;
const BABY = SEED_CATEGORIES[11]!.id;

const kaufland = getFixture('kaufland-2026-11-07');
const metro = getFixture('metro-invoice-2026-08-12');
const mega = getFixture('mega-image-2026-11-03');
const now = new Date(kaufland.now);

const MEGA_PAPER = { rawName: 'CARE HARTIE 10R 3S', ean: '594906503482' };

async function world() {
  const db = await createTestDb();
  await ensureSeed(db);
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

  // The user matches the two products by hand on the first two receipts...
  await importParsedReceipt(db, metro.expected, {
    '8 ROLE FL H IG ALBA 3STR': paper.id,
    '120BUC ARO BABY SERVETELE UMED': wipes.id,
  });
  await importParsedReceipt(db, kaufland.expected, {
    'KLC HARTIE IG 8ROLE': paper.id,
    'BUBUBEBE SERV 120BUC': wipes.id,
  });
  // ...tells Mega once that its toilet paper is 10 rolls, and the next import is automatic.
  await rememberMappings(db, 'mega-image', [
    { ...MEGA_PAPER, productId: paper.id, pack: { qty: 10, unit: 'role' } },
  ]);
  await importParsedReceipt(db, mega.expected);
  return { db, paper, wipes };
}

describe('plan §7.7: prices compared across stores', () => {
  // METRO's invoice is dated 12.08, 100 days before the fixtures' clock (20.11): a wider window
  // than the default 90 days shows all three stores.
  const wide = { now, days: 120 };

  it('orders toilet paper per roll: METRO ≈ 1,30 < Kaufland 1,45 < Mega 2,00', async () => {
    const { db, paper } = await world();
    const summary = await getProductSummary(db, paper.id, wide);

    expect(
      summary?.stores.map((s) => [s.storeName, formatMilliBani(s.best!.pricePerBaseMilliBani)]),
    ).toEqual([
      ['METRO', '1,30'],
      ['Kaufland', '1,45'],
      ['Mega Image', '2,00'],
    ]);
    expect(summary?.baseUnit).toBe('role');
    expect(summary?.cheapest?.storeName).toBe('METRO');
    expect(summary?.onlyAt).toBeUndefined();
  });

  it('takes the Mega size from the alias: the printed line has none', async () => {
    const { db, paper } = await world();
    const line = await db.lines.filter((l) => l.rawName === MEGA_PAPER.rawName).first();
    expect(line).toMatchObject({
      productId: paper.id,
      packQty: 10,
      packUnit: 'role',
      baseUnit: 'role',
      pricePerBaseMilliBani: 199_900, // 19,99 lei / 10 rolls
    });
  });

  it('compares wet wipes: 3,98 at METRO after the discount against 6,99 at Kaufland', async () => {
    const { db, wipes } = await world();
    const summary = await getProductSummary(db, wipes.id, wide);

    expect(summary?.stores.map((s) => [s.storeName, formatBani(s.best!.paidUnitBani)])).toEqual([
      ['METRO', '3,98'],
      ['Kaufland', '6,99'],
    ]);
    expect(summary?.cheapest?.best).toMatchObject({ onSale: true, discountBani: 301 });
    expect(summary?.stores[0]?.overCheapestPct).toBe(0);
    expect(summary?.stores[1]?.overCheapestPct).toBe(75.6);
  });

  it("marks METRO's prices as sale prices and drops them when asked", async () => {
    const { db, paper, wipes } = await world();

    const paperNoSales = await getProductSummary(db, paper.id, { ...wide, excludeSales: true });
    expect(paperNoSales?.stores.map((s) => s.storeName)).toEqual(['Kaufland', 'Mega Image']);

    const wipesNoSales = await getProductSummary(db, wipes.id, { ...wide, excludeSales: true });
    expect(wipesNoSales?.cheapest?.storeName).toBe('Kaufland');
    // the discounted purchase stays in the history, flagged
    expect(wipesNoSales?.observations.map((o) => [o.storeName, o.onSale])).toEqual([
      ['METRO', true],
      ['Kaufland', false],
    ]);
  });

  it('keeps a store whose last purchase is older than the window, for reference only', async () => {
    const { db, paper } = await world();
    const summary = await getProductSummary(db, paper.id, { now });

    expect(summary?.windowDays).toBe(90);
    expect(summary?.stores.map((s) => [s.storeName, s.best !== undefined])).toEqual([
      ['Kaufland', true],
      ['Mega Image', true],
      ['METRO', false], // 12.08: 100 days ago
    ]);
    expect(summary?.cheapest?.storeName).toBe('Kaufland');
  });

  it('leaves non-product lines and unmatched products out of every comparison', async () => {
    const { db } = await world();
    const priced = await db.lines.filter((line) => line.productId !== undefined).count();
    expect(priced).toBe(5); // 2 METRO + 2 Kaufland + 1 Mega; deposits, bags and other lines have none

    const everything = await Promise.all(
      (await db.products.toArray()).map((p) => getProductSummary(db, p.id, wide)),
    );
    expect(everything.flatMap((s) => s?.observations ?? [])).toHaveLength(5);
  });
});
