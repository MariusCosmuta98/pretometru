import { describe, expect, it } from 'vitest';
import type { ParseWarning, Receipt } from '@/domain';
import { makeReceipt } from '@/domain/testing';
import { SUM_TOLERANCE_BANI } from '@/parsers';
import { draftFromParsed, type ReceiptDraft } from './draft';
import { formFromDraft, patchLine, readForm } from './form';
import {
  analyze,
  confirmBlockers,
  pendingAcks,
  RECEIPT_REVIEW_KEY,
  type Analysis,
  type ReviewContext,
} from './review';
import { initialReviewState, isDirty, reviewReducer } from './review-state';
import { fakeParser, sampleReceipt, testIds, testNow } from './testing';

const parser = fakeParser(sampleReceipt());

function sampleDraft(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    ...draftFromParsed(sampleReceipt(), { kind: 'pdf' }, testIds),
    ...overrides,
  };
}

function context(overrides: Partial<ReviewContext> = {}): ReviewContext {
  return { parser, now: testNow(), duplicates: [], reviewed: new Set(), ...overrides };
}

const codes = (analysis: Analysis) => analysis.warnings.map((warning) => warning.code);

describe('analyze', () => {
  it('shows a consistent receipt without warnings', () => {
    const analysis = analyze(sampleDraft(), context());
    expect(analysis).toMatchObject({
      sumBani: 3945,
      totalBani: 3945,
      differenceBani: 0,
      warnings: [],
    });
    expect(analysis.ackTokens).toEqual({});
  });

  it('re-validates after an edit: a price that no longer adds up to the total', () => {
    const form = formFromDraft(sampleDraft());
    const [, chicken] = form.lines;
    if (!chicken) throw new Error('missing line');
    const edited = readForm(patchLine(form, chicken.id, { total: '22,89' })).draft;

    const analysis = analyze(edited, context());

    expect(analysis.differenceBani).toBe(-10);
    expect(codes(analysis)).toContain('SUM_MISMATCH');
    expect(analysis.ackTokens.SUM_MISMATCH).toBe('-10');
    // Within the 5 bani tolerance nothing is reported.
    const close = readForm(patchLine(form, chicken.id, { total: '22,97' })).draft;
    expect(codes(analyze(close, context()))).not.toContain('SUM_MISMATCH');
  });

  it('flags a purchase date after the clock, and only that one', () => {
    const future = analyze(sampleDraft({ purchasedAt: '2026-12-29T10:15' }), context());
    expect(codes(future)).toEqual(['FUTURE_DATE']);
    expect(future.ackTokens.FUTURE_DATE).toBe('2026-12-29T10:15');
    expect(codes(analyze(sampleDraft({ purchasedAt: '2026-11-20' }), context()))).toEqual([]);

    const noDate = sampleDraft();
    delete noDate.purchasedAt;
    expect(codes(analyze(noDate, context()))).toEqual(['MISSING_DATE']);
  });

  it('adds the duplicate check and an unknown chain, which the arithmetic validation does not know', () => {
    const twin: Receipt = makeReceipt();
    const analysis = analyze(
      sampleDraft({ store: { chain: 'unknown' } }),
      context({ duplicates: [twin] }),
    );
    expect(codes(analysis)).toEqual(['DUPLICATE', 'UNKNOWN_CHAIN']);
    expect(analysis.ackTokens.DUPLICATE).toBe(twin.id);
    expect(analysis.warnings.find((w) => w.code === 'DUPLICATE')?.message).toMatch(/similar/);
  });

  describe('the sum of the lines against the printed total', () => {
    // The sample's lines add up to 39,45. The total moves, so the difference is `sum - total`.
    const SUM = 3945;
    const withDifference = (differenceBani: number) =>
      analyze(sampleDraft({ totalBani: SUM - differenceBani }), context());

    it.each([
      [0, 'exact'],
      [1, 'within-tolerance'],
      [-1, 'within-tolerance'],
      [SUM_TOLERANCE_BANI, 'within-tolerance'],
      [-SUM_TOLERANCE_BANI, 'within-tolerance'],
      [SUM_TOLERANCE_BANI + 1, 'outside-tolerance'],
      [-(SUM_TOLERANCE_BANI + 1), 'outside-tolerance'],
    ] as const)('a difference of %i bani is %s', (differenceBani, sumMatch) => {
      const analysis = withDifference(differenceBani);
      expect(analysis).toMatchObject({
        differenceBani,
        sumMatch,
        toleranceBani: SUM_TOLERANCE_BANI,
      });
    });

    it('is outside the tolerance exactly when the parsers raise SUM_MISMATCH', () => {
      for (
        let difference = -2 * SUM_TOLERANCE_BANI;
        difference <= 2 * SUM_TOLERANCE_BANI;
        difference++
      ) {
        const analysis = withDifference(difference);
        expect(codes(analysis).includes('SUM_MISMATCH'), `a difference of ${difference} bani`).toBe(
          analysis.sumMatch === 'outside-tolerance',
        );
      }
    });

    it('keeps the amounts as they are: a difference inside the tolerance is shown, never absorbed', () => {
      const analysis = withDifference(SUM_TOLERANCE_BANI);
      expect(analysis).toMatchObject({ sumBani: SUM, totalBani: SUM - SUM_TOLERANCE_BANI });
      expect(analysis.ackTokens).toEqual({});
      expect(analysis.warnings).toEqual([]);
    });

    it('has no tolerance for a total that was not read', () => {
      const [first] = sampleDraft().lines;
      if (!first) throw new Error('missing line');
      const analysis = analyze(
        sampleDraft({ totalBani: 0, lines: [{ ...first, lineTotalBani: SUM_TOLERANCE_BANI }] }),
        context(),
      );
      expect(analysis.differenceBani).toBe(SUM_TOLERANCE_BANI);
      expect(analysis.sumMatch).toBe('outside-tolerance');
      expect(codes(analysis)).toContain('MISSING_TOTAL');
    });
  });

  describe('warnings carried over from the import', () => {
    const imported: ParseWarning[] = [
      { code: 'REPAIRED_DIGITS', lineIdx: 1, message: 'Cifre corectate pe linia 2.' },
      { code: 'LOW_CONFIDENCE', lineIdx: 2, message: 'Citire nesigură pe linia 3.' },
      { code: 'LOW_CONFIDENCE', message: 'Citirea bonului a fost nesigură.' },
      // Line 3 has no printed unit price any more, line 1 still has one.
      { code: 'LINE_ARITHMETIC', lineIdx: 2, message: 'Linia 3 nu se potrivește.' },
      { code: 'LINE_ARITHMETIC', lineIdx: 0, message: 'Linia 1 nu se potrivește.' },
      { code: 'SUM_MISMATCH', message: 'Învechit: se recalculează.' },
      { code: 'REPAIRED_DIGITS', lineIdx: 99, message: 'Linia a fost ștearsă.' },
    ];
    const draft = () => {
      const base = sampleDraft();
      return { ...base, extraction: { ...base.extraction, warnings: imported } };
    };
    const summary = (analysis: Analysis) => analysis.warnings.map((w) => [w.code, w.lineIdx]);

    it('keeps what cannot be recomputed, receipt-level first, and drops the rest', () => {
      expect(summary(analyze(draft(), context()))).toEqual([
        ['LOW_CONFIDENCE', undefined],
        ['REPAIRED_DIGITS', 1],
        ['LOW_CONFIDENCE', 2],
        ['LINE_ARITHMETIC', 2],
      ]);
    });

    it('lets the fresh validation decide when the printed unit price is known', () => {
      // Line 1 (2 x 5,99 = 11,98) adds up, so its stale arithmetic warning is not shown.
      expect(codes(analyze(draft(), context()))).toHaveLength(4);
      const broken = draft();
      broken.lines = broken.lines.map((line) =>
        line.idx === 0 ? { ...line, unitPriceBani: 700 } : line,
      );
      const analysis = analyze(broken, context());
      expect(analysis.warnings.filter((w) => w.lineIdx === 0).map((w) => w.code)).toEqual([
        'LINE_ARITHMETIC',
      ]);
      expect(analysis.warnings.find((w) => w.lineIdx === 0)?.message).not.toBe(
        'Linia 1 nu se potrivește.',
      );
    });

    it('ends when the user has edited or verified the line, or verified the receipt', () => {
      const base = draft();
      const [first, second, third] = base.lines;
      if (!first || !second || !third) throw new Error('missing lines');

      const edited = analyze(base, context({ reviewed: new Set([second.id]) }));
      expect(summary(edited)).toEqual([
        ['LOW_CONFIDENCE', undefined],
        ['LOW_CONFIDENCE', 2],
        ['LINE_ARITHMETIC', 2],
      ]);

      const everything = analyze(
        base,
        context({ reviewed: new Set([second.id, third.id, RECEIPT_REVIEW_KEY]) }),
      );
      expect(everything.warnings).toEqual([]);
    });
  });
});

