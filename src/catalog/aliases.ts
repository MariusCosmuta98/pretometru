import { normalizeName, type Alias, type Chain } from '@/domain';
import {
  createRecord,
  getActive,
  updateRecord,
  type PretometruDB,
  type RecordPatch,
  type StorageContext,
} from '@/storage';
import { applyDefaultPack } from './line-packs';
import { clonePack, samePack } from './packs';
import type { MappingChoice, PackChoice } from './types';

/** Returns the id of an alias that learned its first pack size, so stored lines can be filled in. */
async function rememberOne(
  db: PretometruDB,
  chain: Chain,
  choice: MappingChoice,
  context: StorageContext | undefined,
): Promise<string | undefined> {
  const rawName = choice.rawName.trim();
  const normName = normalizeName(rawName);
  if (normName === '') return undefined;
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
    return created.defaultPack ? created.id : undefined;
  }

  // Only write when something changed: re-confirming a known receipt must not churn `updatedAt`.
  const patch: RecordPatch<Alias> = {};
  if (existing.productId !== choice.productId) patch.productId = choice.productId;
  if (choice.ean !== undefined && existing.ean !== choice.ean) patch.ean = choice.ean;
  if (existing.rawName === undefined) patch.rawName = rawName;
  if (choice.pack !== undefined && !samePack(existing.defaultPack, choice.pack)) {
    patch.defaultPack = clonePack(choice.pack);
  }
  if (Object.keys(patch).length === 0) return undefined;
  await updateRecord(db.aliases, existing.id, patch, context);
  return patch.defaultPack && existing.defaultPack === undefined ? existing.id : undefined;
}

/**
 * Remembers confirmed matches so the next import is automatic: one alias per chain and normalised
 * printed name, carrying the EAN and the pack size when the choice has them. A name that was
 * already known is re-pointed at the chosen product (the user changed their mind).
 *
 * Pack sizes: the first size learned for a name also fills in the stored lines of that alias that
 * have none (see `applyDefaultPack`), once the whole batch is in. A later, different size becomes
 * the new suggestion for the next import without touching stored lines: whether an older line
 * "has the default" or carries a size somebody typed cannot be told, so confirming a receipt never
 * re-prices other receipts. `setAliasDefaultPack` is the deliberate way to do that. All or nothing.
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
      const learned = new Set<string>();
      for (const choice of choices) {
        const id = await rememberOne(db, chain, choice, context);
        if (id !== undefined) learned.add(id);
      }
      for (const id of learned) {
        const alias = await getActive(db.aliases, id);
        if (alias?.defaultPack) await applyDefaultPack(db, alias, undefined, context);
      }
    },
  );
}

/**
 * Sets (or, with `undefined`, clears) the pack size an alias assumes when the printed name has
 * none, and re-derives the unit prices of the stored lines that used the old size (those with no
 * size, or with exactly the old one). Returns the updated alias, or `undefined` when it does not
 * exist.
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
