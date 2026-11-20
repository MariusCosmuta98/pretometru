import { describe, expect, it } from 'vitest';
import { findPurchasedAt } from './dates';

const at = (...texts: string[]) => findPurchasedAt(texts.map((text) => ({ text })));

describe('findPurchasedAt', () => {
  it.each([
    ['DATA:29/12/2026 ORA:17-12-30', '2026-12-29T17:12:30'],
    ['DATA:29/12/2026 0RA:17-12-38', '2026-12-29T17:12:38'],
    ['DATA 03.11.26 ORA 16:57:08', '2026-11-03T16:57:08'],
    ['DAT? 03.11.26 ORA 16:57:08', '2026-11-03T16:57:08'],
    ['Data: 7-3-2026 Ora: 9:05', '2026-03-07T09:05'],
    ['03.11.26', '2026-11-03'],
  ])('reads %j as %s', (text, expected) => {
    expect(at(text)).toBe(expected);
  });

  it('accepts letters that OCR reads in place of digits', () => {
    expect(at('DATA O3.l1.26 ORA 16:57:08')).toBe('2026-11-03T16:57:08');
  });

  it('is not fooled by amounts, codes and other numbers', () => {
    expect(at('TVA B 11,80% 2,73', '0000 000000/00', 'Casa:12', '5941234567890')).toBeUndefined();
  });

  it('only accepts real calendar dates and clock times', () => {
    expect(at('DATA 31.02.26 ORA 10:00')).toBeUndefined();
    expect(at('DATA 03.11.26 ORA 25:61')).toBe('2026-11-03');
  });

  it('prefers a date with a time over an earlier bare date (a card expiry, a promotion)', () => {
    expect(at('Valabil pana la 31.12.27', 'DATA 03.11.26 ORA 16:57:08')).toBe(
      '2026-11-03T16:57:08',
    );
    expect(at('Oferta pana la 31.12.26')).toBe('2026-12-31');
  });
});
