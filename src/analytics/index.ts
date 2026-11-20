// Public surface of price analytics. Import from '@/analytics'.
// React-free: it may use the domain and storage layers only.
export { cheapestPerStore, DEFAULT_WINDOW_DAYS, windowStart } from './cheapest';
export { toObservations } from './observations';
export type { ObservationSource } from './observations';
export { getProductSummary, listProductSummaries, loadObservations } from './queries';
export type { PriceQueryOptions } from './queries';
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
