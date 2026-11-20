import { byTime } from './observations';
import type { Direction, PriceChange, PriceObservation } from './types';

/** Below this relative change (in percent) a price is considered unchanged: rounding noise on weighed items. */
const FLAT_BELOW_PCT = 0.5;

/** `(to - from) / from` in percent with one decimal, rounded half away from zero. Not money, so a float. */
export function percentChange(from: number, to: number): number {
  const tenths = ((to - from) * 1000) / from;
  return (Math.sign(tenths) * Math.round(Math.abs(tenths))) / 10 + 0;
}

export function directionOf(pct: number): Direction {
  if (Math.abs(pct) < FLAT_BELOW_PCT) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

/**
 * The trend of a product's price: the latest purchase against the previous one at the same store
 * (another receipt), so that comparing two stores is never mistaken for a price move. `undefined`
 * when the latest store has no earlier purchase. Give it one product's purchases in one base unit.
 */
export function priceChange(observations: readonly PriceObservation[]): PriceChange | undefined {
  const ordered = observations.toSorted(byTime);
  const to = ordered.at(-1);
  if (!to) return undefined;
  const from = ordered.findLast(
    (observation) => observation.storeId === to.storeId && observation.receiptId !== to.receiptId,
  );
  if (!from) return undefined;

  const pct = percentChange(from.pricePerBaseMilliBani, to.pricePerBaseMilliBani);
  return {
    from,
    to,
    deltaMilliBani: to.pricePerBaseMilliBani - from.pricePerBaseMilliBani,
    pct,
    direction: directionOf(pct),
  };
}
