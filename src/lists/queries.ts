import {
  loadObservations,
  summarizeProduct,
  type PriceObservation,
  type PriceQueryOptions,
  type ProductPriceSummary,
} from '@/analytics';
import type { List, Product } from '@/domain';
import { getActive, getSetting, listActive, type PretometruDB } from '@/storage';
import { liveItems } from './items';
import { planList } from './plan';
import type { ListSummary, ListsOverview, ListView } from './types';

/** Newest first: ULIDs sort by creation time. */
const newestFirst = (a: List, b: List): number => b.id.localeCompare(a.id);

/** Every live list with how many items it has and how many are checked, split into those in use and the archived ones. */
export function loadListsOverview(db: PretometruDB): Promise<ListsOverview> {
  return db.transaction('r', [db.lists, db.listItems], async () => {
    const counts = new Map<string, { itemCount: number; checkedCount: number }>();
    for (const item of await listActive(db.listItems)) {
      const count = counts.get(item.listId) ?? { itemCount: 0, checkedCount: 0 };
      count.itemCount += 1;
      if (item.checked) count.checkedCount += 1;
      counts.set(item.listId, count);
    }

    const summaries = (await listActive(db.lists)).sort(newestFirst).map((list): ListSummary => ({
      list,
      itemCount: 0,
      checkedCount: 0,
      ...counts.get(list.id),
    }));
    return {
      active: summaries.filter(({ list }) => list.archivedAt === undefined),
      archived: summaries
        .filter(({ list }) => list.archivedAt !== undefined)
        .sort((a, b) => (b.list.archivedAt ?? '').localeCompare(a.list.archivedAt ?? '')),
    };
  });
}

/** The lists a product can be added to: live and not archived, newest first. */
export async function listOpenLists(db: PretometruDB): Promise<List[]> {
  return (await listActive(db.lists))
    .filter((list) => list.archivedAt === undefined)
    .sort(newestFirst);
}

/**
 * Everything the list screen shows: the list, its items in list order and, per item, where it is
 * cheapest and the estimated cost, grouped by store (`planList`). The price window and the
 * sale-price filter come from the `priceWindowDays` and `excludeDiscountedPrices` settings, like on
 * the product screens, unless `options` says otherwise. `undefined` when the list does not exist
 * (any more).
 */
export function loadListView(
  db: PretometruDB,
  listId: string,
  options: PriceQueryOptions = {},
): Promise<ListView | undefined> {
  return db.transaction(
    'r',
    [db.lists, db.listItems, db.products, db.lines, db.receipts, db.stores, db.settings],
    async () => {
      const list = await getActive(db.lists, listId);
      if (!list) return undefined;
      const items = await liveItems(db, listId);

      const productIds = [...new Set(items.flatMap(({ productId }) => productId ?? []))];
      const products = new Map<string, Product>();
      for (const product of await db.products.bulkGet(productIds)) {
        if (product && product.deletedAt === undefined) products.set(product.id, product);
      }

      const windowDays = options.days ?? (await getSetting(db, 'priceWindowDays'));
      const excludeSales =
        options.excludeSales ?? (await getSetting(db, 'excludeDiscountedPrices'));
      const now = options.now ?? new Date();
      const observations =
        products.size > 0
          ? await loadObservations(db, [...products.keys()])
          : new Map<string, PriceObservation[]>();

      const summaries = new Map<string, ProductPriceSummary>();
      for (const product of products.values()) {
        summaries.set(
          product.id,
          summarizeProduct(product, observations.get(product.id) ?? [], {
            now,
            days: windowDays,
            excludeSales,
          }),
        );
      }
      return { list, plan: planList(items, products, summaries), windowDays, excludeSales };
    },
  );
}
