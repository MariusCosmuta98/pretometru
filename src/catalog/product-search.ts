import { normalizeName, type Product } from '@/domain';
import { normalizeEan } from './ean';

const EAN_QUERY = /^\d{4,14}$/;

const byName = (a: Product, b: Product) => a.name.localeCompare(b.name, 'ro');

/** What a user searches on: brand and name, normalised like the alias keys. */
export const searchText = (product: Product) =>
  normalizeName(product.brand ? `${product.brand} ${product.name}` : product.name);

/**
 * Type-ahead ranking: an EAN prefix first, then the name as typed, a name that starts with the
 * query, words that start with every query word, and finally words that merely contain it.
 * Diacritics, case and punctuation never matter. An empty query lists everything by name.
 */
export function rankProducts(products: readonly Product[], query: string): Product[] {
  const normalized = normalizeName(query);
  if (normalized === '') return products.toSorted(byName);

  const tokens = normalized.split(' ');
  const digits = EAN_QUERY.test(query.trim()) ? normalizeEan(query.trim()) : undefined;

  const ranked: Array<{ product: Product; tier: number }> = [];
  for (const product of products) {
    const name = normalizeName(product.name);
    const text = searchText(product);
    const words = text.split(' ');

    let tier: number | undefined;
    if (digits !== undefined && product.ean !== undefined) {
      if (normalizeEan(product.ean).startsWith(digits)) tier = 0;
    }
    if (tier === undefined) {
      if (name === normalized) tier = 1;
      else if (name.startsWith(normalized) || text.startsWith(normalized)) tier = 2;
      else if (tokens.every((token) => words.some((word) => word.startsWith(token)))) tier = 3;
      else if (tokens.every((token) => text.includes(token))) tier = 4;
    }
    if (tier !== undefined) ranked.push({ product, tier });
  }

  return ranked
    .sort(
      (a, b) =>
        a.tier - b.tier ||
        a.product.name.length - b.product.name.length ||
        byName(a.product, b.product),
    )
    .map(({ product }) => product);
}
