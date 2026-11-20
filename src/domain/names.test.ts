import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeName } from './names';

describe('normalizeName', () => {
  it.each([
    ['Smântână 30% 400G', 'smantana 30 400g'],
    ['LAPTE UHT 1,5% 1 L', 'lapte uht 1.5 1l'],
    ['Ștrudel cu mere și țelină', 'strudel cu mere si telina'],
    ['Şampon ţepi', 'sampon tepi'],
    ['S.C. LIDL / pâine-integrală', 's c lidl paine integrala'],
    ['  APA   PLATA\t0.5 L ', 'apa plata 0.5l'],
    ['CAFEA 250 GR', 'cafea 250g'],
    ['LAPTE 1 LT', 'lapte 1l'],
    ['HARTIE IGIENICA 8 ROL', 'hartie igienica 8role'],
    ['SERVETELE 120 BUC', 'servetele 120buc'],
    ['VDR SMANTANA400G', 'vdr smantana 400g'],
    ['ROSII DEPELATE425ML', 'rosii depelate 425ml'],
  ])('turns %j into the alias key %j', (raw, expected) => {
    expect(normalizeName(raw)).toBe(expected);
  });

  it('does not glue a number to a word that merely starts like a unit', () => {
    expect(normalizeName('COLA 2 LITRI')).toBe('cola 2 litri');
    expect(normalizeName('STRUGURI 2 GRAPE')).toBe('struguri 2 grape');
  });

  it('maps blank input to an empty key', () => {
    expect(normalizeName('   \t ')).toBe('');
  });

  it('is idempotent, so stored keys stay stable when re-normalised', () => {
    const alphabet = [...'aăâîșțĂÂÎȘȚşţ 0123456789,.%*xXgGrRlLkKmMbBuUcC-/+'];
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...alphabet), { maxLength: 40 }), (chars) => {
        const once = normalizeName(chars.join(''));
        expect(normalizeName(once)).toBe(once);
      }),
    );
  });
});
