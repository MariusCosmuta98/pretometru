import { z } from 'zod';
import { InstantSchema } from './common';
import { KeyValueSchema, SYNCED_ENTITY_SCHEMAS } from './entities';

export const BACKUP_FORMAT = 'pretometru-backup';
export const BACKUP_FORMAT_VERSION = 1;

const BackupDataSchema = z.strictObject({
  stores: z.array(SYNCED_ENTITY_SCHEMAS.stores),
  receipts: z.array(SYNCED_ENTITY_SCHEMAS.receipts),
  lines: z.array(SYNCED_ENTITY_SCHEMAS.lines),
  products: z.array(SYNCED_ENTITY_SCHEMAS.products),
  aliases: z.array(SYNCED_ENTITY_SCHEMAS.aliases),
  categories: z.array(SYNCED_ENTITY_SCHEMAS.categories),
  lists: z.array(SYNCED_ENTITY_SCHEMAS.lists),
  listItems: z.array(SYNCED_ENTITY_SCHEMAS.listItems),
  /** Portable settings only (see `isPortableSetting`). Sync state and secrets are never exported. */
  settings: z.array(KeyValueSchema),
});

export const BackupSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.literal(BACKUP_FORMAT_VERSION),
  exportedAt: InstantSchema,
  data: BackupDataSchema,
});
export type Backup = z.infer<typeof BackupSchema>;
export type BackupData = Backup['data'];

export function createBackup(data: BackupData, exportedAt: Date): Backup {
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    data,
  };
}

export function serializeBackup(backup: Backup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export type ParsedBackup =
  { ok: true; backup: Backup; warnings: string[] } | { ok: false; errors: string[] };

const HeaderSchema = z.looseObject({
  format: z.literal(BACKUP_FORMAT),
  formatVersion: z.int().min(1),
});

const MAX_REPORTED_ERRORS = 20;

function describeIssues(error: z.ZodError): string[] {
  const lines = error.issues.map(
    (issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`,
  );
  return lines.length > MAX_REPORTED_ERRORS
    ? [...lines.slice(0, MAX_REPORTED_ERRORS), `...and ${lines.length - MAX_REPORTED_ERRORS} more`]
    : lines;
}

function duplicateIds(data: BackupData): string[] {
  const tables: Array<[string, readonly { id?: string; key?: string }[]]> = Object.entries(data);
  return tables.flatMap(([table, rows]) => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const row of rows) {
      const id = row.id ?? row.key ?? '';
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }
    return [...duplicates].map((id) => `data.${table}: duplicate id ${id}`);
  });
}

const countMissing = <T>(
  rows: readonly T[],
  reference: (row: T) => string | undefined,
  known: ReadonlySet<string>,
) =>
  rows.filter((row) => {
    const id = reference(row);
    return id !== undefined && !known.has(id);
  }).length;

/** References are allowed to dangle (UI code must cope), but an import should say so. */
function danglingReferenceWarnings(data: BackupData): string[] {
  const idsOf = (rows: readonly { id: string }[]) => new Set(rows.map((row) => row.id));
  const stores = idsOf(data.stores);
  const receipts = idsOf(data.receipts);
  const products = idsOf(data.products);
  const categories = idsOf(data.categories);
  const lists = idsOf(data.lists);

  const checks: Array<[missing: number, subject: string, target: string]> = [
    [countMissing(data.receipts, (r) => r.storeId, stores), 'receipt(s)', 'store'],
    [countMissing(data.lines, (l) => l.receiptId, receipts), 'line(s)', 'receipt'],
    [countMissing(data.lines, (l) => l.productId, products), 'line(s)', 'product'],
    [countMissing(data.lines, (l) => l.categoryId, categories), 'line(s)', 'category'],
    [countMissing(data.products, (p) => p.categoryId, categories), 'product(s)', 'category'],
    [countMissing(data.aliases, (a) => a.productId, products), 'alias(es)', 'product'],
    [
      countMissing(data.categories, (c) => c.parentId, categories),
      'category(ies)',
      'parent category',
    ],
    [countMissing(data.listItems, (i) => i.listId, lists), 'list item(s)', 'list'],
    [countMissing(data.listItems, (i) => i.productId, products), 'list item(s)', 'product'],
  ];
  return checks
    .filter(([missing]) => missing > 0)
    .map(
      ([missing, subject, target]) =>
        `${missing} ${subject} reference a ${target} that is not in the backup`,
    );
}

/** Validates an already-parsed backup (schema, version, duplicate ids). May throw on hostile input. */
export function validateBackup(json: unknown): ParsedBackup {
  const header = HeaderSchema.safeParse(json);
  if (!header.success) return { ok: false, errors: ['This is not a Pretometru backup file.'] };
  if (header.data.formatVersion > BACKUP_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `This backup was written by a newer version of the app (format ${header.data.formatVersion}); update the app first.`,
      ],
    };
  }

  const result = BackupSchema.safeParse(json);
  if (!result.success) return { ok: false, errors: describeIssues(result.error) };

  const duplicates = duplicateIds(result.data.data);
  if (duplicates.length > 0) return { ok: false, errors: duplicates };

  return { ok: true, backup: result.data, warnings: danglingReferenceWarnings(result.data.data) };
}

/** Validates a backup file's text. Never throws: problems come back as `errors` for the UI to show. */
export function parseBackup(text: string): ParsedBackup {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, errors: ['The file is not valid JSON.'] };
  }

  try {
    return validateBackup(json);
  } catch {
    // For instance a value nested so deeply that validation overflows the stack.
    return {
      ok: false,
      errors: ['The file could not be validated: it is malformed or nested too deeply.'],
    };
  }
}
