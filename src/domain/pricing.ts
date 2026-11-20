import { mulDiv } from './money';
import { baseUnitOf, toMilliBase, type BaseUnit, type Pack, type QtyUnit } from './units';

export interface UnitPricingInput {
  /** VAT-inclusive amount charged for the whole line, after any discount. */
  lineTotalBani: number;
  /** Sold units, or kg/l for weighed and measured items. Must be positive. */
  qty: number;
  qtyUnit: QtyUnit;
  /** Content of ONE sold unit; only meaningful when `qtyUnit` is `buc`. */
  pack?: Pack;
}

export interface UnitPricing {
  /** Effective price of one sold unit (or of one kg/l), rounded to a whole ban. */
  paidUnitBani: number;
  /** Unit that `pricePerBaseMilliBani` is expressed per; `buc` when the pack size is unknown. */
  baseUnit: BaseUnit;
  /** Price per base unit in milli-bani (1/1000 ban) so cheap pieces keep their precision. */
  pricePerBaseMilliBani: number;
}

/**
 * Plan §7 rules 2-3: `paidUnit = lineTotal / qty` and `pricePerBase = paidUnit / pack size` in
 * kg, l, buc, role or m. `lineTotalBani` is already net of discounts (see contracts.md).
 */
export function unitPricing({ lineTotalBani, qty, qtyUnit, pack }: UnitPricingInput): UnitPricing {
  const qtyMilli = Math.round(qty * 1000);
  if (!(qtyMilli > 0)) throw new RangeError(`qty must be positive, got ${qty}`);

  const bySize = qtyUnit === 'buc' && pack !== undefined;
  const baseUnit = bySize ? baseUnitOf(pack.unit) : qtyUnit;
  const contentMilli = bySize ? toMilliBase(pack.qty, pack.unit) : 1000;
  if (!(contentMilli > 0)) throw new RangeError('pack content must be positive');

  return {
    paidUnitBani: mulDiv(lineTotalBani, 1000, qtyMilli),
    baseUnit,
    pricePerBaseMilliBani: mulDiv(lineTotalBani, 1_000_000_000, qtyMilli * contentMilli),
  };
}
