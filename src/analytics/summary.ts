import type { Product } from '@/domain';
import { cheapestPerStore, DEFAULT_WINDOW_DAYS } from './cheapest';
import { byTime } from './observations';
import { percentChange, priceChange } from './trend';
import type { PriceObservation, PriceOptions, ProductPriceSummary, StoreComparison } from './types';

/**
 * Everything the product screens show about one product, from its purchases (any unit; the ones
 * not in the product's base unit are set aside as `incomparable`). Pure: the clock is `options.now`.
 */
export function summarizeProduct(
  product: Product,
  purchases: readonly PriceObservation[],
  options: PriceOptions,
): ProductPriceSummary {
  const days = options.days ?? DEFAULT_WINDOW_DAYS;
  const { baseUnit } = product;
  const mine = purchases.filter((purchase) => purchase.productId === product.id);
  const observations = mine.filter((purchase) => purchase.baseUnit === baseUnit).sort(byTime);
  const incomparable = mine.filter((purchase) => purchase.baseUnit !== baseUnit).sort(byTime);

  // Sale prices stay in the history, but can be left out of every comparison.
  const compared = options.excludeSales
    ? observations.filter((purchase) => !purchase.onSale)
    : observations;

  const inWindow = cheapestPerStore(compared, { ...options, days, baseUnit, excludeSales: false });
  const cheapestBest = inWindow[0]?.best.pricePerBaseMilliBani;
  const stores: StoreComparison[] = inWindow.map(({ best, latest, count, ...store }) => ({
    ...store,
    best,
    latest,
    count,
    ...(cheapestBest !== undefined
      ? { overCheapestPct: percentChange(cheapestBest, best.pricePerBaseMilliBani) }
      : {}),
  }));

  const seen = new Set(stores.map((store) => store.storeId));
  const latestOutside = new Map<string, PriceObservation>();
  for (const purchase of compared) {
    if (!seen.has(purchase.storeId)) latestOutside.set(purchase.storeId, purchase); // oldest first: last wins
  }
  const stale = [...latestOutside.values()]
    .sort((a, b) => byTime(b, a))
    .map((latest): StoreComparison => ({
      storeId: latest.storeId,
      storeName: latest.storeName,
      chain: latest.chain,
      latest,
      count: 0,
    }));

  const first = stores[0];
  const lastPurchase = observations.at(-1);
  const everyStore = new Map(observations.map((purchase) => [purchase.storeId, purchase]));
  const [single] = everyStore.values();

  return {
    product,
    baseUnit,
    windowDays: days,
    observations,
    incomparable,
    ...(lastPurchase ? { last: lastPurchase } : {}),
    stores: [...stores, ...stale],
    ...(first?.best ? { cheapest: { ...first, best: first.best } } : {}),
    ...(everyStore.size === 1 && single
      ? { onlyAt: { storeId: single.storeId, storeName: single.storeName, chain: single.chain } }
      : {}),
    ...optionalChange(compared),
  };
}

function optionalChange(compared: readonly PriceObservation[]) {
  const change = priceChange(compared);
  return change ? { change } : {};
}
