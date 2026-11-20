import {
  NON_PRODUCT_CATEGORY_ID,
  SEED_CATEGORIES,
  type Category,
  type Chain,
  type Line,
  type Product,
  type Receipt,
  type Store,
} from '@/domain';
import { monthOf, monthRange, type MonthKey } from './months';
import { percentChange } from './trend';

/*
 * What counts as spending (docs/architecture.md §5e):
 *
 * - Only live receipts that are `confirmed` and carry a valid date. Drafts and deleted receipts never
 *   count; neither do the lines of a deleted receipt or a tombstoned line.
 * - A receipt's spending is what was **paid**: `paidBani`, else its printed `totalBani`. A payment-side
 *   voucher (Kaufland's "Tichet de ambalaje") is cash that did not leave the wallet, and the deposit it
 *   refunds was counted on the receipt that charged it.
 * - The categories split the **lines** (their totals are already net of line discounts). Deposits, bags,
 *   fees and standalone discount lines count too: they sit in the system "Non-produs" category. A product
 *   line without a category known to the catalog sits in the visible "Fără categorie" bucket.
 * - What separates the lines from the paid amount is never spread over the categories: it is reported as
 *   two signed adjustments (vouchers, rounding and mismatches), so the parts always add up to the total.
 * - A receipt belongs to the month of its printed date, also when that date is in the future.
 */

export const UNKNOWN_STORE_NAME = 'Magazin necunoscut';
export const UNCATEGORIZED_NAME = 'Fără categorie';

export type BucketKind = 'category' | 'non-product' | 'uncategorized';

/** Where the money of a line is counted. */
export interface SpendingBucket {
  kind: BucketKind;
  /** The category's id; absent for `uncategorized`. */
  categoryId?: string;
  name: string;
  /** An emoji. */
  icon: string;
  /** `#rrggbb` */
  color: string;
}

const UNCATEGORIZED: SpendingBucket = {
  kind: 'uncategorized',
  name: UNCATEGORIZED_NAME,
  icon: '❔',
  color: '#94a3b8',
};

function bucketKey(bucket: SpendingBucket): string {
  return bucket.categoryId ?? bucket.kind;
}

function categoryBucket(category: Category): SpendingBucket {
  const system = category.system === true || category.id === NON_PRODUCT_CATEGORY_ID;
  return {
    kind: system ? 'non-product' : 'category',
    categoryId: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
  };
}

const NON_PRODUCT_FALLBACK = categoryBucket(
  SEED_CATEGORIES.find((category) => category.id === NON_PRODUCT_CATEGORY_ID) ?? {
    id: NON_PRODUCT_CATEGORY_ID,
    updatedAt: '',
    name: 'Non-produs',
    color: '#9ca3af',
    icon: '➖',
    order: 1000,
  },
);

/** The money of one receipt in one bucket. */
export interface SpendingPart {
  bucket: SpendingBucket;
  /** Σ of the receipt's lines in the bucket, net of their discounts; negative for a standalone discount. */
  amountBani: number;
}

/** A confirmed receipt reduced to what the spending views need. */
export interface SpendingReceipt {
  id: string;
  storeId: string;
  storeName: string;
  chain: Chain;
  /** The month of `date`, in Europe/Bucharest as printed. */
  month: MonthKey;
  /** `YYYY-MM-DD` */
  date: string;
  purchasedAt: string;
  /** What was paid: the receipt's spending. */
  paidBani: number;
  /** The printed total of the goods, before payment-side vouchers. */
  totalBani: number;
  /** What a voucher took off the total (>= 0); `paidBani + voucherBani` is the goods total. */
  voucherBani: number;
  /** What the lines miss of (or exceed) the goods total: rounding, or a mismatch the user accepted. */
  differenceBani: number;
  /** Σ `parts` - `voucherBani` + `differenceBani` = `paidBani`. */
  parts: SpendingPart[];
}

export interface SpendingSource {
  receipts: readonly Receipt[];
  lines: readonly Line[];
  stores: readonly Store[];
  products: readonly Product[];
  categories: readonly Category[];
}

const isLive = (record: { deletedAt?: string | undefined }): boolean =>
  record.deletedAt === undefined;

/**
 * The spending of every live, confirmed, dated receipt, oldest first. Pure: read the records with
 * `loadSpendingReceipts`. A product line is counted in its product's category when the product is
 * live and its category too, else in its own category, else in "Fără categorie"; a non-product line
 * in its own category when it has one, else in "Non-produs". A receipt without a live line counts as
 * one uncategorized amount. A store that cannot be found is "Magazin necunoscut".
 */
