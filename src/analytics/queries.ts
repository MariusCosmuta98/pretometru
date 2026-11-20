import { getActive, getSetting, listActive, type PretometruDB } from '@/storage';
import { toObservations } from './observations';
import { summarizeProduct } from './summary';
import type { PriceObservation, PriceOptions, ProductPriceSummary } from './types';

/** `PriceOptions` with everything optional: what is missing comes from the settings and the clock. */
export type PriceQueryOptions = Partial<PriceOptions>;

async function resolveOptions(
  db: PretometruDB,
  options: PriceQueryOptions,
): Promise<PriceOptions & { days: number }> {
  return {
    now: options.now ?? new Date(),
    days: options.days ?? (await getSetting(db, 'priceWindowDays')),
    excludeSales: options.excludeSales ?? (await getSetting(db, 'excludeDiscountedPrices')),
  };
}

/**
 * The price observations of the given products (all products when omitted), grouped by product.
 * Reads the live lines of confirmed receipts; see `toObservations` for what counts.
 */
export async function loadObservations(
  db: PretometruDB,
  productIds?: readonly string[],
): Promise<Map<string, PriceObservation[]>> {
  const { lines, receipts, stores } = await db.transaction(
    'r',
    [db.lines, db.receipts, db.stores],
    async () => {
      const lines = await (
        productIds
          ? db.lines.where('productId').anyOf(productIds)
          : db.lines.where('productId').above('')
      )
        .filter((line) => line.deletedAt === undefined && line.kind === 'product')
        .toArray();
      const receipts = (
        await db.receipts.bulkGet([...new Set(lines.map((line) => line.receiptId))])
      ).filter((receipt) => receipt !== undefined);
      const stores = (
        await db.stores.bulkGet([...new Set(receipts.map((receipt) => receipt.storeId))])
      ).filter((store) => store !== undefined);
      return { lines, receipts, stores };
    },
  );

  const grouped = new Map<string, PriceObservation[]>();
  for (const observation of toObservations({ lines, receipts, stores })) {
    const list = grouped.get(observation.productId);
    if (list) list.push(observation);
    else grouped.set(observation.productId, [observation]);
  }
  return grouped;
}

/** The product page's data. `undefined` for a product that does not exist (or was deleted). */
export async function getProductSummary(
  db: PretometruDB,
  productId: string,
  options: PriceQueryOptions = {},
): Promise<ProductPriceSummary | undefined> {
  const product = await getActive(db.products, productId);
  if (!product) return undefined;
  const resolved = await resolveOptions(db, options);
  const purchases = (await loadObservations(db, [productId])).get(productId) ?? [];
  return summarizeProduct(product, purchases, resolved);
}

/** A summary for every live product, including those never bought (empty history). */
export async function listProductSummaries(
  db: PretometruDB,
  options: PriceQueryOptions = {},
): Promise<ProductPriceSummary[]> {
  const products = await listActive(db.products);
  const resolved = await resolveOptions(db, options);
  const byProduct = await loadObservations(db);
  return products.map((product) =>
    summarizeProduct(product, byProduct.get(product.id) ?? [], resolved),
  );
}
