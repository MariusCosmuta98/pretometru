import { idTimestamp, type Receipt, type ReceiptStatus, type Store } from '@/domain';
import { listActive, type PretometruDB } from '@/storage';
import { UNKNOWN_STORE_NAME } from './spending';

export interface RecentReceipt {
  id: string;
  storeId: string;
  storeName: string;
  /** Absent for a draft that has no date yet. */
  purchasedAt?: string;
  status: ReceiptStatus;
  /** The printed total of the goods. */
  totalBani: number;
  /** What was paid: the total, less a payment-side voucher. */
  paidBani: number;
}

export interface RecentReceipts {
  /** The newest receipts, drafts included. */
  items: RecentReceipt[];
  /** Every live receipt, drafts included. */
  count: number;
  /** Live receipts still to be confirmed. */
  drafts: number;
}

/** When the record was created, from its id, for a draft that has no purchase date yet. */
function createdAt(id: string): string {
  try {
    return new Date(idTimestamp(id)).toISOString();
  } catch {
    return '';
  }
}

/**
 * The newest `limit` live receipts, as the receipts list orders them: by purchase date (the day the
 * draft was created when it has none), newest first. A future date sorts first. Pure.
 */
export function recentReceipts(
  receipts: readonly Receipt[],
  stores: readonly Store[],
  limit: number,
): RecentReceipts {
  const storeName = new Map(stores.map((store) => [store.id, store.name]));
  const live = receipts
    .filter((receipt) => receipt.deletedAt === undefined)
    .map((receipt) => ({ receipt, sortKey: receipt.purchasedAt ?? createdAt(receipt.id) }))
    .sort((a, b) => b.sortKey.localeCompare(a.sortKey) || b.receipt.id.localeCompare(a.receipt.id));

  return {
    items: live.slice(0, limit).map(({ receipt }) => ({
      id: receipt.id,
      storeId: receipt.storeId,
      storeName: storeName.get(receipt.storeId) ?? UNKNOWN_STORE_NAME,
      ...(receipt.purchasedAt === undefined ? {} : { purchasedAt: receipt.purchasedAt }),
      status: receipt.status,
      totalBani: receipt.totalBani,
      paidBani: receipt.paidBani ?? receipt.totalBani,
    })),
    count: live.length,
    drafts: live.filter(({ receipt }) => receipt.status === 'draft').length,
  };
}

/** The newest live receipts of the device. */
export async function loadRecentReceipts(db: PretometruDB, limit = 5): Promise<RecentReceipts> {
  const receipts = await listActive(db.receipts);
  return recentReceipts(receipts, await db.stores.toArray(), limit);
}
