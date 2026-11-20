import { shiftDateKey, SETTING_DEFINITIONS, todayKey, type BaseUnit } from '@/domain';
import { byTime } from './observations';
import type { PriceObservation, PriceOptions, StorePrice } from './types';

export const DEFAULT_WINDOW_DAYS = SETTING_DEFINITIONS.priceWindowDays.default;

/**
 * First day of the look-back window: `days` before today. A purchase made exactly `days` ago
 * counts; one dated after today (the user confirmed a future date) counts as the latest.
 */
export function windowStart(now: Date, days: number = DEFAULT_WINDOW_DAYS): string {
  return shiftDateKey(todayKey(now), -days);
}

/** Cheaper first; on equal prices the more recent purchase, so the date shown is the freshest. */
function byPrice(a: PriceObservation, b: PriceObservation): number {
  return a.pricePerBaseMilliBani - b.pricePerBaseMilliBani || byTime(b, a);
}

/**
 * "Cel mai ieftin" (plan §7.4): per store, the lowest price per `baseUnit` in the last `days`
 * days, with the date it was paid. Only purchases in `baseUnit` compete (a price per kg says
 * nothing about a price per piece); sale prices are marked on the observation and left out with
 * `excludeSales`. Stores come cheapest first.
 */
export function cheapestPerStore(
  observations: readonly PriceObservation[],
  {
    baseUnit,
    now,
    days = DEFAULT_WINDOW_DAYS,
    excludeSales = false,
  }: PriceOptions & { baseUnit: BaseUnit },
): StorePrice[] {
  const start = windowStart(now, days);
  const perStore = new Map<string, StorePrice>();

  for (const observation of observations) {
    if (observation.baseUnit !== baseUnit || observation.date < start) continue;
    if (excludeSales && observation.onSale) continue;

    const known = perStore.get(observation.storeId);
    if (!known) {
      perStore.set(observation.storeId, {
        storeId: observation.storeId,
        storeName: observation.storeName,
        chain: observation.chain,
        best: observation,
        latest: observation,
        count: 1,
      });
      continue;
    }
    known.count += 1;
    if (byPrice(observation, known.best) < 0) known.best = observation;
    if (byTime(observation, known.latest) > 0) known.latest = observation;
  }

  return [...perStore.values()].sort(
    (a, b) => byPrice(a.best, b.best) || a.storeName.localeCompare(b.storeName, 'ro'),
  );
}
