import {
  NON_PRODUCT_CATEGORY_ID,
  normalizeName,
  type Chain,
  type ParsedLine,
  type ParsedReceipt,
  type Product,
} from '@/domain';
import type { PretometruDB } from '@/storage';
import { categoryForHint } from './category-hints';
import { createCatalogIndex, loadCatalog, type CatalogIndex } from './catalog-index';
import { isIdentifyingEan } from './ean';
import { clonePack } from './packs';
import type { LineMapping, MappingCandidate, PackChoice } from './types';

/** An EAN that is truncated or claimed by several products: a strong hint, but a human decides. */
const AMBIGUOUS_EAN_SCORE = 0.9;

/** The alias size fills in only what the printed name left out, and only for sold units (`buc`). */
function completingPack(line: ParsedLine, defaultPack: PackChoice | undefined) {
  return line.pack === undefined && line.qtyUnit === 'buc' && defaultPack
    ? clonePack(defaultPack)
    : undefined;
}

function assigned(
  via: 'alias' | 'ean',
  product: Product,
  pack: PackChoice | undefined,
  index: CatalogIndex,
): LineMapping {
  return {
    productId: product.id,
    ...(index.hasCategory(product.categoryId) ? { categoryId: product.categoryId } : {}),
    ...(pack ? { pack } : {}),
    via,
    candidates: [{ product, score: 1 }],
  };
}

function mapLine(line: ParsedLine, chain: Chain, index: CatalogIndex): LineMapping {
  if (line.kind !== 'product') {
    return { categoryId: NON_PRODUCT_CATEGORY_ID, via: 'none', candidates: [] };
  }

  const normName = normalizeName(line.rawName);
  const alias = normName === '' ? undefined : index.aliasForName(chain, normName);
  const aliased = alias && index.product(alias.productId);
  if (aliased) return assigned('alias', aliased, completingPack(line, alias.defaultPack), index);

  let candidates: MappingCandidate[] = [];
  if (line.ean !== undefined) {
    const { products, defaultPack } = index.lookupEan(line.ean);
    const [only] = products;
    if (only && products.length === 1 && isIdentifyingEan(line.ean)) {
      return assigned('ean', only, completingPack(line, defaultPack), index);
    }
    candidates = products.map((product) => ({ product, score: AMBIGUOUS_EAN_SCORE }));
  }

  const hinted = line.storeCategoryHint ? categoryForHint(line.storeCategoryHint) : undefined;
  const categoryId = hinted !== undefined && index.hasCategory(hinted) ? hinted : undefined;
  const via = candidates.length > 0 ? 'fuzzy' : categoryId !== undefined ? 'category-hint' : 'none';
  return { ...(categoryId !== undefined ? { categoryId } : {}), via, candidates };
}

/** One mapping per receipt line, in the same order. Pure: the catalog comes in as an index. */
export function mapReceiptLines(receipt: ParsedReceipt, index: CatalogIndex): LineMapping[] {
  return receipt.lines.map((line) => mapLine(line, receipt.chain, index));
}

/**
 * Matches the lines of a parsed receipt against the catalog: remembered alias (chain + printed
 * name), then EAN, then likely products as candidates, then the section header's category. Only an
 * alias or an EAN match assigns a product; everything else is for a human to confirm, because a
 * wrong silent merge is worse than a missing one.
 */
export async function suggestMappings(
  db: PretometruDB,
  receipt: ParsedReceipt,
): Promise<LineMapping[]> {
  if (receipt.lines.length === 0) return [];
  return mapReceiptLines(receipt, createCatalogIndex(await loadCatalog(db)));
}
