import { NON_PRODUCT_CATEGORY_ID, parsePurchasedAt, type Line, type Receipt } from '@/domain';
import type { PretometruDB } from './db';
import { withDerivedPricing } from './line-pricing';
import {
  assertValidRecord,
  getActive,
  resolveContext,
  softDelete,
  type StorageContext,
} from './records';

/** A receipt as the importer or review screen builds it: no id/timestamps unless editing. */
export type ReceiptInput = Omit<Receipt, 'id' | 'updatedAt' | 'deletedAt' | 'linesUpdatedAt'> & {
  id?: string;
};

/**
 * A line as the importer or review screen builds it. The derived unit prices are never written by
 * callers: `saveReceipt` computes them from the line total, quantity and pack with `unitPricing`.
 */
export type LineInput = Omit<
  Line,
  | 'id'
  | 'updatedAt'
  | 'deletedAt'
  | 'receiptId'
  | 'paidUnitBani'
  | 'baseUnit'
  | 'pricePerBaseMilliBani'
> & { id?: string };

function toLine(input: LineInput, receiptId: string, id: string, updatedAt: string): Line {
  const { id: _ignored, ...fields } = input;
  const line = withDerivedPricing({ ...fields, id, receiptId, updatedAt });
  if (line.categoryId === undefined && line.kind !== 'product') {
    line.categoryId = NON_PRODUCT_CATEGORY_ID;
  }
  return line;
}

/**
 * Creates or edits a receipt and replaces its line set in one transaction (all or nothing).
 * Lines are matched by `id`: those present are updated, new ones created, and live lines missing
 * from `lines` are tombstoned. Non-product lines default to the Non-produs category.
 */
export function saveReceipt(
  db: PretometruDB,
  input: ReceiptInput,
  lines: readonly LineInput[],
  context?: StorageContext,
): Promise<{ receipt: Receipt; lines: Line[] }> {
  const { now, newId } = resolveContext(context);

  return db.transaction('rw', [db.receipts, db.lines], async () => {
    const stamp = now().toISOString();
    const receipt: Receipt = {
      ...input,
      id: input.id ?? newId(),
      updatedAt: stamp,
      linesUpdatedAt: stamp,
    };
    assertValidRecord(db.receipts, receipt);

    const previous = await db.lines.where('receiptId').equals(receipt.id).toArray();
    const previousIds = new Set(previous.map((line) => line.id));
    const keptIds = new Set<string>();

    const saved = lines.map((lineInput) => {
      const id = lineInput.id ?? newId();
      keptIds.add(id);
      const line = toLine(lineInput, receipt.id, id, stamp);
      assertValidRecord(db.lines, line);
      return line;
    });

    await db.receipts.put(receipt);
    for (const line of saved) {
      // `add` rejects an id that belongs to another receipt instead of overwriting its line.
      if (previousIds.has(line.id)) await db.lines.put(line);
      else await db.lines.add(line);
    }
    await db.lines.bulkPut(
      previous
        .filter((line) => line.deletedAt === undefined && !keptIds.has(line.id))
        .map((line) => ({ ...line, updatedAt: stamp, deletedAt: stamp })),
    );

    return { receipt, lines: saved };
  });
}

/** A live receipt with its live lines in printed order. */
export async function getReceiptWithLines(
  db: PretometruDB,
  id: string,
): Promise<{ receipt: Receipt; lines: Line[] } | undefined> {
  const receipt = await getActive(db.receipts, id);
  if (!receipt) return undefined;
  const lines = await db.lines
    .where('[receiptId+idx]')
    .between([id, Number.NEGATIVE_INFINITY], [id, Number.POSITIVE_INFINITY])
    .filter((line) => line.deletedAt === undefined)
    .toArray();
  return { receipt, lines };
}

/**
 * Tombstones live lines that belong to an older version of a receipt's line set: stamped before the
 * receipt's `linesUpdatedAt` (or before its deletion). A merge can leave such lines behind, for
 * example after two devices re-saved the same receipt. The tombstone carries the cutoff time, so
 * every device computes the same one. Lines edited after the save are kept. Returns how many lines
 * were tombstoned.
 */
export async function reconcileReceiptLines(
  db: PretometruDB,
  receiptIds: Iterable<string>,
): Promise<number> {
  let tombstoned = 0;
  for (const id of new Set(receiptIds)) {
    const receipt = await db.receipts.get(id);
    const cutoff = receipt?.deletedAt ?? receipt?.linesUpdatedAt;
    if (!receipt || cutoff === undefined) continue;

    const stale = await db.lines
      .where('receiptId')
      .equals(id)
      .filter((line) => line.deletedAt === undefined && line.updatedAt < cutoff)
      .toArray();
    await db.lines.bulkPut(
      stale.map((line) => ({ ...line, updatedAt: cutoff, deletedAt: cutoff })),
    );
    tombstoned += stale.length;
  }
  return tombstoned;
}

/** Tombstones a receipt together with its lines. `false` if there was no live receipt. */
export function deleteReceipt(
  db: PretometruDB,
  id: string,
  context?: StorageContext,
): Promise<boolean> {
  const stamp = resolveContext(context).now().toISOString();
  return db.transaction('rw', [db.receipts, db.lines], async () => {
    const deleted = await softDelete(db.receipts, id, { now: () => new Date(stamp) });
    if (!deleted) return false;
    const lines = await db.lines
      .where('receiptId')
      .equals(id)
      .filter((line) => line.deletedAt === undefined)
      .toArray();
    await db.lines.bulkPut(lines.map((line) => ({ ...line, updatedAt: stamp, deletedAt: stamp })));
    return true;
  });
}

export interface DuplicateCandidate {
  /** SHA-256 of the file being imported. */
  fileHash?: string;
  storeId?: string;
  purchasedAt?: string;
  totalBani?: number;
  receiptNo?: string;
  /** The receipt being edited, which is not a duplicate of itself. */
  excludeId?: string;
}

const compatibleNumbers = (a?: string, b?: string) => a === undefined || b === undefined || a === b;

/**
 * Live receipts that look like the candidate: the same file, or the same store, day and total
 * (and receipt number when both have one). Feeds the DUPLICATE warning.
 */
export async function findDuplicateReceipts(
  db: PretometruDB,
  candidate: DuplicateCandidate,
): Promise<Receipt[]> {
  const found = new Map<string, Receipt>();

  if (candidate.fileHash) {
    const sameFile = await db.receipts
      .where('source.fileHash')
      .equals(candidate.fileHash)
      .toArray();
    for (const receipt of sameFile) found.set(receipt.id, receipt);
  }

  const day = candidate.purchasedAt ? parsePurchasedAt(candidate.purchasedAt)?.date : undefined;
  if (candidate.storeId && day && candidate.totalBani !== undefined) {
    const sameDay = await db.receipts
      .where('[storeId+purchasedAt]')
      .between([candidate.storeId, day], [candidate.storeId, `${day}\uffff`])
      .toArray();
    for (const receipt of sameDay) {
      if (
        receipt.totalBani === candidate.totalBani &&
        compatibleNumbers(receipt.receiptNo, candidate.receiptNo)
      ) {
        found.set(receipt.id, receipt);
      }
    }
  }

  return [...found.values()].filter(
    (receipt) => receipt.deletedAt === undefined && receipt.id !== candidate.excludeId,
  );
}
