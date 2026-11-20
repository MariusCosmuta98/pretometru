import type { Chain, Line } from '@/domain';
import type { PretometruDB } from '@/storage';

/** Live lines that point at a product (drafts included). */
export function linesOfProduct(db: PretometruDB, productId: string): Promise<Line[]> {
  return db.lines
    .where('productId')
    .equals(productId)
    .filter((line) => line.deletedAt === undefined)
    .toArray();
}

/** The chain of the store behind each receipt id, for the receipts and stores that still exist. */
export async function chainsByReceipt(
  db: PretometruDB,
  receiptIds: Iterable<string>,
): Promise<Map<string, Chain>> {
  const ids = [...new Set(receiptIds)];
  const receipts = await db.receipts.bulkGet(ids);
  const storeIds = [...new Set(receipts.flatMap((receipt) => (receipt ? [receipt.storeId] : [])))];
  const stores = await db.stores.bulkGet(storeIds);
  const chainByStore = new Map(stores.flatMap((store) => (store ? [[store.id, store.chain]] : [])));

  const chains = new Map<string, Chain>();
  ids.forEach((id, index) => {
    const chain = chainByStore.get(receipts[index]?.storeId ?? '');
    if (chain !== undefined) chains.set(id, chain);
  });
  return chains;
}
