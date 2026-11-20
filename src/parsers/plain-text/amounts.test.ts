import { describe, expect, it } from 'vitest';
import { digitize, findAmounts, parsePrintedQuantity, trailingAmount, vatClassOf } from './amounts';

describe('findAmounts', () => {
  it.each([
    ['Lapte 5,99', [599]],
    ['Smantana 30% 9,10 B', [910]],
    ['1.234,56', [123456]],
    ['Cafea 12.99', [1299]],
    ['REDUCERE -1,50 A', [-150]],
    ['Cupon 2,49-', [-249]],
    ['BUC x4,05', [405]],
    ['2,000 BUC x 4,05', [405]],
    ['TVA A 21,00% 5,91', [2100, 591]],
  ])('finds the amounts of %j', (text, expected) => {
    expect(findAmounts(text).map((amount) => amount.bani)).toEqual(expected);
  });

  it('accepts letters that OCR reads in place of a digit, but only next to real digits', () => {
    expect(findAmounts('Lapte 5,9O')[0]?.bani).toBe(590);
    expect(findAmounts('Lapte 1O,99')[0]?.bani).toBe(1099);
    expect(findAmounts('BIO,SS')).toEqual([]);
  });

  it.each([
    ['a quantity with three decimals', '2,000'],
    ['a code', 'A12,99'],
    ['a decimal with one digit', 'Apa 0,5 L'],
    ['an amount beyond the contract (10 million RON)', 'Cod 99999999999,99'],
    ['a plain number', 'Strada Vaida 59'],
  ])('does not take %s for an amount', (_what, text) => {
    expect(findAmounts(text)).toEqual([]);
  });

  it('reports where each amount sits in the line', () => {
    const [amount] = findAmounts('Lapte 5,99 A');

    expect(amount).toMatchObject({ text: '5,99', start: 6, end: 10 });
  });
});

describe('trailingAmount', () => {
  it('splits a product line into its name, total and what follows', () => {
    expect(trailingAmount('Servetele umede univ. 5,99 A')).toMatchObject({
      label: 'Servetele umede univ.',
      amount: { bani: 599 },
      rest: 'A',
    });
    expect(trailingAmount('ALWAYS ULTRA 16BUC 17,85')).toMatchObject({
      label: 'ALWAYS ULTRA 16BUC',
      rest: '',
    });
  });

  it('takes the last amount and leaves earlier numbers in the name', () => {
    expect(trailingAmount('Buchet 7 fire 19,99 A')?.label).toBe('Buchet 7 fire');
    expect(trailingAmount('Lapte 2,50 L 5,00')?.label).toBe('Lapte 2,50 L');
  });

  it('refuses a line where the amount is followed by text (a sentence, not a product line)', () => {
    expect(trailingAmount('Lapte 5,99 si multe alte cuvinte')).toBeUndefined();
    expect(trailingAmount('Fara pret')).toBeUndefined();
  });
});

describe('vatClassOf', () => {
  it('reads the class letter and ignores noise after it', () => {
    expect(vatClassOf('B')).toBe('B');
    expect(vatClassOf('A ]')).toBe('A');
    expect(vatClassOf('')).toBeUndefined();
    expect(vatClassOf('lei')).toBeUndefined();
  });
});

describe('parsePrintedQuantity', () => {
  it.each([
    ['2,000', 2],
    ['0,920', 0.92],
    ['1.000', 1],
    ['12', 12],
    ['l,000', 1],
    ['2,O00', 2],
  ])('reads %j as %d', (text, qty) => {
    expect(parsePrintedQuantity(text)).toBe(qty);
  });

  it.each(['', 'abc', '0,000', '1,2345', '-1', '1000000'])('rejects %j', (text) => {
    expect(parsePrintedQuantity(text)).toBeUndefined();
  });
});

describe('digitize', () => {
  it('turns the letters OCR reads as digits into digits and leaves the rest', () => {
    expect(digitize('1O,l5 SBZ x')).toBe('10,15 582 x');
  });
});
