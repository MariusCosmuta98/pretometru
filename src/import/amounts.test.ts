import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatLeiInput,
  formatQtyInput,
  parseEanInput,
  parseLeiInput,
  parseQtyInput,
} from './amounts';

describe('parseLeiInput', () => {
  it.each([
    ['22,99', 2299],
    ['22.99', 2299],
    ['1.234,56', 123456],
    ['1 234,56', 123456],
    ['22', 2200],
    ['2,5', 250],
    ['2.5', 250],
    ['0', 0],
    ['-20,00', -2000],
    ['2,49-', -249],
    ['12,50 lei', 1250],
    ['  7,05 ', 705],
  ])('reads %j as %i bani', (text, bani) => {
    expect(parseLeiInput(text)).toBe(bani);
  });

  it.each(['', '  ', 'abc', '1,234', '12,345', '1,2,3', '--5', '1e5', '99999999999', '12,5x'])(
    'rejects %j instead of guessing',
    (text) => {
      expect(parseLeiInput(text)).toBeUndefined();
    },
  );

  it('round-trips every storable amount through the editable text', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (bani) => {
        expect(parseLeiInput(formatLeiInput(bani))).toBe(bani);
      }),
    );
  });
});

describe('formatLeiInput', () => {
  it('uses a decimal comma without digit grouping', () => {
    expect(formatLeiInput(123456)).toBe('1234,56');
    expect(formatLeiInput(5)).toBe('0,05');
    expect(formatLeiInput(-5)).toBe('-0,05');
    expect(formatLeiInput(0)).toBe('0,00');
  });
});

describe('parseQtyInput', () => {
  it.each([
    ['2', 2],
    ['0,920', 0.92],
    ['0.92', 0.92],
    ['1,5', 1.5],
    ['1000000', 1_000_000],
  ])('reads %j as %d', (text, qty) => {
    expect(parseQtyInput(text)).toBe(qty);
  });

  it.each(['', '0', '0,0', '-1', '1,2345', 'x', '1000001', '1,'])('rejects %j', (text) => {
    expect(parseQtyInput(text)).toBeUndefined();
  });

  it('round-trips quantities with up to three decimals', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000_000 }), (milli) => {
        const qty = milli / 1000;
        expect(parseQtyInput(formatQtyInput(qty))).toBe(qty);
      }),
    );
  });
});

describe('parseEanInput', () => {
  it('accepts 4 to 14 digits and ignores spaces and dashes', () => {
    expect(parseEanInput('5941234567890')).toBe('5941234567890');
    expect(parseEanInput('594 1234-567890')).toBe('5941234567890');
    expect(parseEanInput('1234')).toBe('1234');
  });

  it('rejects anything else', () => {
    for (const text of ['', '123', 'abcd', '123456789012345']) {
      expect(parseEanInput(text)).toBeUndefined();
    }
  });
});
