import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { makeCategory, makeLine, makeProduct, makeReceipt, makeStore } from '@/domain/testing';
import { NON_PRODUCT_CATEGORY_ID, type Line, type Receipt } from '@/domain';
import {
  compareSpending,
  summarizeSpending,
  toSpendingReceipts,
  UNCATEGORIZED_NAME,
  UNKNOWN_STORE_NAME,
  type SpendingReceipt,
  type SpendingSource,
} from './spending';

const dairy = makeCategory({ name: 'Lactate & ouă', icon: '🥛', color: '#3b82f6', order: 10 });
const meat = makeCategory({ name: 'Carne & mezeluri', icon: '🥩', color: '#ef4444', order: 20 });
const nonProduct = makeCategory({
  id: NON_PRODUCT_CATEGORY_ID,
  name: 'Non-produs',
  icon: '➖',
  color: '#9ca3af',
  order: 1000,
  system: true,
});
const kaufland = makeStore({ chain: 'kaufland', name: 'Kaufland Cluj' });
const lidl = makeStore({ chain: 'lidl', name: 'Lidl' });
const milk = makeProduct({ name: 'Lapte UHT', categoryId: dairy.id, baseUnit: 'l' });

const world: SpendingSource = {
  receipts: [],
  lines: [],
  stores: [kaufland, lidl],
  products: [milk],
  categories: [dairy, meat, nonProduct],
};

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return makeReceipt({ storeId: kaufland.id, totalBani: 1000, ...overrides });
}

function line(of: Receipt, lineTotalBani: number, overrides: Partial<Line> = {}): Line {
  return makeLine({ receiptId: of.id, lineTotalBani, ...overrides });
}

/** Receipts with their lines, as the spending views read them. */
function spending(
  receipts: readonly Receipt[],
  lines: readonly Line[],
  overrides: Partial<SpendingSource> = {},
): SpendingReceipt[] {
  return toSpendingReceipts({ ...world, ...overrides, receipts, lines });
}

const amounts = (receipts: readonly SpendingReceipt[], index = 0) =>
  Object.fromEntries(
    (receipts[index]?.parts ?? []).map((part) => [part.bucket.name, part.amountBani]),
  );

describe('toSpendingReceipts: what a receipt costs', () => {
  it('counts what was paid and records what a voucher took off the total', () => {
    const r = receipt({ totalBani: 20879, paidBani: 18879 });
    const [counted] = spending([r], [line(r, 20879, { categoryId: dairy.id })]);

    expect(counted).toMatchObject({
      paidBani: 18879,
      totalBani: 20879,
      voucherBani: 2000,
      differenceBani: 0,
    });
  });

  it('counts the printed total when the receipt does not say what was paid', () => {
    const r = receipt({ totalBani: 6586 });
    const [counted] = spending([r], [line(r, 6586)]);

    expect(counted).toMatchObject({ paidBani: 6586, voucherBani: 0, differenceBani: 0 });
  });

  it('keeps the rounding between the lines and the total as a difference, never in a category', () => {
    // METRO's invoice: the lines add up to 363,42, the printed total and the payment are 363,41.
    const r = receipt({ totalBani: 36341, paidBani: 36341 });
    const counted = spending([r], [line(r, 20000), line(r, 16342)]);

    expect(counted[0]).toMatchObject({ paidBani: 36341, voucherBani: 0, differenceBani: -1 });
    expect(amounts(counted)).toEqual({ [UNCATEGORIZED_NAME]: 36342 });
  });

  it('does not take a paid amount above the total for a voucher', () => {
    const r = receipt({ totalBani: 1000, paidBani: 1050 });
    const [counted] = spending([r], [line(r, 1000)]);

    expect(counted).toMatchObject({ paidBani: 1050, voucherBani: 0, differenceBani: 50 });
  });

  it('counts a receipt without a live line as one uncategorized amount', () => {
    const r = receipt({ totalBani: 5000, paidBani: 4500 });
    const stale = line(r, 5000, { deletedAt: '2026-11-08T10:00:00.000Z' });
    const counted = spending([r], [stale]);

    expect(counted[0]).toMatchObject({ paidBani: 4500, voucherBani: 500, differenceBani: 0 });
    expect(amounts(counted)).toEqual({ [UNCATEGORIZED_NAME]: 5000 });
  });
});

