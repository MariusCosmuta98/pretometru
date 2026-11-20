import { unitPricing, type Line } from '@/domain';

type DerivedFields = 'paidUnitBani' | 'baseUnit' | 'pricePerBaseMilliBani';

/** A line without the fields that are derived from its total, quantity and pack. */
export type LineFields = Omit<Line, DerivedFields>;

/**
 * Adds `paidUnitBani`, `baseUnit` and `pricePerBaseMilliBani`. Every write of a line goes through
 * here, so the derived prices can never disagree with the fields they come from.
 */
export function withDerivedPricing(fields: LineFields): Line {
  const pack =
    fields.packQty !== undefined && fields.packUnit !== undefined
      ? { qty: fields.packQty, unit: fields.packUnit }
      : undefined;
  return {
    ...fields,
    ...unitPricing({
      lineTotalBani: fields.lineTotalBani,
      qty: fields.qty,
      qtyUnit: fields.unit,
      pack,
    }),
  };
}
