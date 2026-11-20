const DECIMAL_MARK = '\u0001';
const UNIT_SPELLINGS: Record<string, string> = { gr: 'g', lt: 'l', rol: 'role' };
const UNITS = 'kg|gr|g|ml|cl|lt|l|buc|role|rol|m';
const NUMBER = String.raw`\d+(?:\.\d+)?`;

// A letter followed by one or more sizes (`SMANTANA400G`, `7M7M`), consumed as a run. The optional
// group captures, without consuming it, a letter or digit right behind the run: that means the run
// does not end its word and is left as it is.
const GLUED_SIZES = new RegExp(
  String.raw`(\p{L})((?:${NUMBER} ?(?:${UNITS}))+)(?=([\p{L}\d])?)`,
  'gu',
);
// Where one size of a run ends and the next begins.
const SIZE_BOUNDARY = /(?<=\p{L})(?=\d)/gu;
const SIZE = new RegExp(String.raw`(${NUMBER}) ?(${UNITS})(?![\p{L}\d])`, 'gu');

/**
 * Canonical key used to match printed product names: lower case, no diacritics or punctuation,
 * single spaces, decimal point for decimals, sizes split off the word before them and glued to
 * their unit (`SMANTANA400G` -> `smantana 400g`, `1 L` -> `1l`, `250 GR` -> `250g`). Aliases are
 * stored under this key, so the algorithm must stay stable and idempotent: changing it
 * invalidates every stored alias.
 */
export function normalizeName(raw: string): string {
  return (
    raw
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      // a U+0001 in the input must not pass for the decimal mark below
      .replaceAll(DECIMAL_MARK, ' ')
      .replace(/(?<=\d)[.,](?=\d)/g, DECIMAL_MARK)
      .replace(new RegExp(`[^\\p{L}\\p{N}${DECIMAL_MARK}]+`, 'gu'), ' ')
      .replaceAll(DECIMAL_MARK, '.')
      // Kaufland glues sizes to the last word: `SMANTANA400G` -> `SMANTANA 400G`. Sizes that touch
      // each other (`A7M7M`) come off together: splitting only the last would leave the others to
      // the next normalisation, and the key would change again.
      .replace(GLUED_SIZES, (run, letter: string, sizes: string, next: string | undefined) =>
        next === undefined ? `${letter} ${sizes.replace(SIZE_BOUNDARY, ' ')}` : run,
      )
      .replace(
        SIZE,
        (_match, size: string, unit: string) => `${size}${UNIT_SPELLINGS[unit] ?? unit}`,
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}
