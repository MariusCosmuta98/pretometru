import { normalizeName, type Alias, type Line } from '@/domain';
import { updateRecord, type PretometruDB, type StorageContext } from '@/storage';
import { chainsByReceipt, linesOfProduct } from './lines';
import { samePack } from './packs';
import type { PackChoice } from './types';

function packOf(line: Line): PackChoice | undefined {
  if (line.packQty === undefined || line.packUnit === undefined) return undefined;
  return {
    qty: line.packQty,
    unit: line.packUnit,
    ...(line.unitsPerPack !== undefined ? { unitsPerPack: line.unitsPerPack } : {}),
  };
}

/**
 * Brings the stored lines of an alias in line with its (new) `defaultPack`: the lines of the
 * alias's product, printed under the alias's name at the alias's chain, that have no size or still
 * carry the `previous` default. Their unit prices are re-derived by `updateRecord`. A line with a
 * size of its own (printed, or set by hand) is left alone. Returns the number of lines changed.
 * Call it inside the transaction that changed the alias.
 */
export async function applyDefaultPack(
  db: PretometruDB,
  alias: Alias,
  previous: PackChoice | undefined,
  context?: StorageContext,
): Promise<number> {
  const next = alias.defaultPack;
  const sameName = (await linesOfProduct(db, alias.productId)).filter(
    (line) =>
      line.kind === 'product' &&
      line.unit === 'buc' &&
      normalizeName(line.rawName) === alias.normName,
  );
  if (sameName.length === 0) return 0;

  const chains =
    alias.chain === undefined
      ? undefined
      : await chainsByReceipt(
          db,
          sameName.map((line) => line.receiptId),
        );

  let changed = 0;
  for (const line of sameName) {
    if (chains && chains.get(line.receiptId) !== alias.chain) continue;
    const current = packOf(line);
    if (current !== undefined && !samePack(current, previous)) continue;
    if (samePack(current, next)) continue;
    await updateRecord(
      db.lines,
      line.id,
      { packQty: next?.qty, packUnit: next?.unit, unitsPerPack: next?.unitsPerPack },
      context,
    );
    changed += 1;
  }
  return changed;
}
