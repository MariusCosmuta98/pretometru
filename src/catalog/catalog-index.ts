import type { Alias, Category, Chain, Product } from '@/domain';
import { listActive, type PretometruDB } from '@/storage';
import { normalizeEan } from './ean';
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
  const aliasesByEan = new Map<string, Alias[]>();
  for (const alias of aliases) {
    if (!productById.has(alias.productId)) continue;
    const key = nameKey(alias.chain, alias.normName);
    const current = aliasByName.get(key);
    if (!current || isNewer(alias, current)) aliasByName.set(key, alias);
    if (alias.ean !== undefined) push(aliasesByEan, normalizeEan(alias.ean), alias);
  }

  const productsByEan = new Map<string, Product[]>();
  for (const product of products) {
    if (product.ean !== undefined) push(productsByEan, normalizeEan(product.ean), product);
  }

  let matcher: FuzzyMatcher | undefined;

  return {
    product: (id) => productById.get(id),
    hasCategory: (id) => categoryIds.has(id),
    aliasForName: (chain, normName) =>
      aliasByName.get(nameKey(chain, normName)) ?? aliasByName.get(nameKey(undefined, normName)),
    candidates: (rawName, limit) =>
      (matcher ??= createFuzzyMatcher(products, aliases)).candidates(rawName, limit),
    lookupEan(ean) {
      const key = normalizeEan(ean);
      const rows = (aliasesByEan.get(key) ?? []).toSorted((a, b) => (isNewer(a, b) ? -1 : 1));
      const found = new Map<string, Product>();
      for (const product of productsByEan.get(key) ?? []) found.set(product.id, product);
      for (const alias of rows) {
        const product = productById.get(alias.productId);
        if (product) found.set(product.id, product);
      }
      const defaultPack = rows.find((alias) => alias.defaultPack !== undefined)?.defaultPack;
      return { products: [...found.values()], ...(defaultPack ? { defaultPack } : {}) };
    },
  };
}
