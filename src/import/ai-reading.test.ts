import { getFixture } from '@fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { convertAnswer } from '@/ai/convert';
import { answerFromReceipt } from '@/ai/testing';
import type { ParsedReceipt } from '@/domain';
import { ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { adoptReading } from './ai-reading';
import { draftFromParsed } from './draft';
import { formFromDraft, type ReceiptForm } from './form';
import { isDirty, initialReviewState, reviewReducer } from './review-state';
import { fakeCatalog, testIds, testServices } from './testing';

const fixture = getFixture('mega-image-2026-11-03');
const truth = fixture.expected;

/** What Gemini would read from the photo, from the fixture's ground truth plus what a test changes. */
function geminiReading(change: Record<string, unknown> = {}): ParsedReceipt {
  const answer = {
    ...(JSON.parse(answerFromReceipt(truth)) as Record<string, unknown>),
    ...change,
  };
  return convertAnswer(JSON.stringify(answer), {
    model: 'gemini-test',
    now: new Date(fixture.now),
  });
}

/** The receipt on screen before the AI reading: an OCR reading of the photo, saved as a draft. */
function onScreen(change: Partial<ReceiptForm> = {}): ReceiptForm {
  const ocr: ParsedReceipt = {
    ...truth,
    meta: { ...truth.meta, engine: 'tesseract', parser: 'mega-image', parserVersion: '1.0.0' },
    lines: truth.lines.map((line, index) =>
      index === 0 ? { ...line, lineTotalBani: 1719 } : line,
    ),
  };
  const draft = draftFromParsed(
    ocr,
    { kind: 'image', fileHash: 'a'.repeat(64), fileName: 'bon.jpg' },
    testIds,
  );
  return { ...formFromDraft(draft), id: 'receipt-1', storeId: 'store-1', ...change };
}

let db: PretometruDB;
beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});
afterEach(async () => {
  await db.delete();
});

describe('adoptReading', () => {
  it('keeps the receipt (its id, store record, status and source) and takes lines, totals and extraction from the reading', async () => {
    const current = onScreen();
    const { form } = await adoptReading(testServices(db), current, geminiReading());

    expect(form).toMatchObject({
      id: 'receipt-1',
      storeId: 'store-1',
      status: 'draft',
      source: current.source,
      total: '65,86',
      extraction: { engine: 'gemini', parser: 'gemini-test', warnings: [] },
    });
    expect(form.lines.map((line) => line.rawName)).toEqual(truth.lines.map((line) => line.rawName));
    expect(form.lines.map((line) => line.total)).toEqual(['17,89', '14,99', '12,99', '19,99']);
    // New lines, new ids: the old ones are tombstoned by the save.
    expect(new Set([...form.lines, ...current.lines].map((line) => line.id)).size).toBe(8);
    expect(form.lines.every((line) => line.productId === undefined)).toBe(true);
  });

  it('keeps a chain the user chose when the reading could not tell the store, and takes a store it knows', async () => {
    const unsure = await adoptReading(
      testServices(db),
      onScreen({ chain: 'mega-image' }),
      geminiReading({ chain: 'unknown' }),
    );
    expect(unsure.form.chain).toBe('mega-image');

    const sure = await adoptReading(
      testServices(db),
      onScreen({ chain: 'mega-image' }),
      geminiReading({ chain: 'lidl' }),
    );
    expect(sure.form.chain).toBe('lidl');

    const other = await adoptReading(
      testServices(db),
      onScreen({ chain: 'unknown', storeName: 'Alimentara' }),
      geminiReading({ chain: 'unknown', store: 'Mini Market' }),
    );
    expect(other.form).toMatchObject({ chain: 'unknown', storeName: 'Mini Market' });
  });

  it("takes the date of the reading when it has one, and keeps the receipt's when it has none", async () => {
    const current = onScreen({ date: '2026-11-03', time: '16:57' });

    const read = await adoptReading(
      testServices(db),
      current,
      geminiReading({ purchasedAt: '2026-11-04' }),
    );
    expect(read.form).toMatchObject({ date: '2026-11-04', time: '' });

    const missed = await adoptReading(
      testServices(db),
      current,
      geminiReading({ purchasedAt: undefined }),
    );
    expect(missed.form).toMatchObject({ date: '2026-11-03', time: '16:57' });
    // The reading's own warning about the missing date is not part of what the review shows: it recomputes.
    expect(missed.form.extraction.warnings.map((warning) => warning.code)).toContain(
      'MISSING_DATE',
    );
  });

  it('keeps the document number, city and branch the receipt had when the reading has none', async () => {
    const current = onScreen({ documentNo: '4711', city: 'Cluj-Napoca', branchCode: '12' });
    const { form } = await adoptReading(testServices(db), current, geminiReading());
    expect(form).toMatchObject({ documentNo: '4711', city: 'Cluj-Napoca', branchCode: '12' });

    const read = await adoptReading(
      testServices(db),
      current,
      geminiReading({ documentNumber: '99', city: 'Iași' }),
    );
    expect(read.form).toMatchObject({ documentNo: '99', city: 'Iași', branchCode: '12' });
  });

  it('asks the catalog about the new lines, under the chain the receipt ends up with', async () => {
    const catalog = fakeCatalog();
    const product = await catalog.createProduct(db, {
      name: 'Caju crud',
      categoryId: (await db.categories.toArray())[0]?.id ?? '',
      baseUnit: 'kg',
    });
    await catalog.rememberMappings(db, 'mega-image', [
      { rawName: 'CAJU CRUDE 200G', productId: product.id },
    ]);

    const { form, suggestions, products } = await adoptReading(
      testServices(db, { catalog }),
      onScreen({ chain: 'mega-image' }),
      geminiReading({ chain: 'unknown' }),
    );

    const mapped = form.lines.find((line) => line.rawName === 'CAJU CRUDE 200G');
    expect(mapped?.productId).toBe(product.id);
    expect(suggestions[mapped?.id ?? '']).toMatchObject({ productId: product.id, via: 'alias' });
    expect(products.map((candidate) => candidate.id)).toEqual([product.id]);
    expect(Object.keys(suggestions)).toHaveLength(form.lines.length);
  });

  it('leaves the lines unmapped, without failing, when the catalog does', async () => {
    const catalog = {
      ...fakeCatalog(),
      suggestMappings: () => Promise.reject(new Error('catalog is down')),
    };
    const { form, suggestions } = await adoptReading(
      testServices(db, { catalog }),
      onScreen(),
      geminiReading(),
    );
    expect(form.lines).toHaveLength(4);
    expect(suggestions).toEqual({});
  });
});

