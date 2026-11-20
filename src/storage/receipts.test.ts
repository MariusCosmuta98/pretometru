import { describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID } from '@/domain';
import { makeLine, makeStore } from '@/domain/testing';
import {
  deleteReceipt,
  findDuplicateReceipts,
  getReceiptWithLines,
  reconcileReceiptLines,
  saveReceipt,
  type LineInput,
  type ReceiptInput,
} from './receipts';
import { updateRecord } from './records';
import { createTestDb } from './testing';

const storeId = makeStore().id;
const hash = (char: string) => char.repeat(64);

const receiptInput = (overrides: Partial<ReceiptInput> = {}): ReceiptInput => ({
  storeId,
  purchasedAt: '2026-11-07T14:32',
  docType: 'receipt',
  totalBani: 3666,
  source: { kind: 'pdf', fileHash: hash('a'), fileName: 'bon.pdf' },
  extraction: { engine: 'pdfjs', parser: 'kaufland', version: '1.0.0', warnings: [] },
  status: 'confirmed',
  ...overrides,
});

const lineInput = (overrides: Partial<LineInput> = {}): LineInput => ({
  idx: 0,
  rawName: 'PULPE PUI',
  qty: 0.92,
  unit: 'kg',
  lineTotalBani: 2299,
  discountBani: 0,
  kind: 'product',
  ...overrides,
});

const wipes = (overrides: Partial<LineInput> = {}) =>
  lineInput({
    idx: 1,
    rawName: 'SERVETELE UMEDE 120BUC',
    qty: 1,
    unit: 'buc',
    lineTotalBani: 398,
    packQty: 120,
    packUnit: 'buc',
    ...overrides,
  });

describe('saveReceipt', () => {
  it('stores the receipt with its lines and derives the unit prices', async () => {
    const db = await createTestDb();
    const { receipt, lines } = await saveReceipt(db, receiptInput(), [lineInput(), wipes()]);

    expect(lines.map((l) => [l.paidUnitBani, l.baseUnit, l.pricePerBaseMilliBani])).toEqual([
      [2499, 'kg', 2_498_913],
      [398, 'buc', 3317],
    ]);
    expect(await db.receipts.get(receipt.id)).toEqual(receipt);
    expect(await db.lines.where('receiptId').equals(receipt.id).count()).toBe(2);
  });

  it('puts deposits, bags, discounts and fees in Non-produs unless a category is given', async () => {
    const db = await createTestDb();
    const { lines } = await saveReceipt(db, receiptInput(), [
      lineInput(),
      lineInput({
        idx: 1,
        rawName: 'GARANTIE AMBALAJ',
        kind: 'deposit',
        qty: 2,
        unit: 'buc',
        lineTotalBani: 100,
      }),
    ]);
    expect(lines.map((l) => l.categoryId)).toEqual([undefined, NON_PRODUCT_CATEGORY_ID]);
  });

  it('is atomic: one invalid line leaves nothing behind', async () => {
    const db = await createTestDb();
    await expect(
      saveReceipt(db, receiptInput(), [lineInput(), wipes({ qty: 0 })]),
    ).rejects.toThrow();
    expect(await db.receipts.count()).toBe(0);
    expect(await db.lines.count()).toBe(0);
  });

  it('refuses a line id that already belongs to another receipt', async () => {
    const db = await createTestDb();
    const first = await saveReceipt(db, receiptInput(), [lineInput()]);
    const stolen = first.lines[0]!.id;
    await expect(
      saveReceipt(db, receiptInput({ source: { kind: 'manual' } }), [lineInput({ id: stolen })]),
    ).rejects.toThrow();
    expect((await db.lines.get(stolen))?.receiptId).toBe(first.receipt.id);
  });

  it('edits in place: keeps line ids, recomputes prices, tombstones removed lines, adds new ones', async () => {
    const db = await createTestDb();
    const first = await saveReceipt(db, receiptInput(), [lineInput(), wipes()]);
    const [kept, removed] = first.lines;

    const second = await saveReceipt(
      db,
      { ...receiptInput({ totalBani: 3000 }), id: first.receipt.id },
      [
        lineInput({ id: kept!.id, lineTotalBani: 1840 }),
        lineInput({
          idx: 2,
          rawName: 'PUNGA BIO',
          kind: 'bag',
          qty: 1,
          unit: 'buc',
          lineTotalBani: 69,
        }),
      ],
    );

    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.lines[0]).toMatchObject({
      id: kept!.id,
      paidUnitBani: 2000,
      lineTotalBani: 1840,
    });
    expect(second.lines[1]!.id).not.toBe(removed!.id);

    const stored = await db.lines.where('receiptId').equals(first.receipt.id).toArray();
    expect(stored.filter((l) => l.deletedAt !== undefined).map((l) => l.id)).toEqual([removed!.id]);

    const view = await getReceiptWithLines(db, first.receipt.id);
    expect(view?.receipt.totalBani).toBe(3000);
    expect(view?.lines.map((l) => l.rawName)).toEqual(['PULPE PUI', 'PUNGA BIO']);
  });
});

describe('getReceiptWithLines', () => {
  it('returns the live lines in printed order', async () => {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput(), [
      lineInput({ idx: 2, rawName: 'C' }),
      lineInput({ idx: 0, rawName: 'A' }),
      lineInput({ idx: 1, rawName: 'B' }),
    ]);
    expect((await getReceiptWithLines(db, receipt.id))?.lines.map((l) => l.rawName)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });
});

