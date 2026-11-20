import type { PriceObservation, ProductPriceSummary } from '@/analytics';
import { mulDiv, type BaseUnit, type ListItem } from '@/domain';
import type { ItemQuote, PlannedStore, PricedItemQuote } from './types';

type Quantity = Pick<ListItem, 'qty' | 'unit'>;

/**
 * What an item's quantity costs at the price of one purchase, in whole bani; `undefined` when the
 * item's unit does not fit the price. No quantity means one, no unit means the unit the price was
 * paid in (what the store sells):
 * - kg or l, for a product compared per kg or l: the quantity times the price per base unit, whatever
 *   size the purchase was (`0,5 kg` of something bought as a 400 g pack);
 * - buc, for a purchase counted in pieces: the quantity times what one piece cost, the pack as the
 *   store sells it (`2 buc` of toilet paper is two packs, not two rolls).
 */
export function estimateCost(
  item: Quantity,
  price: Pick<PriceObservation, 'unit' | 'paidUnitBani' | 'pricePerBaseMilliBani'>,
  baseUnit: BaseUnit,
): number | undefined {
  const milliQty = Math.round((item.qty ?? 1) * 1000);
  const unit = item.unit ?? price.unit;
  if ((unit === 'kg' || unit === 'l') && unit === baseUnit) {
    return mulDiv(milliQty, price.pricePerBaseMilliBani, 1_000_000);
  }
  if (unit === 'buc' && price.unit === 'buc') return mulDiv(milliQty, price.paidUnitBani, 1000);
  return undefined;
}

function priced(
  kind: PricedItemQuote['kind'],
  store: PlannedStore,
  price: PriceObservation,
  baseUnit: BaseUnit,
  item: Quantity,
): PricedItemQuote {
  const estimateBani = estimateCost(item, price, baseUnit);
  return { kind, store, price, baseUnit, ...(estimateBani !== undefined ? { estimateBani } : {}) };
}

/**
 * Where to buy an item, from the price summary of its product (`undefined` for free text and for a
 * product that is gone). A product bought at one store only is `only-at` that store, at its last
 * price: there is no comparison to make (plan §7.6). Otherwise the cheapest store of the summary
 * wins, which already follows the window and the sale-price setting the summary was built with.
 */
export function quoteItem(item: Quantity, summary: ProductPriceSummary | undefined): ItemQuote {
  if (!summary) return { kind: 'unlinked' };
  const { baseUnit, cheapest, onlyAt, last, incomparable } = summary;

  if (onlyAt && last) {
    const store = { id: onlyAt.storeId, name: onlyAt.storeName, chain: onlyAt.chain };
    return priced('only-at', store, last, baseUnit, item);
  }
  if (cheapest) {
    const store = { id: cheapest.storeId, name: cheapest.storeName, chain: cheapest.chain };
    return priced('cheapest', store, cheapest.best, baseUnit, item);
  }
  if (last) return { kind: 'no-recent-price', last };
  if (incomparable.length > 0) return { kind: 'incomparable' };
  return { kind: 'never-bought' };
}

/** A quote that names a store (and so places the item in a store group). */
export function hasStore(quote: ItemQuote): quote is PricedItemQuote {
  return quote.kind === 'cheapest' || quote.kind === 'only-at';
}
