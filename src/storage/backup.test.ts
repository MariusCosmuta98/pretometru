import { describe, expect, it } from 'vitest';
import { createBackup, parseBackup, serializeBackup, type Backup, type Line } from '@/domain';
import { makeProduct, makeStore } from '@/domain/testing';
import { exportBackup, importBackup } from './backup';
import type { PretometruDB } from './db';
import { createRecord, softDelete } from './records';
import { getReceiptWithLines, saveReceipt, type LineInput, type ReceiptInput } from './receipts';
import { ensureSeed } from './seed';
import { getKeyValue, setKeyValue, setSetting } from './settings';
import { createTestDb } from './testing';

const NOW = new Date('2026-11-20T12:00:00.000Z');
// Stands in for a token or API key: it must never appear in an exported file.
const LEAK_SENTINEL = 'sentinel-value-that-must-not-leak';
const EARLY = '2026-11-01T10:00:00.000Z';
const MIDDLE = '2026-11-10T10:00:00.000Z';
const LATE = '2026-11-15T10:00:00.000Z';

async function populate(db: PretometruDB) {
  await ensureSeed(db);
  const category = await createRecord(db.categories, {
    name: 'Cafea',
    color: '#8b4513',
    icon: '☕',
    order: 5,
  });
  const store = await createRecord(db.stores, { chain: 'lidl', name: 'Lidl Dorobanți' });
  const product = await createRecord(db.products, {
    name: 'Cafea măcinată 250g',
    categoryId: category.id,
    baseUnit: 'kg',
  });
  await createRecord(db.aliases, {
    chain: 'lidl',
    normName: 'cafea macinata 250g',
    productId: product.id,
  });
  const list = await createRecord(db.lists, { name: 'Weekend' });
  await createRecord(db.listItems, {
    listId: list.id,
    productId: product.id,
    label: 'Cafea',
    checked: false,
    order: 0,
  });
  await saveReceipt(
    db,
    {
      storeId: store.id,
      purchasedAt: '2026-11-07T14:32',
      docType: 'receipt',
      totalBani: 1999,
      source: { kind: 'image', fileHash: 'c'.repeat(64) },
      extraction: { engine: 'tesseract', parser: 'lidl', version: '1.0.0', warnings: [] },
      status: 'confirmed',
    },
    [
      {
        idx: 0,
        rawName: 'CAFEA MACINATA 250G',
        qty: 1,
        unit: 'buc',
        lineTotalBani: 1999,
        discountBani: 0,
        kind: 'product',
        productId: product.id,
        packQty: 250,
        packUnit: 'g',
      },
    ],
  );
  await setSetting(db, 'priceWindowDays', 60);
  return { category, store, product };
}

const exportOf = async (db: PretometruDB, now = NOW) => (await exportBackup(db, now)).backup;
const snapshot = async (db: PretometruDB) => (await exportOf(db)).data;

describe('exportBackup', () => {
  it('writes a backup that parses, with portable settings only and no sync state or secrets', async () => {
    const db = await createTestDb();
    await populate(db);
    await setKeyValue(db.settings, 'geminiApiKey', LEAK_SENTINEL);
    await setKeyValue(db.syncState, 'github', { token: LEAK_SENTINEL });

    const { backup, skipped } = await exportBackup(db, NOW);
    const text = serializeBackup(backup);
    const parsed = parseBackup(text);

    expect(parsed.ok).toBe(true);
    expect(skipped).toEqual([]);
    expect(backup.data.settings.map((s) => s.key)).toEqual(['priceWindowDays']);
    expect(text).not.toContain(LEAK_SENTINEL);
    expect(backup.exportedAt).toBe('2026-11-20T12:00:00.000Z');
  });

  it('includes tombstones so deletions travel with the data', async () => {
    const db = await createTestDb();
    const { product } = await populate(db);
    await softDelete(db.products, product.id);

    const exported = (await snapshot(db)).products.find((p) => p.id === product.id);
    expect(exported?.deletedAt).toBeDefined();
  });

  it('exports everything valid and reports the records it had to skip, instead of failing', async () => {
    const db = await createTestDb();
    const { product } = await populate(db);
    // A row from an older schema or a raw write: the plan used the Romanian unit "rolă".
    const legacy = makeProduct({ name: 'Hârtie veche', baseUnit: 'rolă' as 'role' });
    await db.products.put(legacy);

    const { backup, skipped } = await exportBackup(db, NOW);

    expect(backup.data.products.map((p) => p.id)).toEqual([product.id]);
    expect(skipped).toEqual([
      { table: 'products', id: legacy.id, reason: expect.stringContaining('baseUnit') as string },
    ]);
    expect(parseBackup(serializeBackup(backup)).ok).toBe(true);
  });
});

