/**
 * Test-only builder for price observations. Never import this from application code.
 */
import type { PriceObservation } from './types';

let counter = 0;

/** A valid observation (a roll of toilet paper at Kaufland, 1,45 lei) with a fresh id; override anything. */
export function observation(overrides: Partial<PriceObservation> = {}): PriceObservation {
  counter += 1;
  const id = String(counter).padStart(6, '0');
  return {
    lineId: `line-${id}`,
    receiptId: `receipt-${id}`,
    productId: 'product-1',
    storeId: 'store-kaufland',
    chain: 'kaufland',
    storeName: 'Kaufland',
    date: '2026-11-07',
    purchasedAt: '2026-11-07T14:32',
    rawName: 'HARTIE IGIENICA 8 ROLE',
    baseUnit: 'role',
    pricePerBaseMilliBani: 145_000,
    paidUnitBani: 1160,
    qty: 1,
    unit: 'buc',
    lineTotalBani: 1160,
    onSale: false,
    discountBani: 0,
    ...overrides,
  };
}

/** Same, bought on `date` (`YYYY-MM-DD`) at a store, at `milliBani` per base unit. */
export function paid(
  store: 'kaufland' | 'metro' | 'mega-image',
  date: string,
  milliBani: number,
  overrides: Partial<PriceObservation> = {},
): PriceObservation {
  const names = { kaufland: 'Kaufland', metro: 'METRO', 'mega-image': 'Mega Image' };
  return observation({
    storeId: `store-${store}`,
    chain: store,
    storeName: names[store],
    date,
    purchasedAt: `${date}T12:00`,
    pricePerBaseMilliBani: milliBani,
    ...overrides,
  });
}