describe('toSpendingReceipts: which receipts count', () => {
  it('leaves out drafts, deleted receipts and receipts without a usable date', () => {
    const counted = receipt({ purchasedAt: '2026-11-07T10:00' });
    const draft = receipt({ status: 'draft' });
    const deleted = receipt({ deletedAt: '2026-11-09T10:00:00.000Z' });
    // Dexie returns records unvalidated: a confirmed receipt must not break the totals without a date.
    const undated = { ...receipt(), purchasedAt: undefined };
    const garbled = receipt({ purchasedAt: '07.11.2026' });
    const all = [counted, draft, deleted, undated, garbled];

    const result = spending(
      all,
      all.map((r) => line(r, 1000)),
    );

    expect(result.map((r) => r.id)).toEqual([counted.id]);
  });

  it('leaves out tombstoned lines', () => {
    const r = receipt({ totalBani: 1000 });
    const lines = [
      line(r, 400, { categoryId: dairy.id }),
      line(r, 600, { categoryId: meat.id, deletedAt: '2026-11-08T10:00:00.000Z' }),
    ];

    const counted = spending([r], lines);

    expect(amounts(counted)).toEqual({ 'Lactate & ouă': 400 });
    expect(counted[0]?.differenceBani).toBe(600);
  });

  it('puts a receipt in the month of its printed date, also when that date is in the future', () => {
    const receipts = [
      receipt({ purchasedAt: '2026-12-29T17:12:30' }),
      receipt({ purchasedAt: '2026-11-01T00:00' }),
      receipt({ purchasedAt: '2026-10-31T23:59:59' }),
      receipt({ purchasedAt: '2026-12-01' }),
    ];

    const result = spending(receipts, []);

    expect(result.map((r) => [r.purchasedAt, r.month, r.date])).toEqual([
      ['2026-10-31T23:59:59', '2026-10', '2026-10-31'],
      ['2026-11-01T00:00', '2026-11', '2026-11-01'],
      ['2026-12-01', '2026-12', '2026-12-01'],
      ['2026-12-29T17:12:30', '2026-12', '2026-12-29'],
    ]);
  });

  it('names the store, and says so when it cannot be found', () => {
    const known = receipt({ storeId: lidl.id });
    const lost = receipt({ storeId: makeStore().id });

    const result = spending([known, lost], []);

    expect(result.map((r) => [r.storeName, r.chain])).toEqual([
      ['Lidl', 'lidl'],
      [UNKNOWN_STORE_NAME, 'unknown'],
    ]);
  });
});

