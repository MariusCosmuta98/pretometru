import type { ParseWarning, Receipt } from '@/domain';
import { findDuplicateReceipts, type PretometruDB } from '@/storage';
import type { ReceiptDraft } from './draft';
import { findStore } from './stores';

/** Stored receipts that look like the draft: the same file, or the same store, day and total. */
export async function findDraftDuplicates(
  db: PretometruDB,
  draft: ReceiptDraft,
): Promise<Receipt[]> {
  const store = await findStore(db, draft.store);
  return findDuplicateReceipts(db, {
    ...(draft.source.fileHash ? { fileHash: draft.source.fileHash } : {}),
    ...(store ? { storeId: store.id } : {}),
    ...(draft.purchasedAt ? { purchasedAt: draft.purchasedAt } : {}),
    // A missing total (0) would match every other receipt of that day.
    ...(draft.totalBani > 0 ? { totalBani: draft.totalBani } : {}),
    ...(draft.documentNo ? { receiptNo: draft.documentNo } : {}),
    ...(draft.id ? { excludeId: draft.id } : {}),
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
