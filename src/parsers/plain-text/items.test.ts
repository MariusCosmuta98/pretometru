import { describe, expect, it } from 'vitest';
import { readItems } from './items';
import { readInlineQuantity, readQuantityLine } from './quantity-line';
import { textLines } from './text-lines';

const linesOf = (...texts: string[]) => textLines({ kind: 'pasted-text', text: texts.join('\n') });

describe('readQuantityLine', () => {
  it.each([
    ['2,000 BUC x 4,05', { qty: 2, qtyUnit: 'buc', unitPriceBani: 405 }],
    ['1,000 BUC x 18,49', { qty: 1, qtyUnit: 'buc', unitPriceBani: 1849 }],
    ['0,436 KG x 14,99', { qty: 0.436, qtyUnit: 'kg', unitPriceBani: 1499 }],
    ['0,436 kg x 14,99 Lei/kg', { qty: 0.436, qtyUnit: 'kg', unitPriceBani: 1499 }],
    ['3 BUC x 1,25', { qty: 3, qtyUnit: 'buc', unitPriceBani: 125 }],
    ['2,000 BUC × 4,05', { qty: 2, qtyUnit: 'buc', unitPriceBani: 405 }],
    ['2.000 BUC x4,05', { qty: 2, qtyUnit: 'buc', unitPriceBani: 405 }],
  ])('reads %j', (text, expected) => {
    expect(readQuantityLine(text)).toEqual(expected);
  });

  it.each([
    ['a product that starts with a size', '2L Xylitol 5,99'],
    ['a product line', 'Mascarpone 18,49 B'],
    ['a pack size', '250 g x 12,99'],
    ['a product named after a count', '2 x 500ML COLA 5,99'],
    ['a line without a price', '2,000 BUC x'],
    ['a negative unit price', '2,000 BUC x -4,05'],
  ])('does not take %s for a quantity', (_what, text) => {
    expect(readQuantityLine(text)).toBeUndefined();
  });

  it('accepts a unit that OCR garbled when the quantity has the n,000 format', () => {
    expect(readQuantityLine('2,000 BUG x 4,05')).toEqual({
      qty: 2,
      qtyUnit: 'buc',
      unitPriceBani: 405,
    });
  });
});

describe('readInlineQuantity', () => {
  it('splits the name from the quantity at the end of a label', () => {
    expect(readInlineQuantity('Lapte 1L 2 x 5,99')).toEqual({
      name: 'Lapte 1L',
      qty: 2,
      qtyUnit: 'buc',
      unitPriceBani: 599,
    });
    expect(readInlineQuantity('Lapte 1L')).toBeUndefined();
  });
});

describe('readItems', () => {
  it('pairs a quantity line with the product line below it', () => {
    const lines = linesOf(
      '2,000 BUC x 4,05',
      'Saci menajeri 60L 8,10 A',
      '1,000 BUC x 9,10',
      'Smantana 30% 9,10 B',
    );
    const { drafts, unreadable } = readItems(lines, lines.length);

    expect(
      drafts.map((draft) => [
        draft.rawName,
        draft.qty,
        draft.unitPriceBani,
        draft.lineTotalBani,
        draft.vatClass,
      ]),
    ).toEqual([
      ['Saci menajeri 60L', 2, 405, 810, 'A'],
      ['Smantana 30%', 1, 910, 910, 'B'],
    ]);
    expect(unreadable).toEqual([]);
    expect(drafts[0]?.from.map((line) => line.index)).toEqual([0, 1]);
  });

  it('reads a product line on its own as one piece with no unit price', () => {
    const lines = linesOf('Painea alba 3,49 A');
    const { drafts } = readItems(lines, lines.length);

    expect(drafts).toMatchObject([
      { rawName: 'Painea alba', qty: 1, qtyUnit: 'buc', lineTotalBani: 349 },
    ]);
    expect(drafts[0]?.unitPriceBani).toBeUndefined();
  });

  it('keeps a quantity line whose product line did not survive, with the total it proves', () => {
    const lines = linesOf('3,000 BUC x 1,25', '%%%% ???', 'Apa 2,00 A');
    const { drafts, unreadable } = readItems(lines, lines.length);

    expect(drafts.map((draft) => [draft.rawName, draft.lineTotalBani])).toEqual([
      ['Produs necunoscut', 375],
      ['Apa', 200],
    ]);
    expect(unreadable).toEqual([0]);
  });

  it('attaches the EAN line under a product when asked to', () => {
    const lines = linesOf('ALWAYS ULTRA 16BUC 17,89', '401540000675', 'EMMA NUCI 200G 12,99');
    const { drafts } = readItems(lines, lines.length, { eanLines: true });

    expect(drafts.map((draft) => [draft.rawName, draft.ean])).toEqual([
      ['ALWAYS ULTRA 16BUC', '401540000675'],
      ['EMMA NUCI 200G', undefined],
    ]);
    expect(drafts[0]?.from).toHaveLength(2);

    const plain = readItems(lines, lines.length);
    expect(plain.drafts.map((draft) => draft.ean)).toEqual([undefined, undefined]);
  });

  it('reads the quantity inside the product line when asked to', () => {
    const lines = linesOf('Lapte 1L 2 x 5,99 11,98 B');
    const { drafts } = readItems(lines, lines.length, { inlineQuantity: true });

    expect(drafts).toMatchObject([
      { rawName: 'Lapte 1L', qty: 2, unitPriceBani: 599, lineTotalBani: 1198, vatClass: 'B' },
    ]);
  });

  it('skips the lines it is told to, and stops at `end`', () => {
    const lines = linesOf('Lapte 5,99', 'TVA 21% 1,04', 'Paine 3,49', 'TOTAL 9,48');
    const { drafts } = readItems(lines, 3, { skip: (text) => /^tva\b/i.test(text) });

    expect(drafts.map((draft) => draft.rawName)).toEqual(['Lapte', 'Paine']);
  });

  it('does not make an item out of a quantity beyond the contract', () => {
    const lines = linesOf('99999,000 BUC x 99999,00', 'ceva');
    expect(readItems(lines, lines.length).drafts).toEqual([]);
  });
});
