import type { BaseUnit, Chain, PackUnit, Product, QtyUnit } from '@/domain';

/**
 * One price paid for a product: a live product line of a confirmed receipt, expressed per base
 * unit. Money is integer: `pricePerBaseMilliBani` is in 1/1000 ban (see contracts.md).
 */
export interface PriceObservation {
  lineId: string;
  receiptId: string;
  productId: string;
  storeId: string;
  chain: Chain;
  storeName: string;
  /** Calendar day of the purchase, `YYYY-MM-DD`. */
  date: string;
  /** As stored on the receipt: the day, or the day and time. Sorts chronologically. */
  purchasedAt: string;
  /** The name as printed on the receipt. */
  rawName: string;
  /** Unit that `pricePerBaseMilliBani` is expressed per. */
  baseUnit: BaseUnit;
  pricePerBaseMilliBani: number;
  /** What one sold unit (or one kg/l) cost, rounded to whole bani. */
  paidUnitBani: number;
  qty: number;
  unit: QtyUnit;
  /** What the whole line cost, after any discount. */
  lineTotalBani: number;
  /** The line carried a discount: this is a sale price, not the regular one. */
  onSale: boolean;
  discountBani: number;
  /** Content of one sold unit, for display (`8 role`). */
  pack?: { qty: number; unit: PackUnit };
}

export interface PriceOptions {
  /** The current moment: the window is counted back from its calendar day (Europe/Bucharest). */
  now: Date;
  /** Look-back window in days (plan §7.4); defaults to the `priceWindowDays` setting's default (90). */
  days?: number;
  /** Leave sale prices out of the comparison (plan §7.4). */
  excludeSales?: boolean;
}

/** The cheapest purchase at one store inside the window. */
export interface StorePrice {
  storeId: string;
  storeName: string;
  chain: Chain;
  /** Lowest price per base unit in the window; on a tie the most recent purchase. */
  best: PriceObservation;
  /** Most recent purchase in the window. */
  latest: PriceObservation;
  /** Purchases in the window that were compared. */
  count: number;
}

export type Direction = 'up' | 'down' | 'flat';

/** How the latest price moved compared with the previous purchase at the same store. */
export interface PriceChange {
  from: PriceObservation;
  to: PriceObservation;
  /** `to - from` per base unit, in milli-bani. */
  deltaMilliBani: number;
  /** Relative change in percent with one decimal (7.5 = 7.5 % dearer). A ratio, not money. */
  pct: number;
  /** `flat` when the change is under half a percent. */
  direction: Direction;
}

/** A store in a product's comparison table. */
export interface StoreComparison {
  storeId: string;
  storeName: string;
  chain: Chain;
  /** Cheapest purchase in the window; absent when the store was last used before it. */
  best?: PriceObservation;
  /** Most recent purchase at the store, whatever its age. */
  latest: PriceObservation;
  /** Purchases inside the window. */
  count: number;
  /** How much dearer `best` is than the cheapest store's, in percent; 0 for the cheapest. */
  overCheapestPct?: number;
}

export interface ProductPriceSummary {
  product: Product;
  /** The unit prices are compared in: the product's. */
  baseUnit: BaseUnit;
  windowDays: number;
  /** Every purchase in `baseUnit`, oldest first: the history and the chart. Sale prices included. */
  observations: PriceObservation[];
  /** Purchases that cannot be compared (another base unit, e.g. an unknown pack size), oldest first. */
  incomparable: PriceObservation[];
  /** The most recent purchase, whatever the options. */
  last?: PriceObservation;
  /** Stores in the window, cheapest first, then the stores last used before the window. */
  stores: StoreComparison[];
  /** The cheapest store in the window, if any. */
  cheapest?: StoreComparison & { best: PriceObservation };
  /**
   * The cheapest price in the window against the last price paid, in percent (negative: the last
   * purchase was dearer than the best known one; 0: it was the best). Absent without both.
   */
  cheapestVsLastPct?: number;
  /** Set when every purchase ever was at one store: no comparison is possible (plan §7.6). */
  onlyAt?: { storeId: string; storeName: string; chain: Chain };
  /** Latest price versus the previous purchase at the same store. */
  change?: PriceChange;
}