describe('toSpendingReceipts: which bucket a line is counted in', () => {
  it('follows the product: a product line takes the product category, not a stale one', () => {
    const r = receipt();
    const counted = spending(
      [r],
      [
        line(r, 600, { productId: milk.id, categoryId: meat.id }),
        line(r, 400, { categoryId: meat.id }),
      ],
    );

    expect(amounts(counted)).toEqual({ 'Lactate & ouă': 600, 'Carne & mezeluri': 400 });
  });

  it('falls back to the line category when the product or its category is gone', () => {
    const r = receipt();
    const orphan = makeProduct({ categoryId: makeCategory().id });
    const gone = makeProduct({ categoryId: dairy.id, deletedAt: '2026-11-08T10:00:00.000Z' });
    const lines = [
      line(r, 100, { productId: orphan.id, categoryId: meat.id }),
      line(r, 200, { productId: gone.id, categoryId: meat.id }),
      line(r, 300, { productId: milk.id, categoryId: meat.id }),
    ];

    const counted = spending([r], lines, { products: [orphan, gone, milk] });

    expect(amounts(counted)).toEqual({ 'Carne & mezeluri': 300, 'Lactate & ouă': 300 });
  });

  it('shows product lines without a category known to the catalog in "Fără categorie"', () => {
    const r = receipt();
    const deletedCategory = makeCategory({ deletedAt: '2026-11-08T10:00:00.000Z' });
    const lines = [
      line(r, 100),
      line(r, 200, { categoryId: deletedCategory.id }),
      line(r, 300, { categoryId: makeCategory().id }),
    ];

    const [counted] = spending([r], lines, { categories: [...world.categories, deletedCategory] });

    expect(counted?.parts).toHaveLength(1);
    expect(counted?.parts[0]).toMatchObject({
      amountBani: 600,
      bucket: { kind: 'uncategorized', name: UNCATEGORIZED_NAME },
    });
  });

  it('counts deposits, bags, fees and standalone discounts in Non-produs, and still adds them up', () => {
    const r = receipt({ totalBani: 5140, paidBani: 4940 });
    const lines = [
      line(r, 4350, { categoryId: dairy.id }),
      line(r, -459, { kind: 'discount' }),
      line(r, 200, { kind: 'deposit' }),
      line(r, 50, { kind: 'bag', categoryId: NON_PRODUCT_CATEGORY_ID }),
      line(r, 999, { kind: 'fee' }),
    ];

    const counted = spending([r], lines);

    expect(amounts(counted)).toEqual({ 'Lactate & ouă': 4350, 'Non-produs': 790 });
    expect(
      counted[0]?.parts.find((part) => part.bucket.kind === 'non-product')?.bucket,
    ).toMatchObject({
      categoryId: NON_PRODUCT_CATEGORY_ID,
      icon: '➖',
    });
    expect(counted[0]).toMatchObject({ paidBani: 4940, voucherBani: 200, differenceBani: 0 });
  });

  it('honours a category the user gave a non-product line', () => {
    const r = receipt({ totalBani: 100 });

    const counted = spending([r], [line(r, 100, { kind: 'discount', categoryId: meat.id })]);

    expect(amounts(counted)).toEqual({ 'Carne & mezeluri': 100 });
  });

  it('still has the Non-produs bucket when the category record is missing', () => {
    const r = receipt({ totalBani: 50 });

    const [counted] = spending([r], [line(r, 50, { kind: 'bag' })], { categories: [dairy] });

    expect(counted?.parts[0]?.bucket).toMatchObject({
      kind: 'non-product',
      categoryId: NON_PRODUCT_CATEGORY_ID,
      name: 'Non-produs',
    });
  });
});