export function toSpendingReceipts(source: SpendingSource): SpendingReceipt[] {
  const storeById = new Map(source.stores.map((store) => [store.id, store]));
  const productById = new Map(
    source.products.filter(isLive).map((product) => [product.id, product]),
  );
  const categoryById = new Map(
    source.categories.filter(isLive).map((category) => [category.id, category]),
  );

  const buckets = new Map<string, SpendingBucket>();
  const bucketOf = (category: Category): SpendingBucket => {
    const known = buckets.get(category.id);
    if (known) return known;
    const created = categoryBucket(category);
    buckets.set(category.id, created);
    return created;
  };
  const liveBucket = (id: string | undefined): SpendingBucket | undefined => {
    const category = id === undefined ? undefined : categoryById.get(id);
    return category ? bucketOf(category) : undefined;
  };

  const bucketOfLine = (line: Line): SpendingBucket => {
    if (line.kind !== 'product') {
      return (
        liveBucket(line.categoryId) ?? liveBucket(NON_PRODUCT_CATEGORY_ID) ?? NON_PRODUCT_FALLBACK
      );
    }
    const product = line.productId === undefined ? undefined : productById.get(line.productId);
    return liveBucket(product?.categoryId) ?? liveBucket(line.categoryId) ?? UNCATEGORIZED;
  };

  const linesByReceipt = new Map<string, Line[]>();
  for (const line of source.lines) {
    if (!isLive(line)) continue;
    const group = linesByReceipt.get(line.receiptId);
    if (group) group.push(line);
    else linesByReceipt.set(line.receiptId, [line]);
  }

  const counted: SpendingReceipt[] = [];
  for (const receipt of source.receipts) {
    const month = monthOf(receipt.purchasedAt);
    if (!isLive(receipt) || receipt.status !== 'confirmed') continue;
    if (receipt.purchasedAt === undefined || month === undefined) continue;

    const paidBani = receipt.paidBani ?? receipt.totalBani;
    const voucherBani = paidBani < receipt.totalBani ? receipt.totalBani - paidBani : 0;
    const goodsBani = paidBani + voucherBani;

    const lines = linesByReceipt.get(receipt.id) ?? [];
    const partsByBucket = new Map<string, SpendingPart>();
    let linesBani = 0;
    for (const line of lines) {
      const bucket = bucketOfLine(line);
      const part = partsByBucket.get(bucketKey(bucket));
      if (part) part.amountBani += line.lineTotalBani;
      else partsByBucket.set(bucketKey(bucket), { bucket, amountBani: line.lineTotalBani });
      linesBani += line.lineTotalBani;
    }
    // Nothing itemised: the whole amount is known, only what it was spent on is not.
    if (lines.length === 0) {
      partsByBucket.set(bucketKey(UNCATEGORIZED), { bucket: UNCATEGORIZED, amountBani: goodsBani });
      linesBani = goodsBani;
    }

    const store = storeById.get(receipt.storeId);
    counted.push({
      id: receipt.id,
      storeId: receipt.storeId,
      storeName: store?.name ?? UNKNOWN_STORE_NAME,
      chain: store?.chain ?? 'unknown',
      month,
      date: receipt.purchasedAt.slice(0, 10),
      purchasedAt: receipt.purchasedAt,
      paidBani,
      totalBani: receipt.totalBani,
      voucherBani,
      differenceBani: goodsBani - linesBani,
      parts: [...partsByBucket.values()],
    });
  }
  return counted.sort(
    (a, b) => a.purchasedAt.localeCompare(b.purchasedAt) || a.id.localeCompare(b.id),
  );
}

/** The months a summary covers; either end may be left open. */
export interface SpendingPeriod {
  /** First month, inclusive. Absent: from the first month with a receipt. */
  from?: MonthKey;
  /** Last month, inclusive. Absent: up to the last month with a receipt. */
  to?: MonthKey;
}

export interface CategorySpend extends SpendingBucket {
  amountBani: number;
}

export interface MonthSpend {
  month: MonthKey;
  totalBani: number;
  receiptCount: number;
}

export interface StoreSpend {
  storeId: string;
  name: string;
  chain: Chain;
  totalBani: number;
  receiptCount: number;
}

/** Signed amounts to add to the categories to reach the total. */
export interface SpendingAdjustments {
  /** Payment-side vouchers: zero or negative. */
  vouchersBani: number;
  /** Rounding and accepted mismatches between the lines and the printed total. */
  roundingBani: number;
}

