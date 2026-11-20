import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID, SEED_CATEGORIES } from '@/domain';
import { ensureSeed, getReceiptWithLines, listActive } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { draftFromParsed, mappingChoices, type ReceiptDraft } from './draft';
import { ImportError } from './errors';
import { confirmDraft, discardReceipt, loadDraft, saveDraft } from './persist';
import { clearReviewSessions, getReviewSession, openReviewSession } from './session';
import { fakeCatalog, sampleReceipt, testIds, testServices } from './testing';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});
afterEach(clearReviewSessions);

const LACTATE = SEED_CATEGORIES[0]?.id ?? '';

function sampleDraft(): ReceiptDraft {
  return draftFromParsed(
    sampleReceipt(),
    { kind: 'pdf', fileHash: 'a'.repeat(64), fileName: 'kaufland.pdf' },
    testIds,
  );
}

describe('saveDraft', () => {
  it('stores the receipt, its lines and the derived unit prices', async () => {
    const services = testServices(db);
    const { receipt, lines, store } = await saveDraft(services, sampleDraft());

    expect(receipt).toMatchObject({
      storeId: store.id,
      status: 'draft',
      purchasedAt: '2026-11-07T18:31:47',
      docType: 'receipt',
      totalBani: 3945,
      source: { kind: 'pdf', fileHash: 'a'.repeat(64), fileName: 'kaufland.pdf' },
      extraction: { engine: 'pdfjs', parser: 'kaufland', version: '1.0.0', warnings: [] },
    });
    expect(store).toMatchObject({ chain: 'kaufland', name: 'Kaufland' });

    const [milk, chicken, wipes, deposit] = lines;
    // 2 x 5,99 lei, sold by the litre: 5,99 lei/l.
    expect(milk).toMatchObject({
      unit: 'buc',
      lineTotalBani: 1198,
      discountBani: 0,
      packQty: 1,
      packUnit: 'l',
      paidUnitBani: 599,
      baseUnit: 'l',
      pricePerBaseMilliBani: 599_000,
    });
    // 22,99 lei for 0,920 kg: 24,99 lei/kg.
    expect(chicken).toMatchObject({
      unit: 'kg',
      qty: 0.92,
      paidUnitBani: 2499,
      baseUnit: 'kg',
      pricePerBaseMilliBani: 2_498_913,
    });
    // 3,98 lei for 120 wet wipes: 3,317 bani a piece, kept in milli-bani.
    expect(wipes).toMatchObject({
      ean: '5941234567890',
      baseUnit: 'buc',
      pricePerBaseMilliBani: 3317,
    });
    expect(deposit).toMatchObject({ kind: 'deposit', categoryId: NON_PRODUCT_CATEGORY_ID });
  });

  it('writes only what the schemas know', async () => {
    const draft = sampleDraft();
    const [first] = draft.lines;
    if (first) {
      first.bbox = { x: 1, y: 2, w: 3, h: 4 };
      first.confidence = 0.5;
      first.raw = '2 * 5,99';
      first.unitPriceBani = 599;
    }
    const { lines } = await saveDraft(testServices(db), draft);
    expect(Object.keys(lines[0] ?? {})).not.toEqual(
      expect.arrayContaining(['bbox', 'confidence', 'raw', 'unitPriceBani']),
    );
  });

  it('reuses the store of a chain and branch', async () => {
    const services = testServices(db);
    const first = await saveDraft(services, sampleDraft());
    const second = await saveDraft(services, sampleDraft());
    expect(second.store.id).toBe(first.store.id);
    expect(await db.stores.count()).toBe(1);
  });

  it('updates a receipt in place: same id, same line ids, removed lines tombstoned', async () => {
    const services = testServices(db);
    const first = await saveDraft(services, sampleDraft());
    const draft = await loadDraft(services, first.receipt.id);
    if (!draft) throw new Error('missing draft');

    const [milk, chicken, wipes, deposit] = draft.lines;
    if (!milk || !chicken || !wipes || !deposit) throw new Error('missing lines');
    const edited: ReceiptDraft = {
      ...draft,
      totalBani: 3955,
      lines: [{ ...milk, lineTotalBani: 1208 }, chicken, wipes],
    };
    const second = await saveDraft(services, edited);

    expect(second.receipt.id).toBe(first.receipt.id);
    const stored = await getReceiptWithLines(db, first.receipt.id);
    expect(stored?.lines.map((line) => [line.id, line.lineTotalBani])).toEqual([
      [milk.id, 1208],
      [chicken.id, 2299],
      [wipes.id, 398],
    ]);
    expect(stored?.lines[0]?.paidUnitBani).toBe(604);
    expect(await db.receipts.count()).toBe(1);
    expect((await db.lines.get(deposit.id))?.deletedAt).toBeDefined();
  });

  it('refuses data that breaks the contract', async () => {
    const draft = { ...sampleDraft(), status: 'confirmed' as const };
    delete draft.purchasedAt;
    const failure = await saveDraft(testServices(db), draft).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ImportError);
    expect((failure as ImportError).code).toBe('SAVE_FAILED');
    expect(await db.receipts.count()).toBe(0);
  });
});

