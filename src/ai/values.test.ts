import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toBani, toChoice, toEan, toPurchasedAt, toQuantity, toText } from './values';

/** What a failing assertion says about the value it was given. */
const label = (value: unknown): string => `${typeof value} ${JSON.stringify(value)}`;

describe('toBani', () => {
  it('converts numbers and plain decimal strings exactly', () => {
    expect(toBani(17.89)).toBe(1789);
    expect(toBani(12.5)).toBe(1250);
    expect(toBani(0)).toBe(0);
    expect(toBani(-0.5)).toBe(-50);
    expect(toBani(1234567.89)).toBe(123456789);
    expect(toBani('12.50')).toBe(1250);
    expect(toBani(' 12.5 ')).toBe(1250);
    expect(toBani('12')).toBe(1200);
    expect(toBani('-0.00')).toBe(0);
  });

  it('refuses everything that is not exactly an amount with at most two decimals', () => {
    for (const bad of [
      '12,50',
      '1.234,56',
      '1e3',
      '0x10',
      '',
      ' ',
      'abc',
      '12.5 lei',
      '+12.50',
      '12.345',
      12.345,
      1e21,
      1e-7,
      NaN,
      Infinity,
      -Infinity,
      'Infinity',
      'NaN',
      true,
      null,
      undefined,
      {},
      [12.5],
    ]) {
      expect(toBani(bad), label(bad)).toBeUndefined();
    }
  });

  it('keeps to the bound of the contract (10,000,000 RON)', () => {
    expect(toBani('10000000.00')).toBe(1_000_000_000);
    expect(toBani('-10000000.00')).toBe(-1_000_000_000);
    expect(toBani('10000000.01')).toBeUndefined();
    expect(toBani(99_999_999_999)).toBeUndefined();
  });

  it('is the exact inverse of printing integer bani as lei', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (bani) => {
        expect(toBani(bani / 100)).toBe(bani);
        expect(toBani((bani / 100).toFixed(2))).toBe(bani);
      }),
    );
  });
});

describe('toQuantity', () => {
  it('accepts positive quantities with up to three decimals', () => {
    expect(toQuantity(2)).toBe(2);
    expect(toQuantity(0.92)).toBe(0.92);
    expect(toQuantity('0.920')).toBe(0.92);
    expect(toQuantity('1000000')).toBe(1_000_000);
  });

  it('refuses zero, negatives, too many decimals, commas and runaway values', () => {
    for (const bad of [
      0,
      -1,
      '0.000',
      1.2345,
      '2,000',
      'two',
      1_000_001,
      NaN,
      null,
      undefined,
      '1e2',
    ]) {
      expect(toQuantity(bad), label(bad)).toBeUndefined();
    }
  });
});

describe('toText', () => {
  it('collapses whitespace and turns control characters into spaces', () => {
    expect(toText('  LAPTE\tUHT\n1L  ', 50)).toBe('LAPTE UHT 1L');
    expect(toText('a\u0000b', 50)).toBe('a b');
  });

  it('removes zero-width and bidirectional marks, which could disguise a name', () => {
    expect(toText('PA\u200BINE', 50)).toBe('PAINE');
    expect(toText('\u202Eabc\u202C', 50)).toBe('abc');
  });

  it('normalises the composition of diacritics and cuts at a number of characters', () => {
    expect(toText('Pa\u0303ine', 50)).toBe('Pa\u0303ine'.normalize('NFC'));
    expect(toText('abcdef', 3)).toBe('abc');
    expect(toText('😀😀😀', 2)).toBe('😀😀');
  });

  it('answers undefined for anything that is not text or has no text', () => {
    for (const bad of [undefined, null, 12, {}, [], '', '   ', '\u200B']) {
      expect(toText(bad, 20), label(bad)).toBeUndefined();
    }
  });
});

describe('toChoice', () => {
  it('finds one of the allowed values, ignoring case and spaces around it', () => {
    expect(toChoice(' KG ', ['buc', 'kg', 'l'])).toBe('kg');
    expect(toChoice('Mega-Image', ['lidl', 'mega-image'])).toBe('mega-image');
  });

  it('refuses the rest', () => {
    expect(toChoice('bucati', ['buc', 'kg'])).toBeUndefined();
    expect(toChoice(3, ['buc'])).toBeUndefined();
    expect(toChoice('constructor', ['buc'])).toBeUndefined();
  });
});

describe('toPurchasedAt', () => {
  it('keeps a real date, with or without a time, and a future one', () => {
    expect(toPurchasedAt('2026-11-07')).toBe('2026-11-07');
    expect(toPurchasedAt('2026-11-07T18:31')).toBe('2026-11-07T18:31');
    expect(toPurchasedAt('2026-11-07 18:31:47')).toBe('2026-11-07T18:31:47');
    expect(toPurchasedAt('2026-12-29T17:12:30')).toBe('2026-12-29T17:12:30');
  });

  it('refuses a date that does not exist, another notation, a zone and an implausible year', () => {
    for (const bad of [
      '2026-02-30',
      '07.11.2026',
      '2026-11-07T18:31:47Z',
      '2026-11-07T25:00',
      '1999-01-01',
      '2101-01-01',
      '',
      20261107,
      null,
    ]) {
      expect(toPurchasedAt(bad), label(bad)).toBeUndefined();
    }
  });
});

describe('toEan', () => {
  it('says nothing for an absent value or a placeholder of zeros', () => {
    for (const none of [undefined, null, '', '  ', '-', '0'.repeat(13)]) {
      expect(toEan(none), label(none)).toEqual({ kind: 'none' });
    }
  });

  it('keeps a complete code whose check digit is right and strips the spaces', () => {
    expect(toEan('5948792073282')).toEqual({ kind: 'ean', ean: '5948792073282' });
    expect(toEan('594 8792 073282')).toEqual({ kind: 'ean', ean: '5948792073282' });
    expect(toEan('96385074')).toEqual({ kind: 'ean', ean: '96385074' });
  });

  it('keeps what is printed truncated: 12 digits (Mega Image) and short codes', () => {
    expect(toEan('401540000675')).toEqual({ kind: 'ean', ean: '401540000675' });
    expect(toEan('4011')).toEqual({ kind: 'ean', ean: '4011' });
  });

  it('rejects a complete code with a wrong check digit (a misread digit would map the wrong product)', () => {
    expect(toEan('5948792073283')).toEqual({ kind: 'rejected' });
    expect(toEan('96385075')).toEqual({ kind: 'rejected' });
  });

  it('rejects what cannot be a code', () => {
    for (const bad of ['12ab', '123', '1'.repeat(15), 'unknown', {}, [], true, 5.5]) {
      expect(toEan(bad), label(bad)).toEqual({ kind: 'rejected' });
    }
  });
});
