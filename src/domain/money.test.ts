import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  formatBani,
  formatLei,
  formatMilliBani,
  grossFromNet,
  isBani,
  mulDiv,
  netFromGross,
  parseBani,
  roundDiv,
  sumBani,
  vatFromGross,
} from './money';

describe('parseBani', () => {
  it.each([
    ['22,99', 2299],
    ['0,05', 5],
    ['0,00', 0],
    ['1.234,56', 123456],
    ['12.345,67', 1234567],
    ['1 234,56', 123456],
    ['1\u00a0234,56', 123456],
    ['22.99', 2299],
    ['  7,50 ', 750],
    ['-20,00', -2000],
    ['\u22125,00', -500],
    ['2,49-', -249],
  ])('reads %j as %i bani', (text, bani) => {
    expect(parseBani(text)).toBe(bani);
  });

  it('never returns negative zero', () => {
    expect(parseBani('-0,00')).toBe(0);
  });

  it.each([
    ['empty', ''],
    ['not a number', 'abc'],
    ['no decimals (OCR may have dropped them)', '22'],
    ['one decimal', '22,9'],
    ['three decimals (a weight, not money)', '0,920'],
    ['grouping without decimals', '1.234'],
    ['double sign', '--5,00'],
    ['leading and trailing sign', '-5,00-'],
    ['trailing currency', '5,00 lei'],
    ['two separators', '1,2,3'],
  ])('rejects %s', (_label, text) => {
    expect(parseBani(text)).toBeUndefined();
  });

  it('round-trips with formatBani for any amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000_000, max: 1_000_000_000_000 }), (bani) => {
        expect(parseBani(formatBani(bani))).toBe(bani);
      }),
    );
  });
});

describe('formatBani / formatLei', () => {
  it.each([
    [2299, '22,99'],
    [5, '0,05'],
    [0, '0,00'],
    [-0, '0,00'],
    [123456, '1.234,56'],
    [100_000_000, '1.000.000,00'],
    [-250, '-2,50'],
  ])('formats %i bani as %j', (bani, text) => {
    expect(formatBani(bani)).toBe(text);
  });

  it('appends the currency in formatLei', () => {
    expect(formatLei(2299)).toBe('22,99 lei');
  });

  it('refuses fractional bani instead of printing a wrong price', () => {
    expect(() => formatBani(12.5)).toThrow(RangeError);
  });
});

describe('formatMilliBani', () => {
  it.each([
    [3317, 2, '0,03'],
    [3317, 3, '0,033'],
    [3317, 5, '0,03317'],
    [2_499_000, 2, '24,99'],
    [-130_000, 2, '-1,30'],
  ])('formats %i milli-bani with %i decimals as %j', (milli, decimals, text) => {
    expect(formatMilliBani(milli, decimals)).toBe(text);
  });
});

describe('mulDiv / roundDiv', () => {
  it.each([
    [398, 1000, 120, 3317],
    [5, 1, 2, 3],
    [-5, 1, 2, -3],
    [5, 1, -2, -3],
    [7, 1, 2, 4],
    [1, 1, 3, 0],
    [2, 1, 3, 1],
  ])('mulDiv(%i, %i, %i) = %i (half away from zero)', (a, b, c, expected) => {
    expect(mulDiv(a, b, c)).toBe(expected);
  });

  it('roundDiv divides and rounds half away from zero', () => {
    expect(roundDiv(2299, 2)).toBe(1150);
    expect(roundDiv(-2299, 2)).toBe(-1150);
  });

  it('rejects a zero divisor and results beyond safe integers', () => {
    expect(() => mulDiv(1, 1, 0)).toThrow(RangeError);
    expect(() => mulDiv(9_000_000_000_000, 1_000_000, 3)).toThrow(RangeError);
  });

  it('is within half a unit of the exact quotient (BigInt oracle)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }).filter((c) => c !== 0),
        (a, b, c) => {
          const exactTimesC = BigInt(a) * BigInt(b);
          const diff = BigInt(mulDiv(a, b, c)) * BigInt(c) - exactTimesC;
          const absDiff = diff < 0n ? -diff : diff;
          const absC = BigInt(Math.abs(c));
          expect(absDiff * 2n <= absC).toBe(true);
        },
      ),
    );
  });
});

describe('sumBani / isBani', () => {
  it('adds integer amounts', () => {
    expect(sumBani([100, 250, -50])).toBe(300);
    expect(sumBani([])).toBe(0);
  });

  it('refuses fractional amounts', () => {
    expect(() => sumBani([0.1, 0.2])).toThrow(RangeError);
  });

  it('recognises only safe integers as bani', () => {
    expect(isBani(2299)).toBe(true);
    expect(isBani(22.99)).toBe(false);
    expect(isBani(Number.NaN)).toBe(false);
    expect(isBani('2299')).toBe(false);
  });
});

describe('VAT conversions', () => {
  it('splits a gross amount into net and VAT', () => {
    expect(netFromGross(12100, 21)).toBe(10000);
    expect(vatFromGross(12100, 21)).toBe(2100);
    expect(netFromGross(2299, 21)).toBe(1900);
    expect(netFromGross(1000, 21)).toBe(826);
  });

  it('converts an ex-VAT METRO discount (2,49) to VAT-inclusive bani', () => {
    expect(grossFromNet(249, 21)).toBe(301);
    expect(grossFromNet(1000, 11)).toBe(1110);
  });

  it('leaves amounts untouched at 0% VAT', () => {
    expect(netFromGross(500, 0)).toBe(500);
    expect(grossFromNet(500, 0)).toBe(500);
  });

  it('net -> gross -> net never drifts by more than one ban', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.constantFrom(0, 5, 9, 11, 19, 21),
        (gross, rate) => {
          expect(
            Math.abs(grossFromNet(netFromGross(gross, rate), rate) - gross),
          ).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});