describe('summarizeSpending', () => {
  const october = receipt({ purchasedAt: '2026-10-31T23:59', storeId: lidl.id, totalBani: 3000 });
  const novemberA = receipt({ purchasedAt: '2026-11-01T00:00', totalBani: 1000, paidBani: 900 });
  const novemberB = receipt({ purchasedAt: '2026-11-30T23:59:59', totalBani: 2000 });
  const january = receipt({ purchasedAt: '2027-01-05', totalBani: 500 });
  const all = spending(
    [october, novemberA, novemberB, january],
    [
      line(october, 3000, { categoryId: meat.id }),
      line(novemberA, 1000, { categoryId: dairy.id }),
      line(novemberB, 1500, { productId: milk.id }),
      line(novemberB, 500, { categoryId: meat.id }),
      line(january, 500),
    ],
  );

  it('adds up one month: the boundaries belong to their own month', () => {
    const nov = summarizeSpending(all, { from: '2026-11', to: '2026-11' });

    expect(nov).toMatchObject({ from: '2026-11', to: '2026-11', totalBani: 2900, receiptCount: 2 });
    expect(nov.categories.map((c) => [c.name, c.amountBani])).toEqual([
      ['Lactate & ouă', 2500],
      ['Carne & mezeluri', 500],
    ]);
    expect(nov.adjustments).toEqual({ vouchersBani: -100, roundingBani: 0 });
    expect(nov.stores).toEqual([
      expect.objectContaining({ name: 'Kaufland Cluj', totalBani: 2900, receiptCount: 2 }),
    ]);
  });

  it('adds up everything when no period is given, listing only the months that have receipts', () => {
    const everything = summarizeSpending(all);

    expect(everything).toMatchObject({
      from: '2026-10',
      to: '2027-01',
      totalBani: 6400,
      receiptCount: 4,
    });
    expect(everything.months).toEqual([
      { month: '2026-10', totalBani: 3000, receiptCount: 1 },
      { month: '2026-11', totalBani: 2900, receiptCount: 2 },
      { month: '2027-01', totalBani: 500, receiptCount: 1 },
    ]);
  });

  it('lists every month of a period that has both ends, the empty ones with zero', () => {
    const quarter = summarizeSpending(all, { from: '2026-10', to: '2026-12' });

    expect(quarter.months).toEqual([
      { month: '2026-10', totalBani: 3000, receiptCount: 1 },
      { month: '2026-11', totalBani: 2900, receiptCount: 2 },
      { month: '2026-12', totalBani: 0, receiptCount: 0 },
    ]);
    expect(quarter.totalBani).toBe(5900);
  });

  it('puts the biggest store and category first and merges a store across receipts', () => {
    const everything = summarizeSpending(all);

    expect(everything.stores.map((s) => [s.name, s.totalBani, s.receiptCount])).toEqual([
      ['Kaufland Cluj', 3400, 3],
      ['Lidl', 3000, 1],
    ]);
    expect(everything.categories.map((c) => [c.name, c.amountBani])).toEqual([
      ['Carne & mezeluri', 3500],
      ['Lactate & ouă', 2500],
      [UNCATEGORIZED_NAME, 500],
    ]);
  });

  it('is empty, not broken, without receipts', () => {
    expect(summarizeSpending([])).toEqual({
      totalBani: 0,
      receiptCount: 0,
      categories: [],
      adjustments: { vouchersBani: 0, roundingBani: 0 },
      months: [],
      stores: [],
    });
    expect(summarizeSpending([], { from: '2026-10', to: '2026-11' }).months).toEqual([
      { month: '2026-10', totalBani: 0, receiptCount: 0 },
      { month: '2026-11', totalBani: 0, receiptCount: 0 },
    ]);
  });

  it('keeps the visible buckets even when they are small or negative', () => {
    const r = receipt({ totalBani: 190, purchasedAt: '2026-11-07T10:00' });
    const result = summarizeSpending(
      spending([r], [line(r, 200), line(r, -10, { kind: 'discount' })]),
      { from: '2026-11', to: '2026-11' },
    );

    expect(result.categories.map((c) => [c.kind, c.amountBani])).toEqual([
      ['uncategorized', 200],
      ['non-product', -10],
    ]);
  });
});

describe('compareSpending', () => {
  const october = receipt({ purchasedAt: '2026-10-15T10:00', totalBani: 10_000 });
  const november = receipt({ purchasedAt: '2026-11-15T10:00', totalBani: 12_500 });
  const counted = spending(
    [october, november],
    [
      line(october, 6000, { categoryId: dairy.id }),
      line(october, 4000, { categoryId: meat.id }),
      line(november, 12_500, { categoryId: dairy.id }),
    ],
  );
  const current = summarizeSpending(counted, { from: '2026-11', to: '2026-11' });
  const previous = summarizeSpending(counted, { from: '2026-10', to: '2026-10' });

  it('reports the change of the total and the earlier amount of each current bucket', () => {
    expect(compareSpending(current, previous)).toEqual({
      totalBani: 12_500,
      previousTotalBani: 10_000,
      deltaBani: 2500,
      pct: 25,
      categories: [
        expect.objectContaining({ name: 'Lactate & ouă', amountBani: 12_500, previousBani: 6000 }),
      ],
    });
  });

  it('has no percentage, and zero as the earlier amount, when there is nothing to compare with', () => {
    const none = summarizeSpending(counted, { from: '2026-09', to: '2026-09' });

    const result = compareSpending(current, none);

    expect(result.pct).toBeUndefined();
    expect(result.deltaBani).toBe(12_500);
    expect(result.categories[0]?.previousBani).toBe(0);
  });

  it('reads a fall as a negative change', () => {
    const result = compareSpending(previous, current);

    expect(result).toMatchObject({ deltaBani: -2500, pct: -20 });
  });
});

