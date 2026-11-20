import type { ProductPriceSummary } from '@/analytics';
import type { ListItem, Product } from '@/domain';
import { hasStore, quoteItem } from './pricing';
import type { ListPlan, PlannedItem, StoreGroup } from './types';

/** The items still to buy first, then the checked ones; each part in list order (`order`, then id). */
export function sortItems<T extends Pick<ListItem, 'id' | 'order' | 'checked'>>(
  items: readonly T[],
): T[] {
  return items.toSorted(
    (a, b) =>
      Number(a.checked) - Number(b.checked) || a.order - b.order || a.id.localeCompare(b.id),
  );
}

const byStoreName = (a: StoreGroup, b: StoreGroup): number => {
  if (!a.store || !b.store) return Number(a.store === undefined) - Number(b.store === undefined);
  return a.store.name.localeCompare(b.store.name, 'ro') || a.store.id.localeCompare(b.store.id);
};

/**
 * The shopping plan of a list: every item with where it is cheapest (`quoteItem`), and the same
 * items grouped under that store with an estimated subtotal each. `products` are the live products
 * the items link to and `summaries` their price summaries, built with the comparison settings the
 * screen shows; an item whose product is missing from them is treated as free text.
 */
export function planList(
  items: readonly ListItem[],
  products: ReadonlyMap<string, Product>,
  summaries: ReadonlyMap<string, ProductPriceSummary>,
): ListPlan {
  const planned = sortItems(items).map((item): PlannedItem => {
    const product = item.productId === undefined ? undefined : products.get(item.productId);
    return {
      item,
      name: product?.name ?? item.label,
      ...(product ? { product } : {}),
      quote: quoteItem(item, product ? summaries.get(product.id) : undefined),
    };
  });

  const groups = new Map<string, StoreGroup>();
  for (const entry of planned) {
    const store = hasStore(entry.quote) ? entry.quote.store : undefined;
    const key = store?.id ?? '';
    let group = groups.get(key);
    if (!group) {
      group = { ...(store ? { store } : {}), items: [], estimateBani: 0, unestimated: 0 };
      groups.set(key, group);
    }
    group.items.push(entry);

    const estimate = hasStore(entry.quote) ? entry.quote.estimateBani : undefined;
    if (estimate === undefined) group.unestimated += 1;
    else group.estimateBani += estimate;
  }

  const ordered = [...groups.values()].sort(byStoreName);
  return {
    items: planned,
    groups: ordered,
    estimateBani: ordered.reduce((sum, group) => sum + group.estimateBani, 0),
    unestimated: ordered.reduce((sum, group) => sum + group.unestimated, 0),
    checked: planned.filter(({ item }) => item.checked).length,
  };
}
