import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  isPortableSetting,
  parseBackup,
  serializeBackup,
  SYNCED_ENTITY_SCHEMAS,
  todayKey,
  type Backup,
  type BackupData,
  type SyncedTableName,
} from '@/domain';
import {
  exportBackup,
  getSetting,
  importBackup,
  setSetting,
  type ImportMode,
  type PretometruDB,
  type SkippedRecord,
  type StorageContext,
} from '@/storage';
import type { Table } from 'dexie';

export type BackupTable = keyof BackupData;

// Written in the order a person expects to read it; the compiler checks that no table is missing.
const DISPLAY_ORDER: Record<BackupTable, true> = {
  receipts: true,
  lines: true,
  products: true,
  categories: true,
  stores: true,
  aliases: true,
  lists: true,
  listItems: true,
  settings: true,
};
export const BACKUP_TABLES = Object.keys(DISPLAY_ORDER) as BackupTable[];

const SYNCED_TABLES = Object.keys(SYNCED_ENTITY_SCHEMAS) as SyncedTableName[];

/** What a backup is named for the user: `pretometru-2026-11-20.pretometru-backup.json`. */
export const BACKUP_FILE_SUFFIX = '.pretometru-backup.json';

/** A backup of years of receipts is a few MB; a file far beyond that is not one, and would stall the page. */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export function backupFileName(now: Date): string {
  return `pretometru-${todayKey(now)}${BACKUP_FILE_SUFFIX}`;
}

/** Records of one table: those in use and the tombstones that carry deletions. */
export interface TableCount {
  table: BackupTable;
  live: number;
  deleted: number;
}

export function countBackup(data: BackupData): TableCount[] {
  return BACKUP_TABLES.map((table) => {
    const rows: ReadonlyArray<{ deletedAt?: string | undefined }> = data[table];
    const deleted = rows.filter((row) => row.deletedAt !== undefined).length;
    return { table, live: rows.length - deleted, deleted };
  });
}

type Row = { deletedAt?: string | undefined };

/** The same counts for what this device holds, i.e. what an export would contain. */
export function countLocalData(db: PretometruDB): Promise<TableCount[]> {
  const synced = SYNCED_TABLES.map((name) => db[name] as unknown as Table<Row, string>);
  return db.transaction('r', [...synced, db.settings], async () => {
    const counts = new Map<BackupTable, { live: number; deleted: number }>();
    for (const name of SYNCED_TABLES) {
      const table = db[name] as unknown as Table<Row, string>;
      // Only a tombstone has a `deletedAt`, so the index holds exactly the deleted records.
      const [total, deleted] = await Promise.all([
        table.count(),
        table.where('deletedAt').above('').count(),
      ]);
      counts.set(name, { live: total - deleted, deleted });
    }
    const portable = (await db.settings.toArray()).filter((row) => isPortableSetting(row.key));
    const deleted = portable.filter((row) => row.deletedAt !== undefined).length;
    counts.set('settings', { live: portable.length - deleted, deleted });
    return BACKUP_TABLES.map((table) => ({
      table,
      ...(counts.get(table) ?? { live: 0, deleted: 0 }),
    }));
  });
}

/** When this device last exported a backup file, if it ever did. */
export async function getLastExportAt(db: PretometruDB): Promise<string | undefined> {
  return (await getSetting(db, 'lastExportAt')) ?? undefined;
}

/** Remembers the export. The screen calls it once the file has been handed to the browser. */
export function recordExport(
  db: PretometruDB,
  exportedAt: string,
  context?: StorageContext,
): Promise<void> {
  return setSetting(db, 'lastExportAt', exportedAt, context);
}

export interface PreparedExport {
  fileName: string;
  /** The backup file's content: JSON, one trailing newline. */
  text: string;
  bytes: number;
  exportedAt: string;
  counts: TableCount[];
  /** Stored records that no longer satisfy their schema and were left out. */
  skipped: SkippedRecord[];
}

/**
 * Everything the user owns, tombstones included, as the text of a backup file. Sync state and
 * settings that are not portable (tokens, API keys, device values such as the last export) are
 * never in it. Nothing is written and nothing leaves the device: the screen offers the text as a
 * download.
 */
export async function prepareExport(
  db: PretometruDB,
  now: Date = new Date(),
): Promise<PreparedExport> {
  const { backup, skipped } = await exportBackup(db, now);
  const text = serializeBackup(backup);
  return {
    fileName: backupFileName(now),
    text,
    bytes: new TextEncoder().encode(text).length,
    exportedAt: backup.exportedAt,
    counts: countBackup(backup.data),
    skipped,
  };
}

export type DanglingSubject =
  'receipts' | 'lines' | 'products' | 'aliases' | 'categories' | 'listItems';
export type DanglingTarget =
  'store' | 'receipt' | 'product' | 'category' | 'parentCategory' | 'list';

/** What `parseBackup` found worth saying about a file that is valid. */
export type BackupWarning =
  /** `count` records of `subject` point at a `target` that is not in the file (allowed, but worth knowing). */
  | { kind: 'dangling'; count: number; subject: DanglingSubject; target: DanglingTarget }
  | { kind: 'other'; text: string };

