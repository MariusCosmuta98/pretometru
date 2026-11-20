import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBackup,
  newId,
  serializeBackup,
  type BackupData,
  type SyncedTableName,
} from '@/domain';
import {
  makeAlias,
  makeCategory,
  makeLine,
  makeList,
  makeListItem,
  makeProduct,
  makeReceipt,
  makeStore,
} from '@/domain/testing';
import {
  createRecord,
  deleteReceipt,
  exportBackup,
  getKeyValue,
  getSetting,
  setKeyValue,
  setSetting,
  softDelete,
  updateRecord,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import {
  addCategory,
  applyBackup,
  backupFileName,
  BACKUP_TABLES,
  countLocalData,
  deleteCategory,
  deleteStore,
  getLastExportAt,
  MAX_BACKUP_BYTES,
  prepareExport,
  previewBackup,
  readBackupFile,
  recordExport,
  updateCategory,
  type BackupPreview,
  type BackupRefusal,
  type DanglingSubject,
  type DanglingTarget,
} from '.';
import { addProduct, addReceipt, addStore, SEED, seededTestDb } from './testing';

afterEach(() => {
  vi.unstubAllGlobals();
});

const at = (iso: string): StorageContext => ({ now: () => new Date(iso) });

const EMPTY: BackupData = {
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

/** What a device holds, the way a backup carries it. */
const snapshot = async (db: PretometruDB) => (await exportBackup(db)).backup.data;

/** A device with every kind of record, tombstones and settings of every kind. */
async function populate(db: PretometruDB) {
  const kaufland = await addStore(db, {
    name: 'Kaufland Cluj',
    branchCode: '1234',
    city: 'Cluj-Napoca',
  });
  const metro = await addStore(db, { chain: 'metro', name: 'METRO' });
  const closed = await addStore(db, { chain: 'lidl', name: 'Lidl vechi' });
  await deleteStore(db, closed.id);

  const milk = await addProduct(db, 'Lapte UHT', SEED.dairy.id);
  const dropped = await addProduct(db, 'Produs șters', SEED.other.id);
  await softDelete(db.products, dropped.id);

  const receipt = await addReceipt(db, kaufland.id, {
    lines: [
      { name: 'LAPTE UHT 1L', productId: milk.id, categoryId: SEED.dairy.id },
      { name: 'GARANTIE AMBALAJ', kind: 'deposit' },
    ],
  });
  const removed = await addReceipt(db, metro.id);
  await deleteReceipt(db, removed.id);

  await createRecord(db.aliases, {
    chain: 'kaufland',
    normName: 'lapte uht 1l',
    productId: milk.id,
  });
  const list = await createRecord(db.lists, { name: 'Săptămâna asta' });
  await createRecord(db.listItems, { listId: list.id, label: 'Pâine', checked: false, order: 0 });

  await updateCategory(db, SEED.grocery.id, { name: 'Alimente de bază' });
  const temporary = await addCategory(db, { name: 'Temporară', icon: '🍰', color: '#112233' });
  await deleteCategory(db, temporary.id);

  await setSetting(db, 'priceWindowDays', 120);
  await setSetting(db, 'lastExportAt', '2026-11-01T10:00:00.000Z');
  await setKeyValue(db.settings, 'geminiApiKey', 'not-a-real-secret');
  await setKeyValue(db.syncState, 'sync.token', 'not-a-real-token');
  return { kaufland, metro, closed, milk, dropped, receipt, removed, temporary };
}

function previewOf(text: string): BackupPreview {
  const result = previewBackup(text);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refusal)}`);
  return result.preview;
}

function refusalOf(text: string): BackupRefusal {
  const result = previewBackup(text);
  if (result.ok) throw new Error('accepted');
  return result.refusal;
}

describe('the file', () => {
  it.each([
    ['2026-11-20T12:00:00Z', '2026-11-20'],
    ['2026-11-20T22:30:00Z', '2026-11-21'],
    ['2026-07-20T21:30:00Z', '2026-07-21'],
  ])('is named for the Bucharest day of %s', (now, day) => {
    expect(backupFileName(new Date(now))).toBe(`pretometru-${day}.pretometru-backup.json`);
  });

  it('holds what the device holds, tombstones included, and counts it', async () => {
    const db = await seededTestDb();
    await populate(db);

    const prepared = await prepareExport(db, new Date('2026-11-20T12:00:00Z'));

    expect(prepared.fileName).toBe('pretometru-2026-11-20.pretometru-backup.json');
    expect(prepared.exportedAt).toBe('2026-11-20T12:00:00.000Z');
    expect(prepared.bytes).toBe(new TextEncoder().encode(prepared.text).length);
    expect(prepared.text.endsWith('}\n')).toBe(true);
    expect(prepared.skipped).toEqual([]);
    expect(prepared.counts.map((count) => count.table)).toEqual([...BACKUP_TABLES]);
    expect(prepared.counts).toEqual(await countLocalData(db));
    const byTable = Object.fromEntries(prepared.counts.map((count) => [count.table, count]));
    expect(byTable['stores']).toEqual({ table: 'stores', live: 2, deleted: 1 });
    expect(byTable['products']).toEqual({ table: 'products', live: 1, deleted: 1 });
    expect(byTable['receipts']).toEqual({ table: 'receipts', live: 1, deleted: 1 });
    expect(byTable['lines']).toEqual({ table: 'lines', live: 2, deleted: 1 });
    expect(byTable['categories']).toEqual({ table: 'categories', live: 16, deleted: 1 });
    expect(byTable['settings']).toEqual({ table: 'settings', live: 1, deleted: 0 });
  });

  it('carries the portable settings only: never a key, a token or the date of the last export', async () => {
    const db = await seededTestDb();
    await populate(db);
    await setSetting(db, 'excludeDiscountedPrices', true);

    const { text } = await prepareExport(db);

    const keys = (JSON.parse(text) as { data: { settings: Array<{ key: string }> } }).data.settings;
    expect(keys.map((row) => row.key).sort()).toEqual([
      'excludeDiscountedPrices',
      'priceWindowDays',
    ]);
    for (const secret of [
      'not-a-real-secret',
      'not-a-real-token',
      'geminiApiKey',
      'sync.token',
      'lastExportAt',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('leaves out, and reports, a stored record that no longer satisfies its schema', async () => {
    const db = await seededTestDb();
    await addProduct(db, 'Lapte');
    const broken = newId();
    await db.products.put({
      id: broken,
      updatedAt: '2026-11-01T10:00:00.000Z',
      name: '',
      categoryId: SEED.dairy.id,
      baseUnit: 'buc',
    });

    const prepared = await prepareExport(db);

    expect(prepared.skipped).toEqual([
      { table: 'products', id: broken, reason: expect.stringContaining('name') as string },
    ]);
    expect(prepared.text).not.toContain(broken);
    expect(previewOf(prepared.text).counts.find((c) => c.table === 'products')?.live).toBe(1);
  });

  it('remembers when it was exported, on this device only', async () => {
    const db = await seededTestDb();
    expect(await getLastExportAt(db)).toBeUndefined();

    await recordExport(db, '2026-11-20T12:00:00.000Z');

    expect(await getLastExportAt(db)).toBe('2026-11-20T12:00:00.000Z');
    expect((await prepareExport(db)).text).not.toContain('2026-11-20T12:00:00.000Z');
  });
});

describe('export, then import', () => {
  it('merges into an empty device: every record comes back, tombstones included, nothing else', async () => {
    const a = await seededTestDb();
    const { dropped, removed, closed, temporary } = await populate(a);
    const prepared = await prepareExport(a);
    const b = await seededTestDb();

    const summary = await applyBackup(b, previewOf(prepared.text).backup);

    expect(await snapshot(b)).toEqual(await snapshot(a));
    expect(await countLocalData(b)).toEqual(prepared.counts);
    expect(summary.mode).toBe('merge');
    expect(summary.added + summary.updated + summary.unchanged).toBe(
      prepared.counts.reduce((sum, count) => sum + count.live + count.deleted, 0),
    );
    // The deletions arrived as deletions.
    for (const [table, id] of [
      [b.products, dropped.id],
      [b.receipts, removed.id],
      [b.stores, closed.id],
      [b.categories, temporary.id],
    ] as const) {
      expect((await table.get(id))?.deletedAt).toBeDefined();
    }
    expect(
      await b.lines
        .where('receiptId')
        .equals(removed.id)
        .filter((l) => l.deletedAt !== undefined)
        .count(),
    ).toBe(1);
    // Only what is portable travelled.
    expect(await getSetting(b, 'priceWindowDays')).toBe(120);
    expect(await getSetting(b, 'lastExportAt')).toBeNull();
    expect(await getKeyValue(b.settings, 'geminiApiKey')).toBeUndefined();
    expect(await b.syncState.count()).toBe(0);
  });

  it('replaces what a device holds, and keeps its own settings and sync state', async () => {
    const a = await seededTestDb();
    await populate(a);
    const prepared = await prepareExport(a);
    const b = await seededTestDb();
    const ownStore = await addStore(b, { name: 'Doar pe B' });
    await createRecord(b.lists, { name: 'Lista lui B' });
    await setSetting(b, 'priceWindowDays', 30);
    await setSetting(b, 'lastExportAt', '2026-10-01T10:00:00.000Z');
    await setKeyValue(b.syncState, 'sync.token', 'the-device-token');

    const summary = await applyBackup(b, previewOf(prepared.text).backup, 'replace');

    expect(summary.mode).toBe('replace');
    expect(await snapshot(b)).toEqual(await snapshot(a));
    expect(await b.stores.get(ownStore.id)).toBeUndefined();
    expect(await b.lists.count()).toBe(1);
    expect(await getSetting(b, 'priceWindowDays')).toBe(120);
    expect(await getSetting(b, 'lastExportAt')).toBe('2026-10-01T10:00:00.000Z');
    expect(await getKeyValue(b.syncState, 'sync.token')).toBe('the-device-token');
  });

  it('restores the built-in categories a replace file does not mention', async () => {
    const a = await seededTestDb();
    const text = (await prepareExport(a)).text;
    const file = JSON.parse(text) as { data: { categories: Array<{ id: string }> } };
    file.data.categories = file.data.categories.filter((c) => c.id !== SEED.other.id);
    const b = await seededTestDb();

    await applyBackup(b, previewOf(JSON.stringify(file)).backup, 'replace');

    expect((await b.categories.get(SEED.other.id))?.deletedAt).toBeUndefined();
    expect(await b.categories.count()).toBe(16);
  });

  it('merge keeps the newer copy of each record, and only a newer deletion deletes', async () => {
    const a = await seededTestDb();
    const [bothEdited, aNewer, deletedOnA, editedAfter] = await Promise.all([
      addStore(a, { name: 'Original 1' }),
      addStore(a, { name: 'Original 2' }),
      addProduct(a, 'Se șterge pe A'),
      addProduct(a, 'Se modifică pe B'),
    ]);
    const b = await seededTestDb();
    await applyBackup(b, previewOf((await prepareExport(a)).text).backup);

    await updateRecord(
      b.stores,
      bothEdited.id,
      { name: 'Editat pe B' },
      at('2026-12-02T10:00:00.000Z'),
    );
    await updateRecord(
      a.stores,
      bothEdited.id,
      { name: 'Editat pe A' },
      at('2026-12-01T10:00:00.000Z'),
    );
    await updateRecord(
      b.stores,
      aNewer.id,
      { name: 'Editat pe B, mai vechi' },
      at('2026-12-01T10:00:00.000Z'),
    );
    await updateRecord(
      a.stores,
      aNewer.id,
      { name: 'Editat pe A, mai nou' },
      at('2026-12-02T10:00:00.000Z'),
    );
    await softDelete(a.products, deletedOnA.id, at('2026-12-03T10:00:00.000Z'));
    await softDelete(a.products, editedAfter.id, at('2026-12-04T10:00:00.000Z'));
    await updateRecord(
      b.products,
      editedAfter.id,
      { name: 'Editat după ștergere' },
      at('2026-12-05T10:00:00.000Z'),
    );

    const summary = await applyBackup(b, previewOf((await prepareExport(a)).text).backup, 'merge');

    expect((await b.stores.get(bothEdited.id))?.name).toBe('Editat pe B');
    expect((await b.stores.get(aNewer.id))?.name).toBe('Editat pe A, mai nou');
    expect((await b.products.get(deletedOnA.id))?.deletedAt).toBeDefined();
    expect(await b.products.get(editedAfter.id)).toMatchObject({ name: 'Editat după ștergere' });
    expect((await b.products.get(editedAfter.id))?.deletedAt).toBeUndefined();
    expect(summary.updated).toBe(2);
  });

  it('ignores a setting in the file that is not portable', async () => {
    const a = await seededTestDb();
    await setSetting(a, 'priceWindowDays', 45);
    const backup = structuredClone(previewOf((await prepareExport(a)).text).backup);
    backup.data.settings.push({
      key: 'geminiApiKey',
      value: 'planted',
      updatedAt: '2026-12-01T10:00:00.000Z',
    });
    const b = await seededTestDb();

    const summary = await applyBackup(b, backup);

    expect(summary.ignoredSettings).toBe(1);
    expect(await getSetting(b, 'priceWindowDays')).toBe(45);
    expect(await getKeyValue(b.settings, 'geminiApiKey')).toBeUndefined();
  });

  it('changes nothing when the database refuses, and says so', async () => {
    const b = await seededTestDb();
    const own = await addStore(b, { name: 'Al meu' });
    const backup = previewOf(
      serializeBackup(createBackup({ ...EMPTY, stores: [makeStore()] }, new Date())),
    ).backup;
    // Not a valid backup any more: importBackup validates again before it writes anything.
    const broken = { ...backup, data: { ...backup.data, stores: [{ ...makeStore(), name: '' }] } };

    await expect(applyBackup(b, broken, 'replace')).rejects.toThrow();

    expect(await b.stores.get(own.id)).toBeDefined();
  });
});

describe('previewing a file', () => {
  it('summarises a valid file without writing anything', async () => {
    const a = await seededTestDb();
    await populate(a);
    const prepared = await prepareExport(a, new Date('2026-11-20T12:00:00Z'));
    const b = await seededTestDb();
    const before = await snapshot(b);

    const preview = previewOf(prepared.text);

    expect(preview).toMatchObject({
      formatVersion: 1,
      exportedAt: '2026-11-20T12:00:00.000Z',
      counts: prepared.counts,
      warnings: [],
    });
    expect(await snapshot(b)).toEqual(before);
  });

  it('accepts the byte order mark that some editors add', async () => {
    const { text } = await prepareExport(await seededTestDb());

    expect(previewBackup(`\uFEFF${text}`).ok).toBe(true);
  });

  it.each([
    ['an empty file', ''],
    ['half a file', '{"format": "pretometru-backup",'],
    ['a web page', '<!doctype html><title>x</title>'],
  ])('refuses %s as not JSON', (_what, text) => {
    expect(refusalOf(text)).toEqual({ code: 'not-json' });
  });

  it.each([
    ['an array', '[]'],
    ['null', 'null'],
    ['a number', '42'],
    ['an empty object', '{}'],
    ['another format', JSON.stringify({ format: 'something-else', formatVersion: 1 })],
    ['no version', JSON.stringify({ format: 'pretometru-backup' })],
    ['version 0', JSON.stringify({ format: 'pretometru-backup', formatVersion: 0 })],
    ['a fractional version', JSON.stringify({ format: 'pretometru-backup', formatVersion: 1.5 })],
  ])('refuses %s as not a backup', (_what, text) => {
    expect(refusalOf(text)).toEqual({ code: 'not-backup' });
  });

  it('refuses a newer format version instead of importing it partly', () => {
    const newer = JSON.stringify({
      format: 'pretometru-backup',
      formatVersion: 2,
      exportedAt: '2027-01-01T10:00:00.000Z',
      data: { somethingNew: [] },
    });

    expect(refusalOf(newer)).toEqual({
      code: 'newer-version',
      formatVersion: 2,
      supportedVersion: 1,
    });
  });

  it('refuses a backup that breaks the contract and says where', async () => {
    const { text } = await prepareExport(await seededTestDb());
    const file = JSON.parse(text) as { data: { stores: unknown[]; categories: unknown[] } };
    file.data.stores = [{ id: newId(), updatedAt: '2026-11-20T10:00:00.000Z', chain: 'kaufland' }];

    const refusal = refusalOf(JSON.stringify(file));

    expect(refusal.code).toBe('invalid');
    expect(refusal.code === 'invalid' && refusal.details.join('\n')).toContain(
      'data.stores.0.name',
    );
  });

  it('refuses a backup that repeats a record', async () => {
    const { text } = await prepareExport(await seededTestDb());
    const file = JSON.parse(text) as { data: { categories: unknown[] } };
    file.data.categories.push(file.data.categories[0]);

    const refusal = refusalOf(JSON.stringify(file));

    expect(refusal.code === 'invalid' && refusal.details.join('\n')).toContain('duplicate id');
  });

  it('says what a valid file points at that it does not contain, for every kind of reference', () => {
    const store = makeStore();
    const receipt = makeReceipt({ storeId: store.id });
    const list = makeList();
    const base: Partial<BackupData> = { stores: [store], receipts: [receipt], lists: [list] };
    const cases: Array<[Partial<BackupData>, DanglingSubject, DanglingTarget]> = [
      [{ receipts: [makeReceipt()] }, 'receipts', 'store'],
      [{ lines: [makeLine()] }, 'lines', 'receipt'],
      [{ lines: [makeLine({ receiptId: receipt.id, productId: newId() })] }, 'lines', 'product'],
      [{ lines: [makeLine({ receiptId: receipt.id, categoryId: newId() })] }, 'lines', 'category'],
      [{ products: [makeProduct()] }, 'products', 'category'],
      [{ aliases: [makeAlias()] }, 'aliases', 'product'],
      [{ categories: [makeCategory({ parentId: newId() })] }, 'categories', 'parentCategory'],
      [{ listItems: [makeListItem()] }, 'listItems', 'list'],
      [
        { listItems: [makeListItem({ listId: list.id, productId: newId() })] },
        'listItems',
        'product',
      ],
    ];

    for (const [part, subject, target] of cases) {
      const text = serializeBackup(createBackup({ ...EMPTY, ...base, ...part }, new Date()));

      expect(previewOf(text).warnings, `${subject} -> ${target}`).toEqual([
        { kind: 'dangling', count: 1, subject, target },
      ]);
    }
  });

  it('refuses a file that is too big without reading it, and one it cannot read', async () => {
    const text = vi.fn(() => Promise.resolve('{}'));

    expect(await readBackupFile({ size: MAX_BACKUP_BYTES + 1, text })).toEqual({
      ok: false,
      refusal: { code: 'too-large', bytes: MAX_BACKUP_BYTES + 1, limit: MAX_BACKUP_BYTES },
    });
    expect(text).not.toHaveBeenCalled();

    expect(
      await readBackupFile({ size: 10, text: () => Promise.reject(new Error('gone')) }),
    ).toEqual({
      ok: false,
      refusal: { code: 'unreadable' },
    });
  });

  it('reads a picked file', async () => {
    const { text } = await prepareExport(await seededTestDb());

    const result = await readBackupFile({ size: text.length, text: () => Promise.resolve(text) });

    expect(
      result.ok && result.preview.counts.find((count) => count.table === 'categories')?.live,
    ).toBe(16);
  });
});

describe('privacy', () => {
  it('never touches the network', async () => {
    const calls = {
      fetch: vi.fn(),
      WebSocket: vi.fn(),
      XMLHttpRequest: vi.fn(),
      EventSource: vi.fn(),
    };
    for (const [name, spy] of Object.entries(calls)) vi.stubGlobal(name, spy);

    const a = await seededTestDb();
    await populate(a);
    const prepared = await prepareExport(a);
    await recordExport(a, prepared.exportedAt);
    const read = await readBackupFile({
      size: prepared.bytes,
      text: () => Promise.resolve(prepared.text),
    });
    const b = await seededTestDb();
    if (read.ok) {
      await applyBackup(b, read.preview.backup, 'merge');
      await applyBackup(b, read.preview.backup, 'replace');
    }

    expect(read.ok).toBe(true);
    for (const spy of Object.values(calls)) expect(spy).not.toHaveBeenCalled();
  });

  it('has a table order that covers every synced table and the settings', () => {
    const synced: SyncedTableName[] = [
      'stores',
      'receipts',
      'lines',
      'products',
      'aliases',
      'categories',
      'lists',
      'listItems',
    ];
    expect([...BACKUP_TABLES].sort()).toEqual([...synced, 'settings'].sort());
  });
});
