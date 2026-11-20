import { describe, expect, it } from 'vitest';
import { readVatRate } from './vat-rate';

describe('readVatRate', () => {
  it.each([
    ['21,00', 21],
    ['11.00', 11],
    ['9,00', 9],
    ['5', 5],
    ['0,00%', 0],
    ['19,00', 19],
  ])('reads a printed rate %j as %d%%, not repaired', (text, rate) => {
    expect(readVatRate(text)).toEqual({ rate, repaired: false });
  });

  it('repairs a misread digit when it leads to exactly one real rate: 11,80 is 11,00 (8 and 0 are confused)', () => {
    expect(readVatRate('11,80')).toEqual({ rate: 11, repaired: true });
    expect(readVatRate('27,00')).toEqual({ rate: 21, repaired: true });
    expect(readVatRate('2l,00')).toEqual({ rate: 21, repaired: false });
  });

  it('does not invent a rate that no confusable digit leads to', () => {
    expect(readVatRate('12,00')).toBeUndefined();
    expect(readVatRate('abc')).toBeUndefined();
    expect(readVatRate('')).toBeUndefined();
    expect(readVatRate('123,00')).toBeUndefined();
  });

  describe('when two real rates are equally close (6,00 is 5 or 9)', () => {
    it('is undecided without evidence', () => {
      expect(readVatRate('6,00')).toBeUndefined();
    });

    it('is decided by the printed VAT amount over the gross of the class', () => {
      const nine = { grossBani: 10_900, vatBani: 900 };
      const five = { grossBani: 10_500, vatBani: 500 };

      expect(readVatRate('6,00', nine)).toEqual({ rate: 9, repaired: true });
      expect(readVatRate('6,00', five)).toEqual({ rate: 5, repaired: true });
    });

    it('is decided by the usual rate of the class when the amounts do not tell', () => {
      expect(readVatRate('6,00', { classRate: 9 })).toEqual({ rate: 9, repaired: true });
    });
  });

  it('refuses a correction that the printed VAT amount contradicts', () => {
    // 11,80 -> 11 would give 2,73 on 27,59 lei; 5,00 lei of VAT says something else is going on.
    expect(readVatRate('11,80', { grossBani: 2759, vatBani: 273 })).toEqual({
      rate: 11,
      repaired: true,
    });
    expect(readVatRate('11,80', { grossBani: 2759, vatBani: 500 })).toBeUndefined();
  });
});