describe('the two readings in the review state', () => {
  const ocr = onScreen();
  const state = initialReviewState(ocr);

  it('replaces one by the other, keeps the first, and swaps between them without losing either', async () => {
    const { form: gemini } = await adoptReading(testServices(db), ocr, geminiReading());
    const edited = reviewReducer(state, {
      type: 'edit-line',
      id: ocr.lines[1]?.id ?? '',
      patch: { total: '15,00' },
    });

    const replaced = reviewReducer(edited, { type: 'replace-reading', form: gemini });
    expect(replaced.form).toBe(gemini);
    expect(replaced.alternate?.form.lines[1]?.total).toBe('15,00');
    expect(replaced.reviewed).toEqual([]);
    expect(replaced.alternate?.reviewed).toEqual(edited.reviewed);
    expect(isDirty(replaced)).toBe(true);

    const back = reviewReducer(replaced, { type: 'swap-reading' });
    expect(back.form.lines[1]?.total).toBe('15,00');
    expect(back.reviewed).toEqual(edited.reviewed);
    expect(back.alternate?.form).toBe(gemini);

    const again = reviewReducer(back, { type: 'swap-reading' });
    expect(again.form).toBe(gemini);
  });

  it('is clean again when the first reading is shown and nothing was edited', async () => {
    const { form: gemini } = await adoptReading(testServices(db), ocr, geminiReading());
    const back = reviewReducer(reviewReducer(state, { type: 'replace-reading', form: gemini }), {
      type: 'swap-reading',
    });
    expect(isDirty(back)).toBe(false);
  });

  it('does nothing to swap without another reading, and forgets the other one once the receipt is saved', async () => {
    expect(reviewReducer(state, { type: 'swap-reading' })).toBe(state);

    const { form: gemini } = await adoptReading(testServices(db), ocr, geminiReading());
    const replaced = reviewReducer(state, { type: 'replace-reading', form: gemini });
    const saved = reviewReducer(replaced, {
      type: 'saved',
      receipt: { id: 'receipt-1', storeId: 'store-1', status: 'draft' },
      warnings: [],
    });
    expect(saved.alternate).toBeUndefined();
    expect(isDirty(saved)).toBe(false);
    expect(saved.form.extraction.engine).toBe('gemini');
  });
});
