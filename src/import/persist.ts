import type { Line, Receipt, ReceiptStatus, Store } from '@/domain';
import {
  deleteReceipt,
  getActive,
  getReceiptWithLines,
  saveReceipt,
  type StorageContext,
} from '@/storage';
import {
  draftFromStored,
  lineInputsFromDraft,
  mappingChoices,
  receiptInputFromDraft,
  type ReceiptDraft,
} from './draft';
import { ImportError } from './errors';
import { closeReviewSession, getReviewSession } from './session';
import type { ImportServices } from './services';
import { findOrCreateStore, matchesStoreSpec } from './stores';

export interface SavedReceipt {
  receipt: Receipt;
  lines: Line[];
  store: Store;
}

function storageContext(services: ImportServices): StorageContext {
  return { now: services.now, newId: services.newId };
}

/**
 * The store of a draft: the receipt's current store while the chain and branch are unchanged (so
 * saving never silently re-points it), otherwise the store of that chain and branch.
 */
async function resolveStore(services: ImportServices, draft: ReceiptDraft): Promise<Store> {
  const db = await services.getDb();
  if (draft.storeId !== undefined) {
    const current = await getActive(db.stores, draft.storeId);
    if (current && matchesStoreSpec(current, draft.store)) return current;
  }
  return findOrCreateStore(db, draft.store, storageContext(services));
}

/**
 * Saves the receipt and its lines in one transaction (creating or updating, by `draft.id`). The
 * unit prices are derived by the storage layer from total, quantity and pack.
 */
export async function saveDraft(
  services: ImportServices,
  draft: ReceiptDraft,
  status: ReceiptStatus = draft.status,
): Promise<SavedReceipt> {
  const db = await services.getDb();
  const store = await resolveStore(services, draft);
  const toSave: ReceiptDraft = { ...draft, status };
  try {
    const { receipt, lines } = await saveReceipt(
      db,
      receiptInputFromDraft(toSave, store.id),
      lineInputsFromDraft(toSave),
      storageContext(services),
    );
    return { receipt, lines, store };
  } catch (error) {
    throw new ImportError('SAVE_FAILED', 'The receipt could not be saved', { cause: error });
  }
}

export interface ConfirmResult {
  saved: SavedReceipt;
  /** The receipt is confirmed, but the alias memory could not be updated. */
  mappingError?: unknown;
}

/**
 * Saves the draft as `confirmed` and teaches the catalog the product mappings, so the next import
 * of the same lines maps by itself. A failing catalog does not undo the confirmation.
 */
export async function confirmDraft(
  services: ImportServices,
  draft: ReceiptDraft,
): Promise<ConfirmResult> {
  const saved = await saveDraft(services, draft, 'confirmed');
  let mappingError: unknown;
  try {
    const choices = mappingChoices(draft);
    if (choices.length > 0) {
      await services.catalog.rememberMappings(await services.getDb(), draft.store.chain, choices);
    }
  } catch (error) {
    mappingError = error;
  }
  closeReviewSession(saved.receipt.id);
  return mappingError === undefined ? { saved } : { saved, mappingError };
}

/** The draft of a stored receipt (with the review session's extras), or `undefined` if it is gone. */
export async function loadDraft(
  services: ImportServices,
  receiptId: string,
): Promise<ReceiptDraft | undefined> {
  const db = await services.getDb();
  const stored = await getReceiptWithLines(db, receiptId);
  if (!stored) return undefined;
  const store = await getActive(db.stores, stored.receipt.storeId);
  return draftFromStored({ ...stored, store }, getReviewSession(receiptId));
}

/** Deletes a receipt (a tombstone, so the deletion can sync) and forgets its in-memory original. */
export async function discardReceipt(
  services: ImportServices,
  receiptId: string,
): Promise<boolean> {
  const db = await services.getDb();
  const deleted = await deleteReceipt(db, receiptId, storageContext(services));
  closeReviewSession(receiptId);
  return deleted;
}
