import type { Table } from 'dexie';
import {
  newId,
  SEED_CATEGORIES,
  SYNCED_ENTITY_SCHEMAS,
  type Line,
  type SyncedTableName,
} from '@/domain';
import { withDerivedPricing, type LineFields } from './line-pricing';

/** Injectable clock and id source, so tests (and imports) stay deterministic. */
export interface StorageContext {
  now?: () => Date;
  newId?: () => string;
}

interface SyncedRecord {
  id: string;
  updatedAt: string;
  deletedAt?: string | undefined;
}

export type NewRecord<T extends SyncedRecord> = Omit<T, keyof SyncedRecord> & { id?: string };
export type RecordPatch<T extends SyncedRecord> = Partial<Omit<T, keyof SyncedRecord>>;

export function resolveContext(context?: StorageContext) {
  return { now: context?.now ?? (() => new Date()), newId: context?.newId ?? newId };
}

/** Throws a ZodError when the record breaks its contract (and for tables that are not synced). */
export function assertValidRecord(table: Table<unknown, string>, record: unknown): void {
  const schema = SYNCED_ENTITY_SCHEMAS[table.name as SyncedTableName] as
    (typeof SYNCED_ENTITY_SCHEMAS)[SyncedTableName] | undefined;
  if (!schema) throw new Error(`"${table.name}" is not a synced table`);
  schema.parse(record);
}

/** Adds a new record with a fresh id and `updatedAt`. Rejects an existing id. Not for lines (see `saveReceipt`). */
export async function createRecord<T extends SyncedRecord>(
  table: Table<T, string>,
  data: NewRecord<T>,
  context?: StorageContext,
): Promise<T> {
  if (table.name === 'lines') {
    throw new Error('Lines are created with saveReceipt, which derives their unit prices');
  }
  const { now, newId: generateId } = resolveContext(context);
  const record = {
    ...data,
    id: data.id ?? generateId(),
    updatedAt: now().toISOString(),
  } as unknown as T;
  assertValidRecord(table, record);
  await table.add(record);
  return record;
}

/**
 * Merges `patch` into a live record and bumps `updatedAt`; `undefined` if missing or deleted.
 * A line's derived unit prices are recomputed, so changing its total, quantity or pack is safe.
 */
export function updateRecord<T extends SyncedRecord>(
  table: Table<T, string>,
  id: string,
  patch: RecordPatch<T>,
  context?: StorageContext,
): Promise<T | undefined> {
  const { now } = resolveContext(context);
  return table.db.transaction('rw', table, async () => {
    const current = await table.get(id);
    if (!current || current.deletedAt !== undefined) return undefined;
    const merged = { ...current, ...patch, id, updatedAt: now().toISOString() };
    const next =
      table.name === 'lines'
        ? (withDerivedPricing(merged as unknown as LineFields) as unknown as Line & T)
        : merged;
    assertValidRecord(table, next);
    await table.put(next);
    return next;
  });
}

/** Marks a record deleted (tombstone) so the deletion can sync. `false` if nothing was deleted. */
export function softDelete<T extends SyncedRecord>(
  table: Table<T, string>,
  id: string,
  context?: StorageContext,
): Promise<boolean> {
  const { now } = resolveContext(context);
  return table.db.transaction('rw', table, async () => {
    const current = await table.get(id);
    if (!current || current.deletedAt !== undefined) return false;
    const stamp = now().toISOString();
    await table.put({ ...current, updatedAt: stamp, deletedAt: stamp });
    return true;
  });
}

export async function getActive<T extends SyncedRecord>(
  table: Table<T, string>,
  id: string,
): Promise<T | undefined> {
  const record = await table.get(id);
  return record?.deletedAt === undefined ? record : undefined;
}

/** Live records in primary-key (creation) order. */
export function listActive<T extends SyncedRecord>(table: Table<T, string>): Promise<T[]> {
  return table.filter((record) => record.deletedAt === undefined).toArray();
}

/**
 * Hard-deletes tombstones older than `olderThan`; returns how many were removed. The tombstones of
 * seed categories are kept: without them `ensureSeed` would bring a deleted category back.
 */
export function purgeTombstones<T extends SyncedRecord>(
  table: Table<T, string>,
  olderThan: Date,
): Promise<number> {
  const seedIds =
    table.name === 'categories'
      ? new Set(SEED_CATEGORIES.map((category) => category.id))
      : undefined;
  return table
    .where('deletedAt')
    .below(olderThan.toISOString())
    .filter((record) => !seedIds?.has(record.id))
    .delete();
}