describe('acknowledgements', () => {
  it('lapse when the accepted situation changes', () => {
    const future = analyze(sampleDraft({ purchasedAt: '2026-12-29T10:15' }), context());
    expect(pendingAcks(future, {})).toEqual(['FUTURE_DATE']);
    expect(pendingAcks(future, { FUTURE_DATE: '2026-12-29T10:15' })).toEqual([]);

    const otherDate = analyze(sampleDraft({ purchasedAt: '2027-01-02' }), context());
    expect(pendingAcks(otherDate, { FUTURE_DATE: '2026-12-29T10:15' })).toEqual(['FUTURE_DATE']);
  });

  it('are only asked for while the warning applies', () => {
    expect(pendingAcks(analyze(sampleDraft(), context()), { FUTURE_DATE: 'x' })).toEqual([]);
  });
});

describe('confirmBlockers', () => {
  const blockersFor = (
    mutate: (draft: ReceiptDraft) => ReceiptDraft = (d) => d,
    acks = {},
    editForm = (form: ReturnType<typeof formFromDraft>) => form,
  ) => {
    const draft = mutate(sampleDraft());
    const form = editForm(formFromDraft(draft));
    const read = readForm(form);
    return confirmBlockers(form, read, analyze(read.draft, context()), acks);
  };

  it('lets a complete, consistent receipt through', () => {
    expect(blockersFor()).toEqual([]);
  });

  it('needs a date, a positive total and at least one line', () => {
    const undated = (draft: ReceiptDraft) => {
      const copy = { ...draft };
      delete copy.purchasedAt;
      return copy;
    };
    expect(blockersFor(undated)).toEqual([
      { kind: 'field', target: { scope: 'receipt', field: 'date' }, error: 'required' },
    ]);
    expect(blockersFor((d) => ({ ...d, lines: [], totalBani: 0 }))).toEqual([
      { kind: 'field', target: { scope: 'receipt', field: 'total' }, error: 'not-positive' },
      { kind: 'no-lines' },
    ]);
  });

  it('points at every invalid field, in screen order', () => {
    const draft = sampleDraft();
    const [first, second] = draft.lines;
    if (!first || !second) throw new Error('missing lines');
    const blockers = blockersFor(
      () => draft,
      {},
      (form) => {
        const broken = patchLine(patchLine(form, second.id, { qty: 'x' }), first.id, { total: '' });
        return { ...broken, total: '??' };
      },
    );
    expect(blockers).toEqual([
      { kind: 'field', target: { scope: 'receipt', field: 'total' }, error: 'invalid' },
      {
        kind: 'field',
        target: { scope: 'line', lineId: first.id, field: 'total' },
        error: 'required',
      },
      {
        kind: 'field',
        target: { scope: 'line', lineId: second.id, field: 'qty' },
        error: 'invalid',
      },
    ]);
  });

  it('wants the date accepted, once, until it changes', () => {
    const future = (draft: ReceiptDraft) => ({ ...draft, purchasedAt: '2026-12-29T10:15' });
    expect(blockersFor(future)).toEqual([{ kind: 'ack', code: 'FUTURE_DATE' }]);
    expect(blockersFor(future, { FUTURE_DATE: '2026-12-29T10:15' })).toEqual([]);
  });
});