describe('importBackup', () => {
  it('restores into an empty database exactly, in either mode', async () => {
    const source = await createTestDb();
    await populate(source);
    const backup = await exportOf(source);

    for (const mode of ['merge', 'replace'] as const) {
      const target = await createTestDb();
      const report = await importBackup(target, backup, { mode });
      expect(await snapshot(target), mode).toEqual(backup.data);
      expect(report.tables.lines).toEqual({ added: 1, updated: 0, unchanged: 0 });
    }
  });

  it('refuses an object that is not a valid backup instead of storing rows that break exports', async () => {
    const db = await createTestDb();
    const broken = backupOf({ products: [{ ...makeProduct(), baseUnit: 'rolă' as 'role' }] });
    await expect(importBackup(db, broken)).rejects.toThrow(/baseUnit/);
    await expect(
      importBackup(db, { ...backupOf({}), formatVersion: 2 } as unknown as Backup),
    ).rejects.toThrow(/newer version/);
    expect(await db.products.count()).toBe(0);
  });

  it('merge keeps whichever copy of a record is newer', async () => {
    const local = makeProduct({ name: 'Local', updatedAt: MIDDLE });
    const db = await createTestDb();
    await db.products.put(local);

    const older = await importBackup(
      db,
      backupOf({ products: [{ ...local, name: 'Backup vechi', updatedAt: EARLY }] }),
    );
    expect((await db.products.get(local.id))?.name).toBe('Local');
    expect(older.tables.products).toEqual({ added: 0, updated: 0, unchanged: 1 });

    const newer = await importBackup(
      db,
      backupOf({ products: [{ ...local, name: 'Backup nou', updatedAt: LATE }] }),
    );
    expect((await db.products.get(local.id))?.name).toBe('Backup nou');
    expect(newer.tables.products).toEqual({ added: 0, updated: 1, unchanged: 0 });
  });

  it('merge applies a deletion made after the local edit', async () => {
    const edited = makeProduct({ name: 'Editat', updatedAt: MIDDLE });
    const db = await createTestDb();
    await db.products.put(edited);

    await importBackup(
      db,
      backupOf({ products: [{ ...edited, updatedAt: LATE, deletedAt: LATE }] }),
    );
    expect((await db.products.get(edited.id))?.deletedAt).toBe(LATE);
  });

  it('merge keeps a local edit made after the deletion', async () => {
    const edited = makeProduct({ name: 'Editat după ștergere', updatedAt: LATE });
    const db = await createTestDb();
    await db.products.put(edited);

    await importBackup(
      db,
      backupOf({ products: [{ ...edited, updatedAt: MIDDLE, deletedAt: MIDDLE }] }),
    );
    expect(await db.products.get(edited.id)).toEqual(edited);
  });

  it('replace drops local data that is not in the backup but keeps device-local settings', async () => {
    const source = await createTestDb();
    await populate(source);
    const backup = await exportOf(source);

    const db = await createTestDb();
    await createRecord(db.stores, { chain: 'kaufland', name: 'Magazin local' });
    await setSetting(db, 'excludeDiscountedPrices', true);
    await setKeyValue(db.settings, 'geminiApiKey', 'local-key');
    await setKeyValue(db.syncState, 'deviceId', 'device-1');

    await importBackup(db, backup, { mode: 'replace' });

    expect((await snapshot(db)).stores.map((s) => s.name)).toEqual(['Lidl Dorobanți']);
    expect(await getKeyValue(db.settings, 'excludeDiscountedPrices')).toBeUndefined();
    expect(await getKeyValue(db.settings, 'priceWindowDays')).toBe(60);
    expect(await getKeyValue(db.settings, 'geminiApiKey')).toBe('local-key');
    expect(await getKeyValue(db.syncState, 'deviceId')).toBe('device-1');
  });

  it('never imports settings that are not portable', async () => {
    const db = await createTestDb();
    const backup = createBackup(
      {
        ...emptyData(),
        settings: [
          { key: 'priceWindowDays', value: 45, updatedAt: LATE },
          { key: 'geminiApiKey', value: 'planted', updatedAt: LATE },
        ],
      },
      NOW,
    );
    const report = await importBackup(db, backup);

    expect(await getKeyValue(db.settings, 'priceWindowDays')).toBe(45);
    expect(await getKeyValue(db.settings, 'geminiApiKey')).toBeUndefined();
    expect(report.warnings).toEqual(['1 setting(s) skipped: not portable']);
  });

  it('merging two devices that edited the same receipt never combines their line sets', async () => {
    const T5 = '2026-11-05T10:00:00.000Z';
    const T6 = '2026-11-06T10:00:00.000Z';
    const at = (iso: string) => ({ now: () => new Date(iso) });
    const input: ReceiptInput = {
      storeId: makeStore().id,
      purchasedAt: '2026-11-04',
      docType: 'receipt',
      totalBani: 1000,
      source: { kind: 'manual' },
      extraction: { engine: 'manual', parser: 'manual', version: '1.0.0', warnings: [] },
      status: 'confirmed',
    };
    const line = (name: string, idx: number): LineInput => ({
      idx,
      rawName: name,
      qty: 1,
      unit: 'buc',
      lineTotalBani: 500,
      discountBani: 0,
      kind: 'product',
    });
    const asInput = (stored: Line): LineInput => {
      const {
        updatedAt,
        deletedAt,
        receiptId,
        paidUnitBani,
        baseUnit,
        pricePerBaseMilliBani,
        ...rest
      } = stored;
      void [updatedAt, deletedAt, receiptId, paidUnitBani, baseUnit, pricePerBaseMilliBani];
      return rest;
    };

    const origin = await createTestDb();
    const { receipt, lines } = await saveReceipt(
      origin,
      input,
      [line('L1', 0), line('L2', 1)],
      at(EARLY),
    );
    const [l1, l2] = lines.map(asInput) as [LineInput, LineInput];
    const base = await exportOf(origin);
    const deviceA = await createTestDb();
    const deviceB = await createTestDb();
    await importBackup(deviceA, base);
    await importBackup(deviceB, base);

    // A (Nov 5) keeps L1 and adds L4; B (Nov 6) keeps L1 and L2.
    await saveReceipt(deviceA, { ...input, id: receipt.id }, [l1, line('L4', 1)], at(T5));
    await saveReceipt(deviceB, { ...input, id: receipt.id }, [l1, l2], at(T6));

    await importBackup(deviceB, await exportOf(deviceA));
    await importBackup(deviceA, await exportOf(deviceB));

    for (const device of [deviceA, deviceB]) {
      const view = await getReceiptWithLines(device, receipt.id);
      expect(view?.lines.map((l) => l.rawName)).toEqual(['L1', 'L2']);
      expect(view?.lines.reduce((sum, l) => sum + l.lineTotalBani, 0)).toBe(
        view?.receipt.totalBani,
      );
    }
  });

  it('puts the seed categories back after a replace with a backup that lacks them', async () => {
    const db = await createTestDb();
    await importBackup(db, createBackup(emptyData(), NOW), { mode: 'replace' });
    expect(await db.categories.count()).toBe(16);
  });
});

function emptyData(): Backup['data'] {
  return {
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
}

const backupOf = (data: Partial<Backup['data']>): Backup =>
  createBackup({ ...emptyData(), ...data }, NOW);
