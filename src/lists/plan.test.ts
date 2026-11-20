import { describe, expect, it } from 'vitest';
import { summarizeProduct, type ProductPriceSummary } from '@/analytics';
import { paid } from '@/analytics/testing';
import type { ListItem, Product } from '@/domain';
import { makeListItem, makeProduct } from '@/domain/testing';
import { planList, sortItems } from './plan';

const now = new Date('2026-11-20T12:00:00Z');
const LIST = 'list-1';

const paper = makeProduct({ id: 'paper', name: 'Hârtie igienică', baseUnit: 'role' });
const milk = makeProduct({ id: 'milk', name: 'Lapte UHT', baseUnit: 'l' });
const pork = makeProduct({ id: 'pork', name: 'Pulpe de pui', baseUnit: 'kg' });
const coffee = makeProduct({ id: 'coffee', name: 'Cafea măcinată', baseUnit: 'kg' });

const purchases = [
  paid('metro', '2026-09-20', 130_250, { productId: 'paper', paidUnitBani: 1042 }),
  paid('kaufland', '2026-11-07', 145_000, { productId: 'paper', paidUnitBani: 1160 }),
  paid('kaufland', '2026-11-07', 599_000, {
    productId: 'milk',
    baseUnit: 'l',
    paidUnitBani: 599,
  }),
  paid('kaufland', '2026-11-07', 2_498_913, {
    productId: 'pork',
    baseUnit: 'kg',
    unit: 'kg',
    qty: 0.92,
    paidUnitBani: 2499,
  }),
];

function world(products: readonly Product[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const summaries = new Map<string, ProductPriceSummary>(
    products.map((product) => [product.id, summarizeProduct(product, purchases, { now })]),
  );
  return { byId, summaries };
}

let order = 0;
const item = (overrides: Partial<ListItem>): ListItem =>
  makeListItem({ listId: LIST, order: order++, ...overrides });

describe('sortItems', () => {
  it('puts what is still to buy first and keeps list order inside each part', () => {
    const items = [
      makeListItem({ id: 'c', order: 0, checked: true }),
      makeListItem({ id: 'b', order: 2 }),
      makeListItem({ id: 'a', order: 1 }),
      makeListItem({ id: 'd', order: 1 }),
      makeListItem({ id: 'e', order: 3, checked: true }),
    ];
    expect(sortItems(items).map((entry) => entry.id)).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(items[0]?.id).toBe('c'); // the input is left alone
  });
});

describe('planList', () => {
  const { byId, summaries } = world([paper, milk, pork, coffee]);

  const items = [
    item({ id: 'i-paper', productId: 'paper', label: 'Hârtie igienică', qty: 2, unit: 'buc' }),
    item({ id: 'i-bread', label: 'Pâine' }),
    item({ id: 'i-milk', productId: 'milk', label: 'Lapte UHT' }),
    item({ id: 'i-pork', productId: 'pork', label: 'Pulpe de pui', qty: 0.5, unit: 'kg' }),
    item({ id: 'i-coffee', productId: 'coffee', label: 'Cafea măcinată' }),
    item({ id: 'i-done', productId: 'milk', label: 'Lapte UHT', checked: true }),
  ];
  const plan = planList(items, byId, summaries);

  it('lists every item once: still to buy first, then the checked ones', () => {
    expect(plan.items.map((entry) => entry.item.id)).toEqual([
      'i-paper',
      'i-bread',
      'i-milk',
      'i-pork',
      'i-coffee',
      'i-done',
    ]);
    expect(plan.checked).toBe(1);
  });

  it('groups each item under the store where it is cheapest, stores by name, the rest last', () => {
    expect(
      plan.groups.map((group) => [group.store?.name, group.items.map((i) => i.item.id)]),
    ).toEqual([
      ['Kaufland', ['i-milk', 'i-pork', 'i-done']],
      ['METRO', ['i-paper']],
      [undefined, ['i-bread', 'i-coffee']],
    ]);
  });

  it('adds up the estimates per store and for the list', () => {
    const [kaufland, metro, nowhere] = plan.groups;
    expect(kaufland).toMatchObject({ estimateBani: 599 + 1249 + 599, unestimated: 0 });
    expect(metro).toMatchObject({ estimateBani: 2 * 1042, unestimated: 0 });
    expect(nowhere).toMatchObject({ estimateBani: 0, unestimated: 2 });
    expect(plan.estimateBani).toBe(599 + 1249 + 599 + 2084);
    expect(plan.unestimated).toBe(2);
  });

  it('shows the name of the product, not the label typed when it was added', () => {
    const renamed = makeProduct({
      id: 'paper',
      name: 'Hârtie igienică 3 straturi',
      baseUnit: 'role',
    });
    const planned = planList(items.slice(0, 1), new Map([['paper', renamed]]), summaries);
    expect(planned.items[0]).toMatchObject({
      name: 'Hârtie igienică 3 straturi',
      product: renamed,
    });
    expect(plan.items[1]).toMatchObject({ name: 'Pâine', quote: { kind: 'unlinked' } });
  });

  it('treats an item whose product is gone as free text', () => {
    const planned = planList(items.slice(0, 1), new Map(), new Map());
    expect(planned.items[0]).toMatchObject({
      name: 'Hârtie igienică',
      quote: { kind: 'unlinked' },
    });
    expect(planned.groups).toHaveLength(1);
    expect(planned.groups[0]?.store).toBeUndefined();
  });

  it('counts an item whose unit does not fit its price as unestimated, but keeps its store', () => {
    const odd = item({ id: 'i-odd', productId: 'paper', label: 'Hârtie', qty: 2, unit: 'kg' });
    const planned = planList([odd], byId, summaries);
    expect(planned.groups).toMatchObject([
      { store: { name: 'METRO' }, estimateBani: 0, unestimated: 1 },
    ]);
  });

  it('is empty for an empty list', () => {
    expect(planList([], new Map(), new Map())).toEqual({
      items: [],
      groups: [],
      estimateBani: 0,
      unestimated: 0,
      checked: 0,
    });
  });
});
