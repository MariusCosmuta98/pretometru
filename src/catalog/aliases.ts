import { normalizeName, type Alias, type Chain } from '@/domain';
import {
  createRecord,
  getActive,
  updateRecord,
  type PretometruDB,
  type RecordPatch,
  type StorageContext,
} from '@/storage';
import { clonePack, samePack } from './packs';
import { applyDefaultPack } from './line-packs';
import type { MappingChoice, PackChoice } from './types';

async function rememberOne(
  db: PretometruDB,
  chain: Chain,
  choice: MappingChoice,
  context: StorageContext | undefined,
): Promise<void> {
  const rawName = choice.rawName.trim();
  const normName = normalizeName(rawName);
  if (normName === '') return;
  if (!(await getActive(db.products, choice.productId))) {
    throw new RangeError(`Unknown product ${choice.productId}`);
  }

  const [existing] = (
    await db.aliases
      .where('[chain+normName]')
      .equals([chain, normName])
      .filter((alias) => alias.deletedAt === undefined)
      .toArray()
  ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));

  if (!existing) {
    const created = await createRecord(
      db.aliases,
      {
        chain,
        normName,
        rawName,
        ...(choice.ean !== undefined ? { ean: choice.ean } : {}),
        productId: choice.productId,
        ...(choice.pack ? { defaultPack: clonePack(choice.pack) } : {}),
      },
      context,
    );
    if (created.defaultPack) await applyDefaultPack(db, created, undefined, context);
    return;
  }

  // Only write when something changed: re-confirming a known receipt must not churn `updatedAt`.
  const patch: RecordPatch<Alias> = {};
  if (existing.productId !== choice.productId) patch.productId = choice.productId;
  if (choice.ean !== undefined && existing.ean !== choice.ean) patch.ean = choice.ean;
  if (existing.rawName === undefined) patch.rawName = rawName;
  if (choice.pack !== undefined && !samePack(existing.defaultPack, choice.pack)) {
    patch.defaultPack = clonePack(choice.pack);
  }
  if (Object.keys(patch).length === 0) return;
  const updated = await updateRecord(db.aliases, existing.id, patch, context);
  if (updated && patch.defaultPack) {
    await applyDefaultPack(db, updated, existing.defaultPack, context);
  }
}

/**
 * Remembers confirmed matches so the next import is automatic: one alias per chain and normalised
 * printed name, carrying the EAN and the pack size when the choice has them. A name that was
 * already known is re-pointed at the chosen product (the user changed their mind). When a pack
 * size is new or changed, the stored lines of that alias are re-derived (see `applyDefaultPack`).
 * All or nothing.
 */
export async function rememberMappings(
  db: PretometruDB,
  chain: Chain,
  choices: readonly MappingChoice[],
  context?: StorageContext,
): Promise<void> {
  if (choices.length === 0) return;
  await db.transaction(
    'rw',
    [db.aliases, db.products, db.lines, db.receipts, db.stores],
    async () => {
      for (const choice of choices) await rememberOne(db, chain, choice, context);
    },
  );
}

/**
 * Sets (or, with `undefined`, clears) the pack size an alias assumes when the printed name has
 * none, and re-derives the unit prices of the stored lines that used the old size. Returns the
 * updated alias, or `undefined` when it does not exist.
 */
export async function setAliasDefaultPack(
  db: PretometruDB,
  aliasId: string,
  pack: PackChoice | undefined,
  context?: StorageContext,
): Promise<Alias | undefined> {
  return db.transaction('rw', [db.aliases, db.lines, db.receipts, db.stores], async () => {
    const current = await getActive(db.aliases, aliasId);
    if (!current || samePack(current.defaultPack, pack)) return current;
    const updated = await updateRecord(
      db.aliases,
      aliasId,
      { defaultPack: pack ? clonePack(pack) : undefined },
      context,
    );
    if (updated) await applyDefaultPack(db, updated, current.defaultPack, context);
    return updated;
  });
}
