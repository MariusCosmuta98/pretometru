import { normalizeName, SEED_CATEGORIES } from '@/domain';

// Section headers printed on receipts (Kaufland) -> seed categories. Keywords are whole words or
// phrases in their normalised spelling (no diacritics, punctuation turned into spaces), so
// "Mopro/Brânză/Ouă" is matched as `mopro`, `branza` and `oua`. The order resolves headers that
// match several rules ("Alimente congelate"): the more specific category comes first.
const RULES: ReadonlyArray<readonly [category: string, keywords: readonly string[]]> = [
  ['Băuturi nealcoolice', ['nealcoolice', 'racoritoare', 'sucuri', 'apa', 'apa minerala']],
  ['Băuturi alcoolice', ['alcoolice', 'alcool', 'vin', 'vinuri', 'bere', 'spirtoase']],
  ['Lactate & ouă', ['mopro', 'lactate', 'lapte', 'branza', 'oua', 'iaurt']],
  ['Carne & mezeluri', ['carne', 'mezeluri', 'charcuterie', 'peste', 'pasare']],
  ['Fructe & legume', ['fructe', 'legume', 'zarzavaturi', 'verdeturi']],
  ['Panificație & cereale', ['panificatie', 'paine', 'patiserie', 'brutarie', 'cereale']],
  ['Snacks & dulciuri', ['dulciuri', 'snacks', 'snack', 'bomboane', 'ciocolata', 'cofetarie']],
  ['Congelate', ['congelate', 'surgelate', 'inghetata']],
  ['Curățenie & menaj', ['curatenie', 'menaj', 'detergenti']],
  ['Igienă & cosmetice', ['igiena', 'cosmetice', 'ingrijire personala', 'parfumerie']],
  ['Bebe & copii', ['bebe', 'copii', 'baby']],
  [
    'Casă & bricolaj',
    [
      'bricolaj',
      'casa',
      'gradina',
      'non food',
      'nonfood',
      'textile',
      'electrice',
      'electrocasnice',
      'scule',
      'auto',
    ],
  ],
  ['Animale', ['animale', 'pet']],
  ['Bacanie', ['bacanie', 'alimente', 'conserve']],
  ['Altele', ['altele', 'diverse']],
];

function seedCategoryId(name: string): string {
  const category = SEED_CATEGORIES.find((candidate) => candidate.name === name);
  if (!category) throw new Error(`Unknown seed category "${name}"`);
  return category.id;
}

const COMPILED_RULES = RULES.map(([name, keywords]) => ({
  categoryId: seedCategoryId(name),
  keywords: keywords.map((keyword) => ` ${keyword} `),
}));

/**
 * The seed category for a section header printed on a receipt, or `undefined` when the header is
 * not recognised (then the category stays open instead of being guessed).
 */
export function categoryForHint(hint: string): string | undefined {
  const padded = ` ${normalizeName(hint)} `;
  return COMPILED_RULES.find((rule) => rule.keywords.some((keyword) => padded.includes(keyword)))
    ?.categoryId;
}
