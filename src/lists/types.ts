import type { PriceObservation } from '@/analytics';
import type { BaseUnit, Chain, List, ListItem, Product } from '@/domain';

/** A store an item can be bought at. */
export interface PlannedStore {
  id: string;
  name: string;
  chain: Chain;
}

/** What the quotes that name a store have in common. */
interface PricedQuote {
  store: PlannedStore;
  /** The purchase the price comes from: its date, price per base unit and sale flag. */
  price: PriceObservation;
  baseUnit: BaseUnit;
  /** What the item's quantity costs at that price, in whole bani; absent when its unit does not fit the price. */
  estimateBani?: number;
}

/**
 * Where an item is best bought, from the purchase history of its product (plan §7.4 and §7.6):
 * - `cheapest`: the cheapest store in the comparison window;
 * - `only-at`: every purchase ever was at one store, so there is nothing to compare;
 * - `no-recent-price`: bought before, but not in the window or only at sale prices that are left out;
 * - `incomparable`: bought, but never in a size that can be compared (no pack size);
 * - `never-bought`: a catalog product without a purchase;
 * - `unlinked`: free text, or a product that no longer exists.
 */
export type ItemQuote =
  | ({ kind: 'cheapest' } & PricedQuote)
  | ({ kind: 'only-at' } & PricedQuote)
  | { kind: 'no-recent-price'; last: PriceObservation }
  | { kind: 'incomparable' }
  | { kind: 'never-bought' }
  | { kind: 'unlinked' };

/** A quote that names a store. */
export type PricedItemQuote = Extract<ItemQuote, { kind: 'cheapest' | 'only-at' }>;

export interface PlannedItem {
  item: ListItem;
  /** The product's name while it is linked, else what was typed. */
  name: string;
  product?: Product;
  quote: ItemQuote;
}

/** The items to buy at one store. */
export interface StoreGroup {
  /** Absent for the items without a store: never bought, no recent price, free text. */
  store?: PlannedStore;
  items: PlannedItem[];
  /** Sum of the estimates of the items, in whole bani. */
  estimateBani: number;
  /** Items of the group that add nothing to the estimate (their unit does not fit their price). */
  unestimated: number;
}

export interface ListPlan {
  /** Every item: the ones still to buy first, then the checked ones, each in list order. */
  items: PlannedItem[];
  /** The same items under the store where each is cheapest: stores by name, the store-less group last. */
  groups: StoreGroup[];
  /** Sum of every item's estimate, in whole bani. */
  estimateBani: number;
  /** Items that add nothing to the estimate (no store, or a unit that does not fit the price). */
  unestimated: number;
  /** Items that are checked. */
  checked: number;
}

/** What a screen shows of one list: the list, its items with their prices and the comparison settings used. */
export interface ListView {
  list: List;
  plan: ListPlan;
  /** The look-back window of the price comparison, in days (the `priceWindowDays` setting). */
  windowDays: number;
  /** Sale prices were left out (the `excludeDiscountedPrices` setting). */
  excludeSales: boolean;
}

export interface ListSummary {
  list: List;
  itemCount: number;
  checkedCount: number;
}

export interface ListsOverview {
  /** Lists in use, newest first. */
  active: ListSummary[];
  /** Archived lists, the most recently archived first. */
  archived: ListSummary[];
}