describe('confirmDraft', () => {
  it('confirms the receipt and teaches the catalog the mapped product lines', async () => {
    const catalog = fakeCatalog();
    const services = testServices(db, { catalog });
    const milk = await catalog.createProduct(db, {
      name: 'Lapte UHT 1,5%',
      categoryId: LACTATE,
      baseUnit: 'l',
    });

    const draft = sampleDraft();
    const [first, , third, deposit] = draft.lines;
    if (!first || !third || !deposit) throw new Error('missing lines');
    draft.lines = draft.lines.map((line) => {
      if (line.id === first.id) return { ...line, productId: milk.id, categoryId: LACTATE };
      // A product on a non-product line must not leak into the memory.
      if (line.id === deposit.id) return { ...line, productId: milk.id };
      if (line.id === third.id) return { ...line, pack: { qty: 120, unit: 'buc' as const } };
      return line;
    });

    const { saved, mappingError } = await confirmDraft(services, draft);

    expect(mappingError).toBeUndefined();
    expect(saved.receipt.status).toBe('confirmed');
    expect(catalog.remembered).toEqual([
      {
        chain: 'kaufland',
        choices: [
          { rawName: 'LAPTE UHT 1,5% 1L', productId: milk.id, pack: { qty: 1, unit: 'l' } },
        ],
      },
    ]);
    const stored = await getReceiptWithLines(db, saved.receipt.id);
    expect(stored?.lines[0]).toMatchObject({ productId: milk.id, categoryId: LACTATE });
    expect(stored?.lines[3]?.productId).toBeUndefined();
  });

  it('keeps the confirmation when the alias memory fails', async () => {
    const failing = {
      ...fakeCatalog(),
      rememberMappings: () => Promise.reject(new Error('catalog down')),
    };
    const draft = sampleDraft();
    draft.lines = draft.lines.map((line, index) =>
      index === 0 ? { ...line, productId: testIds() } : line,
    );
    expect(mappingChoices(draft)).toHaveLength(1);

    const { saved, mappingError } = await confirmDraft(
      testServices(db, { catalog: failing }),
      draft,
    );

    expect(saved.receipt.status).toBe('confirmed');
    expect(mappingError).toBeInstanceOf(Error);
    expect((await listActive(db.receipts))[0]?.status).toBe('confirmed');
  });

  it('forgets the in-memory original once confirmed', async () => {
    const services = testServices(db);
    const { receipt } = await saveDraft(services, sampleDraft());
    openReviewSession(receipt.id, { original: new Blob(['x']), lines: {} });
    const draft = await loadDraft(services, receipt.id);
    if (!draft) throw new Error('missing draft');

    await confirmDraft(services, draft);
    expect(getReviewSession(receipt.id)).toBeUndefined();
  });
});

describe('loadDraft', () => {
  it('rebuilds the draft from the database and adds what the review session remembers', async () => {
    const services = testServices(db);
    const { receipt, lines } = await saveDraft(services, sampleDraft());
    const first = lines[0];
    if (!first) throw new Error('missing line');

    const withoutSession = await loadDraft(services, receipt.id);
    expect(withoutSession?.lines[0]?.unitPriceBani).toBeUndefined();
    expect(withoutSession).toMatchObject({
      id: receipt.id,
      storeId: receipt.storeId,
      store: { chain: 'kaufland' },
      totalBani: 3945,
      lines: [{ id: first.id, pack: { qty: 1, unit: 'l' }, qtyUnit: 'buc' }, {}, {}, {}],
    });

    openReviewSession(receipt.id, {
      vat: [{ rate: 11, grossBani: 3497 }],
      lines: { [first.id]: { unitPriceBani: 599, bbox: { x: 1, y: 2, w: 3, h: 4 } } },
    });
    const withSession = await loadDraft(services, receipt.id);
    expect(withSession?.vat).toEqual([{ rate: 11, grossBani: 3497 }]);
    expect(withSession?.lines[0]).toMatchObject({
      unitPriceBani: 599,
      bbox: { x: 1, y: 2, w: 3, h: 4 },
    });
  });

  it('finds nothing for a missing or deleted receipt', async () => {
    const services = testServices(db);
    expect(await loadDraft(services, '0'.repeat(26))).toBeUndefined();
    const { receipt } = await saveDraft(services, sampleDraft());
    await discardReceipt(services, receipt.id);
    expect(await loadDraft(services, receipt.id)).toBeUndefined();
  });
});

describe('discardReceipt', () => {
  it('soft-deletes the receipt and forgets its original', async () => {
    const services = testServices(db);
    const { receipt } = await saveDraft(services, sampleDraft());
    openReviewSession(receipt.id, { original: new Blob(['x']), lines: {} });

    expect(await discardReceipt(services, receipt.id)).toBe(true);
    expect(await listActive(db.receipts)).toEqual([]);
    expect((await db.receipts.get(receipt.id))?.deletedAt).toBeDefined();
    expect(getReviewSession(receipt.id)).toBeUndefined();
    expect(await discardReceipt(services, receipt.id)).toBe(false);
  });
});
