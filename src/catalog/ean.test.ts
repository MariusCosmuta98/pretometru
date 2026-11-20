import { describe, expect, it } from 'vitest';
import { checkDigit, isIdentifyingEan, joinKeys, normalizeEan } from './ean';

describe('normalizeEan', () => {
  it('drops leading zeros so UPC-A and EAN-13 spellings of one code are equal', () => {
    expect(normalizeEan('0012345678905')).toBe('12345678905');
    expect(normalizeEan('012345678905')).toBe('12345678905');
    expect(normalizeEan('0000')).toBe('');
  });
});

describe('isIdentifyingEan', () => {
  it('trusts codes of 8 digits and more, not truncated prints or PLUs', () => {
    expect(isIdentifyingEan('5941234567890')).toBe(true);
    expect(isIdentifyingEan('96385074')).toBe(true); // EAN-8
    expect(isIdentifyingEan('594906503482')).toBe(true); // 12 digits: the check digit is missing
    expect(isIdentifyingEan('4011')).toBe(false); // PLU of a weighed line
    expect(isIdentifyingEan('594123')).toBe(false);
  });

  it('never trusts a placeholder of zeros', () => {
    expect(isIdentifyingEan('0000000000000')).toBe(false);
    expect(isIdentifyingEan('0000000000017')).toBe(false);
  });
});

describe('checkDigit', () => {
  it('is the GS1 digit: EAN-13, EAN-8 and the 12-digit prints of the fixtures', () => {
    expect(checkDigit('594906503482')).toBe(5); // 5949065034825
    expect(checkDigit('400638133393')).toBe(1); // 4006381333931
    expect(checkDigit('9638507')).toBe(4); // 96385074
    expect(checkDigit('629104150021')).toBe(3); // 6291041500213, the GS1 documentation example
  });
});

describe('joinKeys', () => {
  it('joins a 12-digit print with the EAN-13 that completes it, and a valid EAN-13 with its prefix', () => {
    expect(joinKeys('594906503482')).toEqual(['5949065034825']);
    expect(joinKeys('5949065034825')).toEqual(['594906503482']);
  });

  it('does not join a 13-digit code whose check digit is wrong (a misread, not an article)', () => {
    expect(joinKeys('5949065034821')).toEqual([]);
  });

  it('has nothing for other lengths', () => {
    expect(joinKeys('96385074')).toEqual([]);
    expect(joinKeys('4011')).toEqual([]);
  });
});