describe('the parts always add up', () => {
  const categories = [undefined, dairy.id, meat.id, NON_PRODUCT_CATEGORY_ID, makeCategory().id];
  const kinds = ['product', 'deposit', 'bag', 'discount', 'fee'] as const;

  const lineArb = fc.record({
    kind: fc.constantFrom(...kinds),
    amount: fc.integer({ min: -50_000, max: 500_000 }),
    category: fc.constantFrom(...categories),
    withProduct: fc.boolean(),
  });
  const receiptArb = fc.record({
    month: fc.constantFrom('2026-09', '2026-10', '2026-11', '2026-12'),
    day: fc.integer({ min: 1, max: 28 }),
    store: fc.constantFrom(kaufland.id, lidl.id, makeStore().id),
    total: fc.integer({ min: 0, max: 2_000_000 }),
    paidOffset: fc.option(fc.integer({ min: -100_000, max: 5000 }), { nil: undefined }),
    lines: fc.array(lineArb, { maxLength: 6 }),
  });

  it('holds for any receipts: categories + adjustments = total, and months and stores split it exactly', () => {
    fc.assert(
      fc.property(fc.array(receiptArb, { maxLength: 8 }), (generated) => {
        const receipts: Receipt[] = [];
        const lines: Line[] = [];
        for (const g of generated) {
          const r = receipt({
            purchasedAt: `${g.month}-${String(g.day).padStart(2, '0')}T12:00`,
            storeId: g.store,
            totalBani: g.total,
            ...(g.paidOffset === undefined
              ? {}
              : { paidBani: Math.max(0, g.total + g.paidOffset) }),
          });
          receipts.push(r);
          for (const l of g.lines) {
            lines.push(
              line(r, l.amount, {
                kind: l.kind,
                ...(l.category === undefined ? {} : { categoryId: l.category }),
                ...(l.withProduct && l.kind === 'product' ? { productId: milk.id } : {}),
              }),
            );
          }
        }

        const counted = spending(receipts, lines);
        const everything = summarizeSpending(counted);
        const parts = everything.categories.reduce((sum, c) => sum + c.amountBani, 0);

        expect(
          parts + everything.adjustments.vouchersBani + everything.adjustments.roundingBani,
        ).toBe(everything.totalBani);
        expect(everything.adjustments.vouchersBani).toBeLessThanOrEqual(0);
        expect(everything.months.reduce((sum, m) => sum + m.totalBani, 0)).toBe(
          everything.totalBani,
        );
        expect(everything.stores.reduce((sum, s) => sum + s.totalBani, 0)).toBe(
          everything.totalBani,
        );
        expect(everything.months.reduce((sum, m) => sum + m.receiptCount, 0)).toBe(
          everything.receiptCount,
        );

        // Two consecutive periods are the whole.
        const early = summarizeSpending(counted, { to: '2026-10' });
        const late = summarizeSpending(counted, { from: '2026-11' });
        expect(early.totalBani + late.totalBani).toBe(everything.totalBani);
        expect(early.receiptCount + late.receiptCount).toBe(everything.receiptCount);
      }),
      { numRuns: 200 },
    );
  });
});
