import {
  KeyValueSchema,
  SYNCED_ENTITY_SCHEMAS,
  type BackupData,
  type SyncedTableName,
} from '@/domain';
import { SyncError } from './errors';

/** Every table a sync carries: the synced entity tables plus the portable settings. */
export type SyncTable = keyof BackupData;
export const SYNC_TABLES: readonly SyncTable[] = [
  ...(Object.keys(SYNCED_ENTITY_SCHEMAS) as SyncedTableName[]),
  'settings',
];

/** One persisted record as the sync handles it, tombstones included. */
export interface SyncRecord {
  table: SyncTable;
  /** `id` of a synced record, `key` of a setting. */
  key: string;
  updatedAt: string;
  /** The record as one line of JSON: what a shard file holds, and what two copies are compared by. */
  text: string;
  /** The validated record. */
  value: BackupData[SyncTable][number];
}

export function makeRecord(table: SyncTable, value: SyncRecord['value']): SyncRecord {
  return {
    table,
    key: 'key' in value ? value.key : value.id,
    updatedAt: value.updatedAt,
    text: JSON.stringify(value),
    value,
  };
}

/** The identity of a record across tables, for maps. */
export const identityOf = (record: Pick<SyncRecord, 'table' | 'key'>): string =>
  `${record.table}/${record.key}`;

export function fromBackupData(data: BackupData): SyncRecord[] {
  return SYNC_TABLES.flatMap((table) =>
    (data[table] as ReadonlyArray<SyncRecord['value']>).map((value) => makeRecord(table, value)),
  );
}

export function toBackupData(records: Iterable<SyncRecord>): BackupData {
  const data: BackupData = {
    stores: [],
    receipts: [],
    lines: [],
    products: [],
    aliases: [],
    categories: [],
    lists: [],
    listItems: [],
    settings: [],
  };
  for (const record of records) (data[record.table] as unknown[]).push(record.value);
  return data;
}

/**
 * The copy that last-write-wins keeps. A tie keeps `current`: both sides apply the same rule to
 * the same data, so equal timestamps never make the two sides trade places.
 */
export function newerOf(current: SyncRecord, candidate: SyncRecord): SyncRecord {
  return candidate.updatedAt > current.updatedAt ? candidate : current;
}

/** Adds `records` to `base`; per record the newer `updatedAt` wins and a tie keeps what `base` has. */
export function overlay(base: Map<string, SyncRecord>, records: Iterable<SyncRecord>) {
  for (const record of records) {
    const id = identityOf(record);
    const current = base.get(id);
    base.set(id, current === undefined ? record : newerOf(current, record));
  }
  return base;
}

/** Validates what a data file holds, so that nothing malformed ever reaches the local database. */
export function validateRecords(
  table: SyncTable,
  values: readonly unknown[],
  path: string,
): SyncRecord[] {
  const schema = table === 'settings' ? KeyValueSchema : SYNCED_ENTITY_SCHEMAS[table];
  return values.map((raw, index) => {
    const result = schema.safeParse(raw);
    if (!result.success) {
      const issue = result.error.issues[0];
      const where = issue
        ? `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`
        : '';
      throw new SyncError('REMOTE_INVALID', `${path} holds an invalid record`, {
        detail: `${path}, record ${index + 1}${where ? ` (${where})` : ''}`,
      });
    }
    return makeRecord(table, result.data);
  });
}
