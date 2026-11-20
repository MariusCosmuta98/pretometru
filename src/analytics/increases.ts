import type { BaseUnit, Product } from '@/domain';
import { getSetting, listActive, type PretometruDB } from '@/storage';
import { windowStart } from './cheapest';
import { loadObservations } from './queries';
import { priceChange } from './trend';
import type { PriceChange, PriceObservation } from './types';

/** A product that got dearer at a store: its latest purchase there against the one before it. */
export interface PriceIncrease {
  product: Product;
  baseUnit: BaseUnit;
  /** `direction` is always `up`; `from` and `to` are purchases at the same store. */
  change: PriceChange;
}

export interface IncreaseOptions {
  now: Date;
  /**
   * The look-back window in days (the `priceWindowDays` setting): the increase is **seen** inside it,
   * which means that the later purchase was made in the window. The earlier one may be older.
   */
  days: number;
  /** Leave sale prices out, as the product screens do: a sale price coming back to normal is no increase. */
  excludeSales?: boolean;
}

/**
 * The price increases seen in the window, biggest relative one first. Per product and store, the
 * latest purchase is compared with the previous one at the same store (so comparing two stores is
 * never mistaken for a price move) and only in the product's base unit. Pure.
 */
export function priceIncreases(
  products: readonly Product[],
  observations: ReadonlyMap<string, readonly PriceObservation[]>,
  { now, days, excludeSales = false }: IncreaseOptions,
): PriceIncrease[] {
  const start = windowStart(now, days);
  const found: PriceIncrease[] = [];

  for (const product of products) {
    const perStore = new Map<string, PriceObservation[]>();
    for (const purchase of observations.get(product.id) ?? []) {
      if (purchase.baseUnit !== product.baseUnit || (excludeSales && purchase.onSale)) continue;
      const known = perStore.get(purchase.storeId);
      if (known) known.push(purchase);
      else perStore.set(purchase.storeId, [purchase]);
    }

    for (const purchases of perStore.values()) {
      const change = priceChange(purchases);
      if (change?.direction === 'up' && change.to.date >= start) {
        found.push({ product, baseUnit: product.baseUnit, change });
      }
    }
  }

  return found.sort(
    (a, b) =>
      b.change.pct - a.change.pct ||
      b.change.deltaMilliBani - a.change.deltaMilliBani ||
      a.product.name.localeCompare(b.product.name, 'ro') ||
      a.change.to.storeName.localeCompare(b.change.to.storeName, 'ro'),
  );
}

export interface PriceIncreaseQuery extends Partial<IncreaseOptions> {
  /** At most this many, biggest first. */
  limit?: number;
}

/** `priceIncreases` over the stored data; the window and the sale filter default to the settings. */
export async function loadPriceIncreases(
  db: PretometruDB,
  { limit, ...options }: PriceIncreaseQuery = {},
): Promise<PriceIncrease[]> {
  const days = options.days ?? (await getSetting(db, 'priceWindowDays'));
  const excludeSales = options.excludeSales ?? (await getSetting(db, 'excludeDiscountedPrices'));
  const increases = priceIncreases(await listActive(db.products), await loadObservations(db), {
    now: options.now ?? new Date(),
    days,
    excludeSales,
  });
  return limit === undefined ? increases : increases.slice(0, limit);
}
