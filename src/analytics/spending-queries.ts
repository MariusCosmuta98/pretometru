import { listActive, type PretometruDB } from '@/storage';
import {
  summarizeSpending,
  toSpendingReceipts,
  type SpendingPeriod,
  type PeriodSpending,
  type SpendingReceipt,
} from './spending';

/**
 * The spending of every confirmed receipt on the device (see `toSpendingReceipts` for what counts).
 * One read transaction; the lines of a receipt are read only for the confirmed, live ones.
 */
export async function loadSpendingReceipts(db: PretometruDB): Promise<SpendingReceipt[]> {
  const source = await db.transaction(
    'r',
    [db.receipts, db.lines, db.stores, db.products, db.categories],
    async () => {
      const receipts = await db.receipts
        .where('status')
        .equals('confirmed')
        .filter((receipt) => receipt.deletedAt === undefined)
        .toArray();
      const lines = await db.lines
        .where('receiptId')
        .anyOf(receipts.map((receipt) => receipt.id))
        .filter((line) => line.deletedAt === undefined)
        .toArray();
      // A store is resolved even when it was tombstoned since: the money was still spent there.
      const stores = (
        await db.stores.bulkGet([...new Set(receipts.map((receipt) => receipt.storeId))])
      ).filter((store) => store !== undefined);
      return {
        receipts,
        lines,
        stores,
        products: await listActive(db.products),
        categories: await listActive(db.categories),
      };
    },
  );
  return toSpendingReceipts(source);
}

/** What was spent in `period` (every confirmed receipt when omitted). */
export async function getSpending(
  db: PretometruDB,
  period: SpendingPeriod = {},
): Promise<PeriodSpending> {
  return summarizeSpending(await loadSpendingReceipts(db), period);
}
