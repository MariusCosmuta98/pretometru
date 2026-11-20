// Public surface of price analytics. Import from '@/analytics'.
// React-free: it may use the domain and storage layers only.
export { cheapestPerStore, DEFAULT_WINDOW_DAYS, windowStart } from './cheapest';
export { loadPriceIncreases, priceIncreases } from './increases';
export type { IncreaseOptions, PriceIncrease, PriceIncreaseQuery } from './increases';
export { currentMonth, isMonthKey, lastMonths, monthOf, monthRange, shiftMonth } from './months';
export type { MonthKey } from './months';
export { toObservations } from './observations';
export type { ObservationSource } from './observations';
export { getProductSummary, listProductSummaries, loadObservations } from './queries';
export type { PriceQueryOptions } from './queries';
export { loadRecentReceipts, recentReceipts } from './recent';
export type { RecentReceipt, RecentReceipts } from './recent';
export {
  compareSpending,
  summarizeSpending,
  toSpendingReceipts,
  UNCATEGORIZED_NAME,
  UNKNOWN_STORE_NAME,
} from './spending';
export type {
  BucketKind,
  CategoryComparison,
  CategorySpend,
  MonthSpend,
  PeriodSpending,
  SpendingAdjustments,
  SpendingBucket,
  SpendingComparison,
  SpendingPart,
  SpendingPeriod,
  SpendingReceipt,
  SpendingSource,
  StoreSpend,
} from './spending';
export { getSpending, loadSpendingReceipts } from './spending-queries';
export { summarizeProduct } from './summary';
export { directionOf, percentChange, priceChange } from './trend';
export type {
  Direction,
  PriceChange,
  PriceObservation,
  PriceOptions,
  ProductPriceSummary,
  StoreComparison,
  StorePrice,
} from './types';
