/**
 * Shopping lists over the sanitized ground-truth receipts (tests/fixtures), saved the way the
 * importer saves them: where each item is cheapest, how the list is grouped by store, and what the
 * estimates add up to.
 *
 *   toilet paper per roll: METRO 1,30 < Kaufland 1,45 < Mega Image 2,00
 *   wet wipes, 120 pieces: METRO 3,98 (after its discount) against Kaufland 6,99
 *   chicken thighs: only ever bought at Kaufland, 24,99 lei/kg
 *
 * METRO's invoice is 100 days older than the fixtures' clock, so most cases widen the window to 120
 * days, as tests/price-comparison.test.ts does.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addProductToList,
  addTextItem,
  createList,
  loadListView,
  moveItem,
  setItemChecked,
  updateItem,
  type ListView,
  type PlannedItem,
} from '@/lists';
import { fixtureWorld, FIXTURE_NOW, type FixtureWorld } from '@/lists/testing';
import { formatMilliBani } from '@/domain';
import { ensureSeed, setSetting, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';

let db: PretometruDB;
let world: FixtureWorld;
let listId: string;
let items: Awaited<ReturnType<typeof fillList>>;

/** Fills the list the cases share: two packs of toilet paper, wipes, 500 g of chicken, coffee and bread. */
async function fillList() {
  const { paper, wipes, pork, coffee } = world;
  const added = {
    paper: (await addProductToList(db, listId, paper.id)).item,
    wipes: (await addProductToList(db, listId, wipes.id)).item,
    pork: (await addProductToList(db, listId, pork.id)).item,
    coffee: (await addProductToList(db, listId, coffee.id)).item,
    bread: await addTextItem(db, listId, 'Pâine'),
  };
  await updateItem(db, added.paper.id, { qty: 2, unit: 'buc' });
  await updateItem(db, added.pork.id, { qty: 0.5, unit: 'kg' });
  return added;
}

const wide = { now: FIXTURE_NOW, days: 120 };
const view = async (options: Parameters<typeof loadListView>[2] = wide): Promise<ListView> => {
  const loaded = await loadListView(db, listId, options);
  if (!loaded) throw new Error('The list is gone');
  return loaded;
};
const byName = (plan: ListView['plan'], name: string): PlannedItem => {
  const found = plan.items.find((entry) => entry.name === name);
  if (!found) throw new Error(`No item ${name}`);
  return found;
};
const groupsOf = (plan: ListView['plan']) =>
  plan.groups.map((group) => [group.store?.name, group.items.map((entry) => entry.name)]);

beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
  world = await fixtureWorld(db);
  listId = (await createList(db, 'Cumpărături')).id;
  items = await fillList();
});

