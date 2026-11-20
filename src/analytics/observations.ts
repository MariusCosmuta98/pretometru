import { parsePurchasedAt, type Line, type Receipt, type Store } from '@/domain';
import type { PriceObservation } from './types';

/** Chronological order; the line id breaks ties so the order is stable. */
export function byTime(a: PriceObservation, b: PriceObservation): number {
  return a.purchasedAt.localeCompare(b.purchasedAt) || a.lineId.localeCompare(b.lineId);
}

export interface ObservationSource {
  lines: readonly Line[];
  receipts: readonly Receipt[];
  stores: readonly Store[];
}

/**
 * Price observations from stored data: live product lines that belong to a product and sit on a
 * live, confirmed, dated receipt of a known store. Deposits, bags, discounts and fees never count
 * (plan §7.5), nor does a line that cost nothing. Oldest first. Lines of every unit are returned;
 * comparing is up to the caller, per base unit.
 */
export function toObservations({ lines, receipts, stores }: ObservationSource): PriceObservation[] {
  const receiptById = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const storeById = new Map(stores.map((store) => [store.id, store]));

  const observations: PriceObservation[] = [];
  for (const line of lines) {
    if (line.deletedAt !== undefined || line.kind !== 'product' || line.productId === undefined) {
      continue;
    }
    if (!(line.lineTotalBani > 0) || !(line.pricePerBaseMilliBani > 0)) continue;

    const receipt = receiptById.get(line.receiptId);
    if (receipt?.deletedAt !== undefined || receipt?.status !== 'confirmed') continue;
    const day =
      receipt.purchasedAt === undefined ? undefined : parsePurchasedAt(receipt.purchasedAt);
    const store = storeById.get(receipt.storeId);
    if (!day || receipt.purchasedAt === undefined || !store) continue;

    observations.push({
      lineId: line.id,
      receiptId: receipt.id,
      productId: line.productId,
      storeId: store.id,
      chain: store.chain,
      storeName: store.name,
      date: day.date,
      purchasedAt: receipt.purchasedAt,
      rawName: line.rawName,
      baseUnit: line.baseUnit,
      pricePerBaseMilliBani: line.pricePerBaseMilliBani,
      paidUnitBani: line.paidUnitBani,
      qty: line.qty,
      unit: line.unit,
      lineTotalBani: line.lineTotalBani,
      onSale: line.discountBani > 0,
      discountBani: line.discountBani,
      ...(line.packQty !== undefined && line.packUnit !== undefined
        ? { pack: { qty: line.packQty, unit: line.packUnit } }
        : {}),
    });
  }
  return observations.sort(byTime);
}
