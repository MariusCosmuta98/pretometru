import { idTimestamp, type ReceiptStatus } from '@/domain';
import { getImportServices } from '@/import';
import { listActive } from '@/storage';
import type { SOURCE_LABELS } from './labels';

export interface ReceiptRow {
  id: string;
  storeId: string;
  storeName: string;
  purchasedAt?: string;
  /** Orders the list: the purchase date, or the day the draft was created when it has none. */
  sortKey: string;
  totalBani: number;
  status: ReceiptStatus;
  source: keyof typeof SOURCE_LABELS;
}

export type ReceiptsData =
  { status: 'ready'; rows: ReceiptRow[] } | { status: 'error'; detail: string };

/** Route loader of `bonuri`: every live receipt with its store, newest first. */
export async function loader(): Promise<ReceiptsData> {
  try {
    const db = await getImportServices().getDb();
    const [receipts, stores] = await Promise.all([listActive(db.receipts), listActive(db.stores)]);
    const storeNames = new Map(stores.map((store) => [store.id, store.name]));

    const rows = receipts.map((receipt): ReceiptRow => ({
      id: receipt.id,
      storeId: receipt.storeId,
      storeName: storeNames.get(receipt.storeId) ?? 'Magazin necunoscut',
      ...(receipt.purchasedAt ? { purchasedAt: receipt.purchasedAt } : {}),
      sortKey: receipt.purchasedAt ?? new Date(idTimestamp(receipt.id)).toISOString(),
      totalBani: receipt.totalBani,
      status: receipt.status,
      source: receipt.source.kind,
    }));
    rows.sort((a, b) => b.sortKey.localeCompare(a.sortKey) || b.id.localeCompare(a.id));
    return { status: 'ready', rows };
  } catch (error) {
    return { status: 'error', detail: error instanceof Error ? error.message : String(error) };
  }
}
