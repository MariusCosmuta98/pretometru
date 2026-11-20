import { describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID } from '@/domain';
import { draftFromParsed, type ReceiptDraft } from './draft';
import {
  addLine,
  applySuggestions,
  formFromDraft,
  patchLine,
  readForm,
  removeLine,
  type LineForm,
} from './form';
import type { LineMapping } from './ports';
import { sampleReceipt, testIds } from './testing';

function sampleDraft(overrides: Partial<ReceiptDraft> = {}): ReceiptDraft {
  return {
    ...draftFromParsed(sampleReceipt(), { kind: 'pdf', fileHash: 'a'.repeat(64) }, testIds),
    ...overrides,
  };
}

function linesOf(draft: ReceiptDraft): [LineForm, LineForm, LineForm, LineForm] {
  const lines = formFromDraft(draft).lines;
  const [a, b, c, d] = lines;
  if (!a || !b || !c || !d) throw new Error('expected four lines');
  return [a, b, c, d];
}

describe('formFromDraft and readForm', () => {
  it('round-trips a draft through its text form', () => {
    const draft = sampleDraft({ paidBani: 3745, docType: 'invoice', documentNo: 'F-100' });
    draft.lines = draft.lines.map((line, index) =>
      index === 0
        ? { ...line, discountBani: 249, productId: testIds(), categoryId: testIds() }
        : line,
    );

    const read = readForm(formFromDraft(draft));

    expect(read.hasErrors).toBe(false);
    expect(read.draft).toEqual(draft);
  });

  it('shows money with a decimal comma and times without zero seconds', () => {
    const form = formFromDraft(
      sampleDraft({ purchasedAt: '2026-11-07T18:31:00', totalBani: 123456 }),
    );
    expect(form).toMatchObject({ date: '2026-11-07', time: '18:31', total: '1234,56', paid: '' });
    const [milk, chicken] = form.lines;
    expect(milk).toMatchObject({
      qty: '2',
      total: '11,98',
      unitPrice: '5,99',
      packQty: '1',
      packUnit: 'l',
    });
    expect(chicken).toMatchObject({ qty: '0,92', qtyUnit: 'kg', total: '22,99', packQty: '' });
    expect(readForm(form).draft.purchasedAt).toBe('2026-11-07T18:31');
  });

  it('keeps a date-only purchase date date-only', () => {
    const read = readForm(formFromDraft(sampleDraft({ purchasedAt: '2026-11-07' })));
    expect(read.draft.purchasedAt).toBe('2026-11-07');
  });

  it('reports each invalid field and leaves that line out of the draft', () => {
    const draft = sampleDraft();
    const form = formFromDraft(draft);
    const [first, second, third, fourth] = linesOf(draft);
    const broken = {
      ...form,
      date: '2026-13-40',
      total: '12,345',
      paid: 'x',
      lines: [
        { ...first, rawName: '  ', qty: '0', total: '', ean: '12' },
        { ...second, discount: '-1', unitPrice: 'abc', packQty: '1,5', unitsPerPack: '0' },
        third,
        fourth,
      ],
    };

    const read = readForm(broken);

    expect(read.hasErrors).toBe(true);
    expect(read.errors.receipt).toEqual({ date: 'invalid', total: 'invalid', paid: 'invalid' });
    expect(read.errors.lines[first.id]).toEqual({
      rawName: 'required',
      qty: 'invalid',
      total: 'required',
      ean: 'invalid',
    });
    expect(read.errors.lines[second.id]).toEqual({
      discount: 'invalid',
      unitPrice: 'invalid',
      unitsPerPack: 'invalid',
    });
    expect(read.errors.lines[third.id]).toBeUndefined();
    expect(read.draft.lines.map((line) => line.id)).toEqual([third.id, fourth.id]);
  });

  it('checks the date and the time together', () => {
    const form = formFromDraft(sampleDraft());
    expect(readForm({ ...form, date: '', time: '10:00' }).errors.receipt).toEqual({
      date: 'required',
    });
    expect(readForm({ ...form, time: '25:00' }).errors.receipt).toEqual({ time: 'invalid' });
    const cleared = readForm({ ...form, date: '', time: '' });
    expect(cleared.hasErrors).toBe(false);
    expect(cleared.draft.purchasedAt).toBeUndefined();
  });

  it('reads the store from the chain; the printed name only names an unknown chain', () => {
    const form = formFromDraft(sampleDraft());
    expect(readForm({ ...form, storeName: 'Ignored', city: ' Cluj ' }).draft.store).toEqual({
      chain: 'kaufland',
      city: 'Cluj',
    });
    expect(readForm({ ...form, chain: 'unknown', storeName: ' Alfa ' }).draft.store).toEqual({
      chain: 'unknown',
      name: 'Alfa',
    });
  });
});