export interface PeriodSpending {
  /** The months covered: the requested ones, else the first and last month with a receipt. */
  from?: MonthKey;
  to?: MonthKey;
  /** What was paid in the period. */
  totalBani: number;
  receiptCount: number;
  /** Biggest first, the "Non-produs" and "Fără categorie" buckets among them. */
  categories: CategorySpend[];
  /** `Σ categories + vouchersBani + roundingBani = totalBani`. */
  adjustments: SpendingAdjustments;
  /** Oldest first: every month of the period when both ends are given, else only months with a receipt. */
  months: MonthSpend[];
  /** Biggest first. */
  stores: StoreSpend[];
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ro');

/** Adds up the receipts whose month falls in `period`. Pure; the clock never enters. */
export function summarizeSpending(
  receipts: readonly SpendingReceipt[],
  period: SpendingPeriod = {},
): PeriodSpending {
  const covered = receipts.filter(
    (receipt) =>
      (period.from === undefined || receipt.month >= period.from) &&
      (period.to === undefined || receipt.month <= period.to),
  );

  const categories = new Map<string, CategorySpend>();
  const stores = new Map<string, StoreSpend>();
  const perMonth = new Map<MonthKey, MonthSpend>();
  const adjustments: SpendingAdjustments = { vouchersBani: 0, roundingBani: 0 };
  let totalBani = 0;

  for (const receipt of covered) {
    totalBani += receipt.paidBani;
    adjustments.vouchersBani -= receipt.voucherBani;
    adjustments.roundingBani += receipt.differenceBani;

    for (const { bucket, amountBani } of receipt.parts) {
      const known = categories.get(bucketKey(bucket));
      if (known) known.amountBani += amountBani;
      else categories.set(bucketKey(bucket), { ...bucket, amountBani });
    }

    const store = stores.get(receipt.storeId);
    if (store) {
      store.totalBani += receipt.paidBani;
      store.receiptCount += 1;
    } else {
      stores.set(receipt.storeId, {
        storeId: receipt.storeId,
        name: receipt.storeName,
        chain: receipt.chain,
        totalBani: receipt.paidBani,
        receiptCount: 1,
      });
    }

    const month = perMonth.get(receipt.month);
    if (month) {
      month.totalBani += receipt.paidBani;
      month.receiptCount += 1;
    } else {
      perMonth.set(receipt.month, {
        month: receipt.month,
        totalBani: receipt.paidBani,
        receiptCount: 1,
      });
    }
  }

  const present = [...perMonth.keys()].sort();
  const from = period.from ?? present[0];
  const to = period.to ?? present.at(-1);
  const wanted =
    period.from !== undefined && period.to !== undefined
      ? monthRange(period.from, period.to)
      : present;

  return {
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    totalBani,
    receiptCount: covered.length,
    categories: [...categories.values()].sort(
      (a, b) => b.amountBani - a.amountBani || byName(a, b),
    ),
    adjustments,
    months: wanted.map((month) => perMonth.get(month) ?? { month, totalBani: 0, receiptCount: 0 }),
    stores: [...stores.values()].sort(
      (a, b) => b.totalBani - a.totalBani || byName(a, b) || a.storeId.localeCompare(b.storeId),
    ),
  };
}

export interface CategoryComparison extends CategorySpend {
  /** What the same bucket held in the earlier period; 0 when it did not appear. */
  previousBani: number;
}

export interface SpendingComparison {
  totalBani: number;
  previousTotalBani: number;
  /** `totalBani - previousTotalBani`. */
  deltaBani: number;
  /** The change in percent with one decimal (a ratio, not money); absent when nothing was paid before. */
  pct?: number;
  /** The buckets of the current period, each with its earlier amount. Buckets only the earlier period had are left out. */
  categories: CategoryComparison[];
}

/** The current period against an earlier one (this month against the previous one). */
export function compareSpending(
  current: PeriodSpending,
  previous: PeriodSpending,
): SpendingComparison {
  const earlier = new Map(previous.categories.map((category) => [bucketKey(category), category]));
  return {
    totalBani: current.totalBani,
    previousTotalBani: previous.totalBani,
    deltaBani: current.totalBani - previous.totalBani,
    ...(previous.totalBani > 0
      ? { pct: percentChange(previous.totalBani, current.totalBani) }
      : {}),
    categories: current.categories.map((category) => ({
      ...category,
      previousBani: earlier.get(bucketKey(category))?.amountBani ?? 0,
    })),
  };
}