describe('the cheapest place per item', () => {
  it('puts toilet paper at METRO: 1,30 lei per roll, with the date METRO was paid', async () => {
    const { quote } = byName((await view()).plan, 'Hârtie igienică');

    expect(quote).toMatchObject({
      kind: 'cheapest',
      store: { name: 'METRO', chain: 'metro' },
      baseUnit: 'role',
      price: { date: '2026-08-12', onSale: true },
    });
    if (quote.kind !== 'cheapest') throw new Error('unreachable');
    expect(formatMilliBani(quote.price.pricePerBaseMilliBani)).toBe('1,30');
  });

  it('puts wet wipes at METRO too: 3,98 lei a pack after the discount', async () => {
    const { quote } = byName((await view()).plan, 'Șervețele umede 120 buc');

    expect(quote).toMatchObject({
      kind: 'cheapest',
      store: { name: 'METRO' },
      price: { paidUnitBani: 398, onSale: true },
      estimateBani: 398,
    });
  });

  it('says "only at" for what was only ever bought at one store, at the last price', async () => {
    const { quote } = byName((await view()).plan, 'Pulpe de pui');

    expect(quote).toMatchObject({
      kind: 'only-at',
      store: { name: 'Kaufland' },
      baseUnit: 'kg',
      price: { date: '2026-11-07', paidUnitBani: 2499 }, // 24,99 lei/kg, as printed
      estimateBani: 1249, // 500 g
    });
  });

  it('has no store for a product that was never bought, nor for free text', async () => {
    const { plan } = await view();

    expect(byName(plan, 'Cafea măcinată').quote).toEqual({ kind: 'never-bought' });
    expect(byName(plan, 'Pâine').quote).toEqual({ kind: 'unlinked' });
  });

  it('leaves METRO out when its invoice is older than the default window of 90 days', async () => {
    const { plan, windowDays } = await view({ now: FIXTURE_NOW });

    expect(windowDays).toBe(90);
    expect(byName(plan, 'Hârtie igienică').quote).toMatchObject({
      kind: 'cheapest',
      store: { name: 'Kaufland' },
      price: { paidUnitBani: 1159 },
    });
    expect(byName(plan, 'Șervețele umede 120 buc').quote).toMatchObject({
      kind: 'cheapest',
      store: { name: 'Kaufland' },
      price: { paidUnitBani: 699 },
    });
  });

  it('leaves sale prices out when asked: METRO sold both products at a discount', async () => {
    const { plan, excludeSales } = await view({ ...wide, excludeSales: true });

    expect(excludeSales).toBe(true);
    expect(groupsOf(plan)).toEqual([
      ['Kaufland', ['Hârtie igienică', 'Șervețele umede 120 buc', 'Pulpe de pui']],
      [undefined, ['Cafea măcinată', 'Pâine']],
    ]);
  });

  it('suggests no store when nothing was bought inside a short window, but keeps "only at"', async () => {
    const { plan } = await view({ now: FIXTURE_NOW, days: 10 });

    expect(byName(plan, 'Hârtie igienică').quote).toMatchObject({
      kind: 'no-recent-price',
      last: { storeName: 'Kaufland', date: '2026-11-07' },
    });
    expect(byName(plan, 'Pulpe de pui').quote).toMatchObject({
      kind: 'only-at',
      store: { name: 'Kaufland' },
    });
  });

  it('follows the price settings of the product screens unless told otherwise', async () => {
    const before = await view({ now: FIXTURE_NOW });
    expect(byName(before.plan, 'Hârtie igienică').quote).toMatchObject({
      store: { name: 'Kaufland' },
    });

    await setSetting(db, 'priceWindowDays', 120);
    const wider = await view({ now: FIXTURE_NOW });
    expect(wider.windowDays).toBe(120);
    expect(byName(wider.plan, 'Hârtie igienică').quote).toMatchObject({ store: { name: 'METRO' } });

    await setSetting(db, 'excludeDiscountedPrices', true);
    const noSales = await view({ now: FIXTURE_NOW });
    expect(noSales.excludeSales).toBe(true);
    expect(byName(noSales.plan, 'Hârtie igienică').quote).toMatchObject({
      store: { name: 'Kaufland' },
    });
  });
});

describe('the list grouped by store', () => {
  it('groups each item under the store where it is cheapest, with the items without a store last', async () => {
    const { plan } = await view();

    expect(groupsOf(plan)).toEqual([
      ['Kaufland', ['Pulpe de pui']],
      ['METRO', ['Hârtie igienică', 'Șervețele umede 120 buc']],
      [undefined, ['Cafea măcinată', 'Pâine']],
    ]);
  });

  it('adds up an estimated subtotal per store: 2 packs of paper and 1 of wipes at METRO', async () => {
    const { plan } = await view();
    const [kaufland, metro, nowhere] = plan.groups;

    expect(metro).toMatchObject({ estimateBani: 2 * 1042 + 398, unestimated: 0 });
    expect(kaufland).toMatchObject({ estimateBani: 1249, unestimated: 0 });
    expect(nowhere).toMatchObject({ estimateBani: 0, unestimated: 2 });
    expect(plan).toMatchObject({ estimateBani: 2482 + 1249, unestimated: 2, checked: 0 });
  });

  it('moves everything to Kaufland when METRO leaves the window', async () => {
    const { plan } = await view({ now: FIXTURE_NOW });
    const kaufland = plan.groups.find((group) => group.store?.name === 'Kaufland');

    expect(groupsOf(plan)).toEqual([
      ['Kaufland', ['Hârtie igienică', 'Șervețele umede 120 buc', 'Pulpe de pui']],
      [undefined, ['Cafea măcinată', 'Pâine']],
    ]);
    expect(kaufland?.estimateBani).toBe(2 * 1159 + 699 + 1249);
  });

  it('keeps a checked item in its store, after the ones still to buy', async () => {
    await setItemChecked(db, items.paper.id, true);

    const { plan } = await view();

    expect(groupsOf(plan)[1]).toEqual(['METRO', ['Șervețele umede 120 buc', 'Hârtie igienică']]);
    expect(plan.checked).toBe(1);
  });

  it('keeps the list order inside a store, and moving an item changes it', async () => {
    expect(groupsOf((await view()).plan)[1]).toEqual([
      'METRO',
      ['Hârtie igienică', 'Șervețele umede 120 buc'],
    ]);

    await moveItem(db, items.wipes.id, { before: items.paper.id });

    expect(groupsOf((await view()).plan)[1]).toEqual([
      'METRO',
      ['Șervețele umede 120 buc', 'Hârtie igienică'],
    ]);
  });
});
