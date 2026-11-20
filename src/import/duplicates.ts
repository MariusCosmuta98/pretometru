import type { ParseWarning, Receipt } from '@/domain';
import { findDuplicateReceipts, type PretometruDB } from '@/storage';
import type { ReceiptDraft } from './draft';
import { findStore, type StoreSpec } from './stores';

/** The fields of a receipt that make it look like another one. */
export interface DuplicateQuery {
  store: StoreSpec;
  fileHash?: string | undefined;
  purchasedAt?: string | undefined;
  totalBani: number;
  documentNo?: string | undefined;
  /** The receipt being edited, which is not a duplicate of itself. */
  excludeId?: string | undefined;
}

/** Stored receipts that look like the query: the same file, or the same store, day and total. */
export async function findDuplicates(db: PretometruDB, query: DuplicateQuery): Promise<Receipt[]> {
  const store = await findStore(db, query.store);
  return findDuplicateReceipts(db, {
    ...(query.fileHash ? { fileHash: query.fileHash } : {}),
    ...(store ? { storeId: store.id } : {}),
    ...(query.purchasedAt ? { purchasedAt: query.purchasedAt } : {}),
    // A missing total (0) would match every other receipt of that day.
    ...(query.totalBani > 0 ? { totalBani: query.totalBani } : {}),
    ...(query.documentNo ? { receiptNo: query.documentNo } : {}),
    ...(query.excludeId ? { excludeId: query.excludeId } : {}),
  });
}

/** `findDuplicates` for a draft. */
export function findDraftDuplicates(db: PretometruDB, draft: ReceiptDraft): Promise<Receipt[]> {
  return findDuplicates(db, {
    store: draft.store,
    fileHash: draft.source.fileHash,
    purchasedAt: draft.purchasedAt,
    totalBani: draft.totalBani,
    documentNo: draft.documentNo,
    excludeId: draft.id,
  });
}

export function duplicateWarning(duplicates: readonly Receipt[]): ParseWarning {
  return {
    code: 'DUPLICATE',
    message:
      duplicates.length === 1
        ? 'Un bon similar este deja salvat: același fișier sau același magazin, aceeași zi și același total.'
        : `${duplicates.length} bonuri similare sunt deja salvate: același fișier sau același magazin, aceeași zi și același total.`,
  };
}