describe('reviewReducer', () => {
  const start = () => initialReviewState(formFromDraft(sampleDraft()));

  it('tracks unsaved edits', () => {
    const state = start();
    expect(isDirty(state)).toBe(false);
    const first = state.form.lines[0];
    if (!first) throw new Error('missing line');

    const edited = reviewReducer(state, {
      type: 'edit-line',
      id: first.id,
      patch: { total: '12,00' },
    });
    expect(isDirty(edited)).toBe(true);
    const restored = reviewReducer(edited, {
      type: 'edit-line',
      id: first.id,
      patch: { total: '11,98' },
    });
    expect(isDirty(restored)).toBe(false);
  });

  it("counts a change to a line's price or name, not its mapping, as reviewing it", () => {
    const state = start();
    const [first, second] = state.form.lines;
    if (!first || !second) throw new Error('missing lines');

    const afterPrice = reviewReducer(state, {
      type: 'edit-line',
      id: first.id,
      patch: { total: '12,00' },
    });
    const afterMapping = reviewReducer(afterPrice, {
      type: 'edit-line',
      id: second.id,
      patch: { productId: 'P1', ean: '5941234567890' },
    });
    expect(afterMapping.reviewed).toEqual([first.id]);

    const verified = reviewReducer(afterMapping, { type: 'verify', key: second.id });
    expect(verified.reviewed).toEqual([first.id, second.id]);
    expect(reviewReducer(verified, { type: 'verify', key: second.id }).reviewed).toEqual(
      verified.reviewed,
    );
  });

  it('adds and removes lines and records acceptances', () => {
    let state = reviewReducer(start(), { type: 'add-line', id: 'NEW' });
    expect(state.form.lines).toHaveLength(5);
    state = reviewReducer(state, { type: 'remove-line', id: 'NEW' });
    expect(state.form.lines).toHaveLength(4);

    state = reviewReducer(state, { type: 'accept', code: 'FUTURE_DATE', token: '2026-12-29' });
    expect(state.acks).toEqual({ FUTURE_DATE: '2026-12-29' });
    expect(reviewReducer(state, { type: 'withdraw', code: 'FUTURE_DATE' }).acks).toEqual({});
  });

  it('starts clean again after a save, which adopts the persisted id, store and warnings', () => {
    const state = reviewReducer(
      reviewReducer(start(), { type: 'edit-receipt', patch: { documentNo: 'A1' } }),
      { type: 'verify', key: RECEIPT_REVIEW_KEY },
    );
    const warnings: ParseWarning[] = [{ code: 'FUTURE_DATE', message: 'x' }];
    const saved = reviewReducer(state, {
      type: 'saved',
      receipt: { id: 'R1', storeId: 'S1', status: 'draft' },
      warnings,
    });

    expect(isDirty(saved)).toBe(false);
    expect(saved.reviewed).toEqual([]);
    expect(saved.form).toMatchObject({
      id: 'R1',
      storeId: 'S1',
      status: 'draft',
      documentNo: 'A1',
    });
    expect(saved.form.extraction.warnings).toBe(warnings);
  });
});
