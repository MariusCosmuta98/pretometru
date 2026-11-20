const rules = new Intl.PluralRules('ro');
const numbers = new Intl.NumberFormat('ro-RO');

/**
 * A count with its noun, in Romanian: `1 produs`, `2 produse`, `20 de produse`, `101 produse`. The
 * "de" follows twenty and up (CLDR's `other` category); `0` and `2`-`19` take the plain plural.
 */
export function plural(count: number, one: string, other: string): string {
  const category = rules.select(count);
  const shown = numbers.format(count);
  if (category === 'one') return `${shown} ${one}`;
  return category === 'other' ? `${shown} de ${other}` : `${shown} ${other}`;
}
