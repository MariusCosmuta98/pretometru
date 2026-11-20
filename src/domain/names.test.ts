import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeName } from './names';

// Words, separators and sizes glued together at random. A plain character alphabet rarely lines up a
// word with two touching sizes (about 1 string in 1600), which is what once made the key unstable.
const sizeArb = fc
  .tuple(
    fc.constantFrom('1', '7', '25', '0.5', '1,5', '250'),
    fc.constantFrom('', ' '),
    fc.constantFrom('g', 'kg', 'gr', 'ml', 'cl', 'l', 'lt', 'm', 'buc', 'role', 'rol', 'L', 'ML'),
  )
  .map(([amount, gap, unit]) => amount + gap + unit);

const printedNameArb = fc
  .array(
    fc.oneof(
      { weight: 3, arbitrary: sizeArb },
      { weight: 2, arbitrary: fc.constantFrom('a', 'x', 'Ș', 'smantana', 'ZAH', 'IG') },
      { weight: 1, arbitrary: fc.constantFrom(' ', '-', '*', '/', '.', ',', '%', '\u0001') },
    ),
    { minLength: 1, maxLength: 6 },
  )
  .map((pieces) => pieces.join(''));

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

  it.each([
    ['a7m7m', 'a 7m 7m'],
    ['a1l5l', 'a 1l 5l'],
    ['a7m7m7m', 'a 7m 7m 7m'],
    ['VDR LAPTE1L2L', 'vdr lapte 1l 2l'],
    ['a7 gr7 lt', 'a 7g 7l'],
  ])('splits sizes that touch each other off the word before them: %j -> %j', (raw, key) => {
    expect(normalizeName(raw)).toBe(key);
    expect(normalizeName(key)).toBe(key);
  });

  it.each(['a7m7mx', 'a7m7', 'a7m7z'])(
    'leaves %j as it is: sizes are only split off a word when they end it',
    (raw) => {
      expect(normalizeName(raw)).toBe(raw);
    },
  );

  it('reads a control character as punctuation, never as the decimal mark used internally', () => {
    expect(normalizeName('A\u0001B')).toBe('a b');
    expect(normalizeName('1\u00015')).toBe('1 5');
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

  it('is idempotent on names made of words, separators and sizes', () => {
    fc.assert(
      fc.property(printedNameArb, (raw) => {
        const once = normalizeName(raw);
        expect(normalizeName(once)).toBe(once);
      }),
    );
  });
});