export type BackupRefusal =
  /** The file could not be read at all. */
  | { code: 'unreadable' }
  | { code: 'too-large'; bytes: number; limit: number }
  | { code: 'not-json' }
  /** Valid JSON, but not a Pretometru backup. */
  | { code: 'not-backup' }
  /** Written by a newer version of the app: importing it would lose what this one does not know. */
  | { code: 'newer-version'; formatVersion: number; supportedVersion: number }
  /** A Pretometru backup that breaks the contract; `details` are the technical reasons, in English. */
  | { code: 'invalid'; details: string[] };

export interface BackupPreview {
  /** Validated and ready for `applyBackup`. */
  backup: Backup;
  formatVersion: number;
  exportedAt: string;
  counts: TableCount[];
  warnings: BackupWarning[];
}

export type PreviewResult =
  { ok: true; preview: BackupPreview } | { ok: false; refusal: BackupRefusal };

const SUBJECTS: Readonly<Record<string, DanglingSubject>> = {
  'receipt(s)': 'receipts',
  'line(s)': 'lines',
  'product(s)': 'products',
  'alias(es)': 'aliases',
  'category(ies)': 'categories',
  'list item(s)': 'listItems',
};
const TARGETS: Readonly<Record<string, DanglingTarget>> = {
  store: 'store',
  receipt: 'receipt',
  product: 'product',
  category: 'category',
  'parent category': 'parentCategory',
  list: 'list',
};
// The wording of `danglingReferenceWarnings` in src/domain/backup.ts; backup.test.ts pins every combination.
const DANGLING = /^(\d+) (.+) reference a (.+) that is not in the backup$/;

function describeWarning(text: string): BackupWarning {
  const match = DANGLING.exec(text);
  const subject = SUBJECTS[match?.[2] ?? ''];
  const target = TARGETS[match?.[3] ?? ''];
  if (match && subject && target) {
    return { kind: 'dangling', count: Number(match[1]), subject, target };
  }
  return { kind: 'other', text };
}

function readFormatVersion(json: unknown): number | undefined {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return undefined;
  const { format, formatVersion } = json as Record<string, unknown>;
  const valid =
    typeof formatVersion === 'number' && Number.isInteger(formatVersion) && formatVersion >= 1;
  return format === BACKUP_FORMAT && valid ? formatVersion : undefined;
}

/** Tells apart what `parseBackup` reports as English text, so the screen can answer in Romanian. */
function refusalFor(text: string, errors: readonly string[]): BackupRefusal {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { code: 'not-json' };
  }
  const formatVersion = readFormatVersion(json);
  if (formatVersion === undefined) return { code: 'not-backup' };
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    return { code: 'newer-version', formatVersion, supportedVersion: BACKUP_FORMAT_VERSION };
  }
  return { code: 'invalid', details: [...errors] };
}

/**
 * Checks the text of a backup file (`parseBackup`) and summarises it for the preview. Nothing is
 * written. A file from a newer version of the app is refused, never imported partially.
 */
export function previewBackup(text: string): PreviewResult {
  // Windows editors save UTF-8 with a byte order mark, which JSON does not allow.
  const content = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const parsed = parseBackup(content);
  if (!parsed.ok) return { ok: false, refusal: refusalFor(content, parsed.errors) };

  const { backup } = parsed;
  return {
    ok: true,
    preview: {
      backup,
      formatVersion: backup.formatVersion,
      exportedAt: backup.exportedAt,
      counts: countBackup(backup.data),
      warnings: parsed.warnings.map(describeWarning),
    },
  };
}

/** What `readBackupFile` needs of a `File`. */
export interface BackupFileLike {
  readonly size: number;
  text(): Promise<string>;
}

/** Reads a file the user picked and previews it. Never throws. */
export async function readBackupFile(file: BackupFileLike): Promise<PreviewResult> {
  if (file.size > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      refusal: { code: 'too-large', bytes: file.size, limit: MAX_BACKUP_BYTES },
    };
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, refusal: { code: 'unreadable' } };
  }
  // Validating a big file blocks the page for a moment: let "reading..." be painted first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  return previewBackup(text);
}

export interface TableChange {
  table: BackupTable;
  added: number;
  updated: number;
  unchanged: number;
}

export interface ImportSummary {
  mode: ImportMode;
  tables: TableChange[];
  added: number;
  updated: number;
  unchanged: number;
  /** Settings in the file that are not portable and were ignored. */
  ignoredSettings: number;
}

/**
 * Imports a previewed backup in one transaction (all or nothing). `merge` keeps what the device
 * holds and takes, record by record, whichever copy was changed last (a newer deletion deletes);
 * `replace` makes the file the data (the device's own settings and sync state stay). Rejects when
 * the database refuses, in which case nothing changed.
 */
export async function applyBackup(
  db: PretometruDB,
  backup: Backup,
  mode: ImportMode = 'merge',
): Promise<ImportSummary> {
  const report = await importBackup(db, backup, { mode });
  const tables = BACKUP_TABLES.map((table) => ({
    table,
    ...(report.tables[table] ?? { added: 0, updated: 0, unchanged: 0 }),
  }));
  const sum = (key: 'added' | 'updated' | 'unchanged') =>
    tables.reduce((total, change) => total + change[key], 0);
  return {
    mode,
    tables,
    added: sum('added'),
    updated: sum('updated'),
    unchanged: sum('unchanged'),
    ignoredSettings: backup.data.settings.filter((row) => !isPortableSetting(row.key)).length,
  };
}