describe('editing', () => {
  it('drops the product mapping of a line that stops being a product', () => {
    const draft = sampleDraft();
    const form = formFromDraft(draft);
    const [first] = form.lines;
    if (!first) throw new Error('missing line');
    const mapped = patchLine(form, first.id, { productId: 'P1', categoryId: 'C1' });

    const bag = patchLine(mapped, first.id, { kind: 'bag' });
    expect(bag.lines[0]).not.toHaveProperty('productId');
    expect(bag.lines[0]).not.toHaveProperty('categoryId');

    const back = patchLine(patchLine(mapped, first.id, { kind: 'fee' }), first.id, {
      kind: 'product',
      categoryId: NON_PRODUCT_CATEGORY_ID,
    });
    expect(back.lines[0]).not.toHaveProperty('categoryId');
  });

  it('appends new lines after the last printed one and removes lines by id', () => {
    const form = formFromDraft(sampleDraft());
    const added = addLine(addLine(form, 'A'), 'B');
    expect(added.lines.map((line) => line.idx)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(added.lines.at(-1)).toMatchObject({
      id: 'B',
      rawName: '',
      qty: '1',
      qtyUnit: 'buc',
      total: '',
    });

    const without = removeLine(added, form.lines[1]?.id ?? '');
    expect(without.lines.map((line) => line.idx)).toEqual([0, 2, 3, 4, 5]);
    expect(addLine(without, 'C').lines.at(-1)?.idx).toBe(6);
  });
});

describe('applySuggestions', () => {
  const none: LineMapping = { via: 'none', candidates: [] };

  it('fills in what the catalog is sure of, and only where the user has chosen nothing', () => {
    const form = formFromDraft(sampleDraft());
    const mappings: LineMapping[] = [
      {
        productId: 'P1',
        categoryId: 'C1',
        pack: { qty: 500, unit: 'g' },
        via: 'alias',
        candidates: [],
      },
      { categoryId: 'C2', via: 'category-hint', candidates: [] },
      {
        productId: 'P3',
        categoryId: 'C3',
        pack: { qty: 6, unit: 'role', unitsPerPack: 6 },
        via: 'ean',
        candidates: [],
      },
      { categoryId: NON_PRODUCT_CATEGORY_ID, via: 'none', candidates: [] },
    ];
    const mapped = applySuggestions(form, mappings);
    const [milk, chicken, wipes, deposit] = mapped.lines;

    // The printed pack size (1 l) wins over a remembered one.
    expect(milk).toMatchObject({ productId: 'P1', categoryId: 'C1', packQty: '1', packUnit: 'l' });
    expect(chicken).toMatchObject({ categoryId: 'C2' });
    expect(chicken).not.toHaveProperty('productId');
    // The wipes' name already has a size, too.
    expect(wipes).toMatchObject({ productId: 'P3', packQty: '120', packUnit: 'buc' });
    // Non-product lines are left to the storage layer's Non-produs default.
    expect(deposit).not.toHaveProperty('productId');
    expect(deposit).not.toHaveProperty('categoryId');

    const kept = applySuggestions(patchLine(form, form.lines[0]?.id ?? '', { productId: 'MINE' }), [
      mappings[0] ?? none,
      none,
      none,
      none,
    ]);
    expect(kept.lines[0]).toMatchObject({ productId: 'MINE' });
    expect(kept.lines[0]).not.toHaveProperty('categoryId');
  });

  it('fills a missing pack size from a remembered one', () => {
    const form = formFromDraft(sampleDraft());
    const first = form.lines[0];
    if (!first) throw new Error('missing line');
    const noPack = patchLine(form, first.id, { packQty: '', unitsPerPack: '' });

    const mapped = applySuggestions(noPack, [
      {
        productId: 'P1',
        via: 'alias',
        pack: { qty: 1, unit: 'l', unitsPerPack: 6 },
        candidates: [],
      },
    ]);

    expect(mapped.lines[0]).toMatchObject({
      productId: 'P1',
      packQty: '1',
      packUnit: 'l',
      unitsPerPack: '6',
    });
  });

  it('tolerates a catalog that answers fewer lines than there are', () => {
    const form = formFromDraft(sampleDraft());
    expect(applySuggestions(form, [])).toEqual(form);
  });
});
