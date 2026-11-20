import { z } from 'zod';
import { idTimestamp, SYNCED_ENTITY_SCHEMAS } from '@/domain';
import { SyncError } from './errors';
import type { SyncRecord, SyncTable } from './records';

/*
 * Layout of the data repository (docs/architecture.md §13):
 *
 *   README.md                        written once, only when the app has to initialise an empty repository
 *   data/pretometru.json             { format, formatVersion }: the version gate
 *   data/settings.json               the portable settings
 *   data/<table>/<YYYY-MM>.json      the records of a table created in that month (UTC)
 *
 * A record's file follows from its id alone: a ULID starts with its creation time, which never
 * changes, so a record never moves between files and an edit touches one small file.
 */

/** What the manifest's `format` says: the repository holds Pretometru data. */
export const SYNC_FORMAT = 'pretometru-data';
/** Bump when the layout or the record contracts change in a way an older app cannot read. */
export const SYNC_FORMAT_VERSION = 1;

export const DATA_DIR = 'data';
export const MANIFEST_PATH = `${DATA_DIR}/pretometru.json`;
export const SETTINGS_PATH = `${DATA_DIR}/settings.json`;
export const README_PATH = 'README.md';

export const README_TEXT = `# Pretometru: date

Depozit privat folosit de aplicația Pretometru pentru sincronizare și backup.

- Fișierele din \`data/\` sunt scrise de aplicație. Nu le edita manual.
- Fiecare sincronizare este un commit: istoricul Git al acestui depozit este backup-ul datelor tale.
- Depozitul trebuie să rămână **privat**: conține bonurile și prețurile tale.
`;

/** Above this size a month's file is split by the first random character of the ids. */
export const MAX_SHARD_CHARS = 1_000_000;

// Records that were not created by a clock (the seed categories have well-known ids that decode to 0).
const FIRST_REAL_TIMESTAMP = Date.UTC(2000, 0, 1);
const LAST_BUCKET_TIMESTAMP = Date.UTC(9999, 11, 31);
// A ULID is 10 characters of time, then the random part; its first character spreads a big month.
const SPLIT_INDEX = 10;

export const SEED_BUCKET = 'seed';

/** The month (`2026-11`) a record was created in, from its ULID; `seed` for the built-in ids. */
export function bucketOf(id: string): string {
  const time = idTimestamp(id);
  if (time < FIRST_REAL_TIMESTAMP) return SEED_BUCKET;
  return new Date(Math.min(time, LAST_BUCKET_TIMESTAMP)).toISOString().slice(0, 7);
}

export function shardPath(table: SyncTable, bucket: string, part?: string): string {
  if (table === 'settings') return SETTINGS_PATH;
  return `${DATA_DIR}/${table}/${bucket}${part === undefined ? '' : `.${part}`}.json`;
}

const SHARD_PATH = new RegExp(
  `^${DATA_DIR}/(${Object.keys(SYNCED_ENTITY_SCHEMAS).join('|')})/[^/]+\\.json$`,
);

/** The table a data file belongs to, or `undefined` for anything that is not one of ours. */
export function tableOfShardPath(path: string): SyncTable | undefined {
  if (path === SETTINGS_PATH) return 'settings';
  return SHARD_PATH.exec(path)?.[1] as SyncTable | undefined;
}

/** One record per line, so that Git diffs and GitHub's file view show exactly the records that changed. */
export function serializeShard(records: readonly SyncRecord[]): string {
  const lines = records.map((record) => `    ${record.text}`).join(',\n');
  return `{\n  "records": [\n${lines}\n  ]\n}\n`;
}

const ShardFileSchema = z.strictObject({ records: z.array(z.unknown()) });

/** The raw records of a data file; they still have to pass `validateRecords`. */
export function parseShard(path: string, text: string): unknown[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new SyncError('REMOTE_INVALID', `${path} is not valid JSON`, { detail: path });
  }
  const result = ShardFileSchema.safeParse(json);
  if (!result.success) {
    throw new SyncError('REMOTE_INVALID', `${path} is not a Pretometru data file`, {
      detail: path,
    });
  }
  return result.data.records;
}

export function manifestText(): string {
  const manifest = { format: SYNC_FORMAT, formatVersion: SYNC_FORMAT_VERSION };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const ManifestHeaderSchema = z.looseObject({
  format: z.literal(SYNC_FORMAT),
  formatVersion: z.int().min(1),
});

/** Refuses a repository that is not Pretometru data, or that a newer app version has written. */
export function checkManifest(text: string): void {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  const header = ManifestHeaderSchema.safeParse(json);
  if (!header.success) {
    throw new SyncError('REMOTE_INVALID', `${MANIFEST_PATH} is not a Pretometru manifest`, {
      detail: MANIFEST_PATH,
    });
  }
  if (header.data.formatVersion > SYNC_FORMAT_VERSION) {
    throw new SyncError(
      'REMOTE_NEWER',
      `The repository uses data format ${header.data.formatVersion}, this app reads up to ${SYNC_FORMAT_VERSION}`,
      { detail: String(header.data.formatVersion) },
    );
  }
}

/** A data file as it should exist in the repository. */
export interface ShardFile {
  path: string;
  table: SyncTable;
  /** Sorted by key. */
  records: SyncRecord[];
  /** The file's content. */
  text: string;
}

const byKey = (a: SyncRecord, b: SyncRecord) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const byPath = (a: ShardFile, b: ShardFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * The files that hold `records`, as a pure function of the record set: devices that agree on the
 * records agree on every byte of every file, so identical data never produces a diff.
 */
export function planShards(records: Iterable<SyncRecord>): ShardFile[] {
  const months = new Map<string, { table: SyncTable; bucket: string; records: SyncRecord[] }>();
  for (const record of records) {
    const bucket = record.table === 'settings' ? '' : bucketOf(record.key);
    const id = `${record.table}/${bucket}`;
    const month = months.get(id) ?? { table: record.table, bucket, records: [] };
    month.records.push(record);
    months.set(id, month);
  }

  const files: ShardFile[] = [];
  for (const { table, bucket, records: inMonth } of months.values()) {
    inMonth.sort(byKey);
    const text = serializeShard(inMonth);
    if (table === 'settings' || text.length <= MAX_SHARD_CHARS) {
      files.push({ path: shardPath(table, bucket), table, records: inMonth, text });
      continue;
    }

    const parts = new Map<string, SyncRecord[]>();
    for (const record of inMonth) {
      const part = record.key.charAt(SPLIT_INDEX);
      const members = parts.get(part) ?? [];
      members.push(record);
      parts.set(part, members);
    }
    for (const [part, members] of parts) {
      files.push({
        path: shardPath(table, bucket, part),
        table,
        records: members,
        text: serializeShard(members),
      });
    }
  }
  return files.sort(byPath);
}
