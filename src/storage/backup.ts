import type { Table } from 'dexie';
import type { z } from 'zod';
import {
  createBackup,
  isPortableSetting,
  KeyValueSchema,
  SYNCED_ENTITY_SCHEMAS,
  validateBackup,
  type Backup,
  type SyncedTableName,
} from '@/domain';
import type { PretometruDB } from './db';
import { reconcileReceiptLines } from './receipts';
import { ensureSeed } from './seed';

const SYNCED_TABLES = Object.keys(SYNCED_ENTITY_SCHEMAS) as SyncedTableName[];

/** A stored record that could not be exported because it no longer satisfies its schema. */
export interface SkippedRecord {
  table: string;
  id: string;
  reason: string;
}

export interface BackupExport {
  backup: Backup;
  skipped: SkippedRecord[];
}

function keepValid<S extends z.ZodType>(
  table: string,
  schema: S,
  rows: readonly unknown[],
  skipped: SkippedRecord[],
): Array<z.infer<S>> {
  const valid: Array<z.infer<S>> = [];
  for (const row of rows) {
    const result = schema.safeParse(row);
    if (result.success) {
      valid.push(result.data);
    } else {
      const { id, key } = row as { id?: string; key?: string };
      const issue = result.error.issues[0];
      skipped.push({
        table,
        id: id ?? key ?? '(unknown)',
        reason: issue ? `${issue.path.map(String).join('.')}: ${issue.message}` : 'invalid record',
      });
    }
  }
  return valid;
}

/**
 * Everything the user owns, tombstones included, as a validated `Backup`. Sync state and settings
 * that are not marked portable (tokens, API keys, device values) are never exported. A stored
 * record that no longer satisfies its schema (an older version, a raw write) is left out and
 * listed in `skipped`, so one bad row cannot block every backup.
 */
export async function exportBackup(
  db: PretometruDB,
  now: Date = new Date(),
): Promise<BackupExport> {
  const skipped: SkippedRecord[] = [];
  const backup = await db.transaction(
    'r',
    [
      db.stores,
      db.receipts,
      db.lines,
      db.products,
      db.aliases,
      db.categories,
      db.lists,
      db.listItems,
      db.settings,
    ],
    async () => {
      const schemas = SYNCED_ENTITY_SCHEMAS;
      return createBackup(
        {
          stores: keepValid('stores', schemas.stores, await db.stores.toArray(), skipped),
          receipts: keepValid('receipts', schemas.receipts, await db.receipts.toArray(), skipped),
          lines: keepValid('lines', schemas.lines, await db.lines.toArray(), skipped),
          products: keepValid('products', schemas.products, await db.products.toArray(), skipped),
          aliases: keepValid('aliases', schemas.aliases, await db.aliases.toArray(), skipped),
          categories: keepValid(
            'categories',
            schemas.categories,
            await db.categories.toArray(),
            skipped,
          ),
          lists: keepValid('lists', schemas.lists, await db.lists.toArray(), skipped),
          listItems: keepValid(
            'listItems',
            schemas.listItems,
            await db.listItems.toArray(),
            skipped,
          ),
          settings: keepValid(
            'settings',
            KeyValueSchema,
            (await db.settings.toArray()).filter((row) => isPortableSetting(row.key)),
            skipped,
          ),
        },
        now,
      );
    },
  );
  return { backup, skipped };
}

/** `merge`: last write wins per record. `replace`: the backup becomes the data (device-local settings and sync state stay). */
export type ImportMode = 'merge' | 'replace';

export interface TableReport {
  added: number;
  updated: number;
  unchanged: number;
}

export interface ImportReport {
  mode: ImportMode;
  tables: Record<string, TableReport>;
  warnings: string[];
}

interface Row {
  updatedAt: string;
}

async function mergeRows<T extends Row>(
  table: Table<T, string>,
  rows: readonly T[],
  keyOf: (row: T) => string,
): Promise<TableReport> {
  const existing = await table.bulkGet(rows.map(keyOf));
  const toWrite: T[] = [];
  const report: TableReport = { added: 0, updated: 0, unchanged: 0 };

  rows.forEach((row, index) => {
    const current = existing[index];
    if (current === undefined) {
      report.added += 1;
      toWrite.push(row);
    } else if (row.updatedAt > current.updatedAt) {
      report.updated += 1;
      toWrite.push(row);
    } else {
      report.unchanged += 1;
    }
  });

  await table.bulkPut(toWrite);
  return report;
}

/**
 * Applies a backup in one transaction (all or nothing); throws if it is not a valid backup.
 * Records are compared by `updatedAt` (ISO strings): the newer copy wins, and a newer tombstone
 * deletes. Afterwards each touched receipt's lines are reconciled (see `reconcileReceiptLines`).
 * Settings that are not portable are ignored. The seed categories are re-created if missing.
 */
export async function importBackup(
  db: PretometruDB,
  backup: Backup,
  options: { mode?: ImportMode } = {},
): Promise<ImportReport> {
  const checked = validateBackup(backup);
  if (!checked.ok) throw new Error(`Invalid backup: ${checked.errors.join('; ')}`);
  const { data } = checked.backup;

  const mode = options.mode ?? 'merge';
  const report: ImportReport = { mode, tables: {}, warnings: [] };
  const syncedTables = SYNCED_TABLES.map(
    (name) => db[name] as unknown as Table<Row & { id: string }, string>,
  );

  await db.transaction('rw', [...syncedTables, db.settings], async () => {
    if (mode === 'replace') {
      for (const table of syncedTables) await table.clear();
      const portable = (await db.settings.toArray()).filter((row) => isPortableSetting(row.key));
      await db.settings.bulkDelete(portable.map((row) => row.key));
    }

    for (const name of SYNCED_TABLES) {
      const table = db[name] as unknown as Table<Row & { id: string }, string>;
      const rows = data[name] as Array<Row & { id: string }>;
      report.tables[name] = await mergeRows(table, rows, (row) => row.id);
    }

    const portableSettings = data.settings.filter((row) => isPortableSetting(row.key));
    const skipped = data.settings.length - portableSettings.length;
    if (skipped > 0) report.warnings.push(`${skipped} setting(s) skipped: not portable`);
    report.tables.settings = await mergeRows(db.settings, portableSettings, (row) => row.key);

    await reconcileReceiptLines(db, [
      ...data.receipts.map((receipt) => receipt.id),
      ...data.lines.map((line) => line.receiptId),
    ]);
  });

  await ensureSeed(db);
  return report;
}
