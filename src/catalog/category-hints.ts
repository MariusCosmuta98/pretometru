import { normalizeName, SEED_CATEGORIES } from '@/domain';

// Section headers printed on receipts (Kaufland) -> seed categories. Keywords are whole words or
// phrases in their normalised spelling (no diacritics, punctuation turned into spaces), so
// "Mopro/Brânză/Ouă" is read as `mopro branza oua`.
//
// Headers often list several departments ("Drogerie/Gospodărie/Hrană animale/Tabac"); the first
// one named decides. Generic qualifiers ("Alimente", "Nonfood") only count when the header
// names nothing more specific ("Alimente congelate" is Congelate).
type Rules = ReadonlyArray<readonly [category: string, keywords: readonly string[]]>;

const SPECIFIC: Rules = [
  ['Băuturi nealcoolice', ['nealcoolice', 'racoritoare', 'sucuri', 'apa', 'apa minerala']],
  ['Băuturi alcoolice', ['alcoolice', 'alcool', 'vin', 'vinuri', 'bere', 'spirtoase']],
  ['Lactate & ouă', ['mopro', 'lactate', 'lapte', 'branza', 'oua', 'iaurt']],
  ['Carne & mezeluri', ['carne', 'mezeluri', 'charcuterie', 'peste', 'pasare']],
  ['Fructe & legume', ['fructe', 'legume', 'zarzavaturi', 'verdeturi']],
  ['Panificație & cereale', ['panificatie', 'paine', 'patiserie', 'brutarie', 'cereale']],
  ['Snacks & dulciuri', ['dulciuri', 'snacks', 'snack', 'bomboane', 'ciocolata', 'cofetarie']],
  ['Congelate', ['congelate', 'surgelate', 'inghetata']],
  ['Curățenie & menaj', ['curatenie', 'menaj', 'detergenti', 'drogerie', 'gospodarie']],
  [
    'Igienă & cosmetice',
    ['igiena', 'cosmetice', 'ingrijire personala', 'parfumerie', 'frumusete', 'sanatate'],
  ],
  ['Bebe & copii', ['bebe', 'copii', 'baby']],
  [
    'Casă & bricolaj',
    ['bricolaj', 'casa', 'gradina', 'electrice', 'electrocasnice', 'scule', 'auto'],
  ],
  ['Animale', ['animale', 'pet']],
  ['Bacanie', ['bacanie', 'conserve']],
  ['Altele', ['altele', 'diverse']],
];

const GENERIC: Rules = [
  ['Bacanie', ['alimente']],
  ['Altele', ['nonfood', 'non food']],
];

function seedCategoryId(name: string): string {
  const category = SEED_CATEGORIES.find((candidate) => candidate.name === name);
  if (!category) throw new Error(`Unknown seed category "${name}"`);
  return category.id;
}

const compile = (rules: Rules) =>
  rules.flatMap(([name, keywords]) => {
    const categoryId = seedCategoryId(name);
    return keywords.map((keyword) => ({ categoryId, keyword: ` ${keyword} ` }));
  });

const SPECIFIC_KEYWORDS = compile(SPECIFIC);
const GENERIC_KEYWORDS = compile(GENERIC);

/** The category of the keyword named first in the header (the first rule wins a tie). */
function firstNamed(padded: string, keywords: ReturnType<typeof compile>): string | undefined {
  let best: { at: number; categoryId: string } | undefined;
  for (const { categoryId, keyword } of keywords) {
    const at = padded.indexOf(keyword);
    if (at !== -1 && (!best || at < best.at)) best = { at, categoryId };
  }
  return best?.categoryId;
}

/**
 * The seed category for a section header printed on a receipt, or `undefined` when the header is
 * not recognised or too broad ("Delicatese/Convenience/Marinade"): then the category stays open
 * instead of being guessed.
 */
export function categoryForHint(hint: string): string | undefined {
  const padded = ` ${normalizeName(hint)} `;
  return firstNamed(padded, SPECIFIC_KEYWORDS) ?? firstNamed(padded, GENERIC_KEYWORDS);
}