describe('line-set versioning', () => {
  const T1 = '2026-11-05T10:00:00.000Z';
  const T2 = '2026-11-06T10:00:00.000Z';
  const T3 = '2026-11-07T10:00:00.000Z';
  const at = (iso: string) => ({ now: () => new Date(iso) });

  it('saveReceipt stamps the receipt with the time its line set was replaced', async () => {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput(), [lineInput()], at(T2));
    expect(receipt).toMatchObject({ updatedAt: T2, linesUpdatedAt: T2 });
  });

  it('reconcileReceiptLines tombstones live lines from an older version of the line set', async () => {
    const db = await createTestDb();
    const { receipt, lines } = await saveReceipt(db, receiptInput(), [lineInput()], at(T2));
    // what a merge from another device leaves behind: a line stamped before the current set
    const stale = makeLine({ receiptId: receipt.id, idx: 5, updatedAt: T1 });
    await db.lines.add(stale);

    expect(await reconcileReceiptLines(db, [receipt.id])).toBe(1);
    expect(await db.lines.get(stale.id)).toMatchObject({ deletedAt: T2, updatedAt: T2 });
    expect((await db.lines.get(lines[0]!.id))?.deletedAt).toBeUndefined();
  });

  it('keeps lines that were edited after the line set was saved', async () => {
    const db = await createTestDb();
    const { receipt, lines } = await saveReceipt(db, receiptInput(), [lineInput()], at(T2));
    await updateRecord(db.lines, lines[0]!.id, { productId: makeLine().id }, at(T3));

    expect(await reconcileReceiptLines(db, [receipt.id])).toBe(0);
    expect((await db.lines.get(lines[0]!.id))?.deletedAt).toBeUndefined();
  });

  it('leaves a receipt alone when its lines were never replaced (no stamp) or it is unknown', async () => {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput(), [], at(T2));
    const { linesUpdatedAt: _stamp, ...unstamped } = receipt;
    await db.receipts.put(unstamped);
    await db.lines.add(makeLine({ receiptId: receipt.id, updatedAt: T1 }));

    expect(await reconcileReceiptLines(db, [receipt.id, makeStore().id])).toBe(0);
  });

  it('removes lines older than the deletion from a deleted receipt', async () => {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput(), [lineInput()], at(T1));
    await deleteReceipt(db, receipt.id, at(T3));
    const straggler = makeLine({ receiptId: receipt.id, idx: 9, updatedAt: T2 });
    await db.lines.add(straggler);

    expect(await reconcileReceiptLines(db, [receipt.id])).toBe(1);
    expect((await db.lines.get(straggler.id))?.deletedAt).toBe(T3);
  });
});

describe('deleteReceipt', () => {
  it('tombstones the receipt and its lines together', async () => {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput(), [lineInput(), wipes()]);

    expect(await deleteReceipt(db, receipt.id)).toBe(true);
    expect(await getReceiptWithLines(db, receipt.id)).toBeUndefined();
    const rows = await db.lines.where('receiptId').equals(receipt.id).toArray();
    expect(rows.every((row) => row.deletedAt !== undefined)).toBe(true);
    expect(await deleteReceipt(db, receipt.id)).toBe(false);
  });
});

describe('findDuplicateReceipts', () => {
  async function seeded() {
    const db = await createTestDb();
    const { receipt } = await saveReceipt(db, receiptInput({ receiptNo: '0042' }), [lineInput()]);
    return { db, receipt };
  }

  it('matches the same file by hash, whatever else differs', async () => {
    const { db, receipt } = await seeded();
    const found = await findDuplicateReceipts(db, { fileHash: hash('a'), totalBani: 1 });
    expect(found.map((r) => r.id)).toEqual([receipt.id]);
  });

  it('matches the same store, day and total even for a different file', async () => {
    const { db, receipt } = await seeded();
    const found = await findDuplicateReceipts(db, {
      fileHash: hash('b'),
      storeId,
      purchasedAt: '2026-11-07T18:00',
      totalBani: 3666,
    });
    expect(found.map((r) => r.id)).toEqual([receipt.id]);
  });

  it.each([
    ['another store', { storeId: makeStore().id }],
    ['another day', { purchasedAt: '2026-11-08' }],
    ['another total', { totalBani: 3667 }],
    ['a different receipt number', { receiptNo: '0099' }],
  ])('does not match %s', async (_label, change) => {
    const { db } = await seeded();
    const candidate = {
      storeId,
      purchasedAt: '2026-11-07',
      totalBani: 3666,
      receiptNo: '0042',
      ...change,
    };
    expect(await findDuplicateReceipts(db, candidate)).toEqual([]);
  });

  it('still matches when only one side has a receipt number', async () => {
    const { db, receipt } = await seeded();
    const found = await findDuplicateReceipts(db, {
      storeId,
      purchasedAt: '2026-11-07',
      totalBani: 3666,
    });
    expect(found.map((r) => r.id)).toEqual([receipt.id]);
  });

  it('ignores deleted receipts and the receipt being edited', async () => {
    const { db, receipt } = await seeded();
    expect(await findDuplicateReceipts(db, { fileHash: hash('a'), excludeId: receipt.id })).toEqual(
      [],
    );

    await deleteReceipt(db, receipt.id);
    expect(await findDuplicateReceipts(db, { fileHash: hash('a') })).toEqual([]);
  });
});
