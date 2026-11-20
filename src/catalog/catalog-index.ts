import type { Alias, Category, Chain, Product } from '@/domain';
import { listActive, type PretometruDB } from '@/storage';
import { joinKeys, normalizeEan } from './ean';
import { createFuzzyMatcher, type FuzzyMatcher } from './fuzzy';

/** Everything the matcher reads, loaded once per receipt (a household catalog is small). */
export interface CatalogSnapshot {
  products: Product[];
  aliases: Alias[];
  categories: Category[];
}

export function loadCatalog(db: PretometruDB): Promise<CatalogSnapshot> {
  return db.transaction('r', [db.products, db.aliases, db.categories], async () => ({
    products: await listActive(db.products),
    aliases: await listActive(db.aliases),
    categories: await listActive(db.categories),
  }));
}

export interface EanLookup {
  /** Distinct live products that carry the code, as a product or through an alias. */
  products: Product[];
  /** Size remembered by the alias rows of the code (they all describe the same article). */
  defaultPack?: Alias['defaultPack'];
}

export interface CatalogIndex {
  product(id: string): Product | undefined;
  hasCategory(id: string): boolean;
  /** The newest alias of a normalised printed name: the chain's own, else one valid for every chain. */
  aliasForName(chain: Chain, normName: string): Alias | undefined;
  lookupEan(ean: string): EanLookup;
  /** Likely products for a printed name, best first (built on first use). */
  candidates: FuzzyMatcher['candidates'];
}

const nameKey = (chain: Chain | undefined, normName: string) => `${chain ?? ''}\u0000${normName}`;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

const isNewer = (a: Alias, b: Alias) =>
  a.updatedAt > b.updatedAt || (a.updatedAt === b.updatedAt && a.id > b.id);

interface EanRows {
  aliases: Map<string, Alias[]>;
  products: Map<string, Product[]>;
}

const newEanRows = (): EanRows => ({ aliases: new Map(), products: new Map() });

/** Files a record under its code (no key for a code of zeros) and under the codes it joins. */
function addEan<T>(exact: Map<string, T[]>, joined: Map<string, T[]>, ean: string, value: T): void {
  const key = normalizeEan(ean);
  if (key !== '') push(exact, key, value);
  for (const joinKey of joinKeys(ean)) push(joined, joinKey, value);
}

function collectEan(
  rows: EanRows,
  key: string,
  productById: ReadonlyMap<string, Product>,
): EanLookup {
  const aliases = (rows.aliases.get(key) ?? []).toSorted((a, b) => (isNewer(a, b) ? -1 : 1));
  const found = new Map<string, Product>();
  for (const product of rows.products.get(key) ?? []) found.set(product.id, product);
  for (const alias of aliases) {
    const product = productById.get(alias.productId);
    if (product) found.set(product.id, product);
  }
  const defaultPack = aliases.find((alias) => alias.defaultPack !== undefined)?.defaultPack;
  return { products: [...found.values()], ...(defaultPack ? { defaultPack } : {}) };
}

/**
 * Lookup tables over a snapshot. Aliases whose product is gone are ignored, so deleting or merging
 * a product never leaves a dangling match. When two aliases claim the same name (two devices),
 * the newest wins.
 */
export function createCatalogIndex({
  products,
  aliases,
  categories,
}: CatalogSnapshot): CatalogIndex {
  const productById = new Map(products.map((product) => [product.id, product]));
  const categoryIds = new Set(categories.map((category) => category.id));

  const aliasByName = new Map<string, Alias>();
  const direct = newEanRows();
  const joined = newEanRows();
  for (const alias of aliases) {
    if (!productById.has(alias.productId)) continue;
    const key = nameKey(alias.chain, alias.normName);
    const current = aliasByName.get(key);
    if (!current || isNewer(alias, current)) aliasByName.set(key, alias);
    if (alias.ean !== undefined) addEan(direct.aliases, joined.aliases, alias.ean, alias);
  }
  for (const product of products) {
    if (product.ean !== undefined) addEan(direct.products, joined.products, product.ean, product);
  }

  let matcher: FuzzyMatcher | undefined;

  return {
    product: (id) => productById.get(id),
    hasCategory: (id) => categoryIds.has(id),
    // "unknown" is every shop nobody recognised, not one shop: a name remembered there says nothing
    // about another receipt, so only an alias that is valid for every chain may assign (the
    // product still comes up as a candidate through the fuzzy step).
    aliasForName: (chain, normName) =>
      (chain === 'unknown' ? undefined : aliasByName.get(nameKey(chain, normName))) ??
      aliasByName.get(nameKey(undefined, normName)),
    candidates: (rawName, limit) =>
      (matcher ??= createFuzzyMatcher(products, aliases)).candidates(rawName, limit),
    lookupEan(ean) {
      const key = normalizeEan(ean);
      if (key === '') return { products: [] };
      // An exact print wins; the other spelling of a code (12 digits without the check digit
      // against 13) is consulted only when nothing carries this exact one.
      const exact = collectEan(direct, key, productById);
      return exact.products.length > 0 ? exact : collectEan(joined, key, productById);
    },
  };
}
