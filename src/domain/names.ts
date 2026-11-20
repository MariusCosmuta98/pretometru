const DECIMAL_MARK = '\u0001';
const UNIT_SPELLINGS: Record<string, string> = { gr: 'g', lt: 'l', rol: 'role' };

/**
 * Canonical key used to match printed product names: lower case, no diacritics or punctuation,
 * single spaces, decimal point for decimals, and sizes glued to their unit (`1 L` -> `1l`,
 * `250 GR` -> `250g`). Aliases are stored under this key, so the algorithm must stay stable and
 * idempotent: changing it invalidates every stored alias.
 */
export function normalizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/(?<=\d)[.,](?=\d)/g, DECIMAL_MARK)
    .replace(new RegExp(`[^\\p{L}\\p{N}${DECIMAL_MARK}]+`, 'gu'), ' ')
    .replaceAll(DECIMAL_MARK, '.')
    .replace(
      /(\d+(?:\.\d+)?) ?(kg|gr|g|ml|cl|lt|l|buc|role|rol|m)(?![\p{L}\d])/gu,
      (_match, size: string, unit: string) => `${size}${UNIT_SPELLINGS[unit] ?? unit}`,
    )
    .replace(/\s+/g, ' ')
    .trim();
}
