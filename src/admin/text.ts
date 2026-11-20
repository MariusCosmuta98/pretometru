/** Names are typed by people: trim them and collapse every run of whitespace to one space. */
export function tidyName(name: string): string {
  return name.replace(/\s+/g, ' ').trim();
}

/** What two names are compared by: no case, no diacritics, one space. `Băuturi` equals `bauturi`. */
export function nameKey(name: string): string {
  return tidyName(name).normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('ro');
}

/** Romanian collation for lists of names (`Ș` after `S`, `Ț` after `T`). */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, 'ro');
}
