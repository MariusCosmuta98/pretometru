import { describe, expect, it } from 'vitest';
import { isTotalsRow, readChangeRow, readPaymentRow, readSubtotalRow, readTotalRow } from './rows';

describe('readTotalRow', () => {
  it.each([
    ['TOTAL 61,67', 6167],
    ['Total: 61,67', 6167],
    ['TOTAL LEI 61,67', 6167],
    ['TOTAL 61,67 lei', 6167],
    ['TOTAL DE PLATA 1.234,56', 123456],
    ['T0TAL 61,67', 6167],
  ])('reads %j as %i bani', (text, bani) => {
    expect(readTotalRow(text)).toBe(bani);
  });

  it.each([
    ['the VAT total', 'TOTAL TVA 8,64'],
    ['a product that starts with the word', 'Total 0% grasime 5,99 B'],
    ['the subtotal', 'Subtotal 61,67'],
    ['a total without an amount', 'TOTAL'],
    ['a label after the amount', 'TOTAL 61,67 RON PLATIT'],
  ])('does not take %s for the total', (_what, text) => {
    expect(readTotalRow(text)).toBeUndefined();
  });
});

describe('the other rows of the totals block', () => {
  it('reads the subtotal, the payments and the change', () => {
    expect(readSubtotalRow('Subtotal 61,67')).toBe(6167);
    expect(readSubtotalRow('Sub-total: 61,67')).toBe(6167);
    expect(readPaymentRow('CARD 20,69')).toEqual({ method: 'card', bani: 2069 });
    expect(readPaymentRow('NUMERAR 100,00')).toEqual({ method: 'cash', bani: 10_000 });
    expect(readChangeRow('REST 6,86')).toBe(686);
    expect(readChangeRow('Rest de plata 6,86')).toBe(686);
  });

  it('leaves products with such names alone', () => {
    expect(readPaymentRow('Card cadou 50,00 A')).toBeUndefined();
    expect(readPaymentRow('TRANZACTIE CARD')).toBeUndefined();
    expect(readChangeRow('Restaurant 5,00')).toBeUndefined();
    expect(readSubtotalRow('Subtotal cafea 5,00 A')).toBeUndefined();
  });

  it('tells a totals row from a product row', () => {
    for (const row of ['TOTAL 9,48', 'Subtotal 9,48', 'TOTAL TVA 1,91', 'CARD 9,48', 'REST 0,52']) {
      expect(isTotalsRow(row), row).toBe(true);
    }
    for (const row of [
      'Lapte 5,99',
      'Total 0% grasime 5,99 B',
      'Card cadou 50,00 A',
      'TVA A 21,00% 5,91',
    ]) {
      expect(isTotalsRow(row), row).toBe(false);
    }
  });
});
