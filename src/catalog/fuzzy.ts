import Fuse from 'fuse.js';
import { normalizeName, type Alias, type Product } from '@/domain';
import type { MappingCandidate } from './types';

type TokenKind = 'word' | 'number' | 'size';

interface Token {
  text: string;
  kind: TokenKind;
  weight: number;
}

/** One way a product is written: its name (with brand), or a name remembered by an alias. */
interface Spelling {
  product: Product;
  tokens: Token[];
  weight: number;
}

const SIZE = /^\d+(?:\.\d+)?(?:kg|g|ml|l|buc|role|m)$/;
const NUMBER = /^\d+(?:\.\d+)?$/;

/** Below this a product is not worth showing. */
const MIN_SCORE = 0.4;
/** 1 is reserved for matches that are assigned (alias, EAN); a name that merely looks alike is not that. */
const MAX_SCORE = 0.95;
const MAX_CANDIDATES = 5;

/**
 * Words are compared fuzzily, numbers and sizes exactly: "1,5%" and "3,5%" are different milks,
 * and a size only confirms a match (it may be missing from the other spelling).
 */
export function tokenize(normalized: string): Token[] {
  const seen = new Set<string>();
  const tokens: Token[] = [];
  for (const text of normalized.split(' ')) {
    if (text === '' || seen.has(text)) continue;
    const kind: TokenKind = SIZE.test(text) ? 'size' : NUMBER.test(text) ? 'number' : 'word';
    if (kind === 'word' && text.length < 3) continue; // "de", "cu", "x"
    seen.add(text);
    tokens.push({ text, kind, weight: kind === 'size' ? 0.5 : 1 });
  }
  return tokens;
}

/** How wrong a Fuse match may be (0 = identical): short words must be exact or a prefix. */
function maxFuseScore(length: number): number | undefined {
  if (length <= 3) return undefined;
  return length <= 5 ? 0.01 : 0.2;
}

export interface FuzzyMatcher {
  /** Products whose name or alias spelling resembles `rawName`, best first. */
  candidates(rawName: string, limit?: number): MappingCandidate[];
}

/**
 * Fuzzy product lookup for a printed receipt name. The receipt's words are looked up (typos and
 * truncated words such as "SMANT" for "smântână" included) in an fuse.js index of the words used by
 * the catalog; every spelling of a product (its name and the aliases pointing at it) is then scored
 * on how much of the spelling the line contains and how much of the line the spelling explains.
 * The result only ever *suggests*: a human confirms before anything is assigned.
 */
export function createFuzzyMatcher(
  products: readonly Product[],
  aliases: readonly Alias[],
): FuzzyMatcher {
  const productById = new Map(products.map((product) => [product.id, product]));

  const spellings: Spelling[] = [];
  const addSpelling = (product: Product, normalized: string) => {
    const tokens = tokenize(normalized);
    if (tokens.length === 0) return;
    spellings.push({ product, tokens, weight: tokens.reduce((sum, t) => sum + t.weight, 0) });
  };
  for (const product of products) {
    addSpelling(
      product,
      normalizeName(product.brand ? `${product.brand} ${product.name}` : product.name),
    );
  }
  for (const alias of aliases) {
    const product = productById.get(alias.productId);
    if (product) addSpelling(product, alias.normName);
  }

  const spellingsByToken = new Map<string, number[]>();
  spellings.forEach((spelling, index) => {
    for (const { text } of spelling.tokens) {
      const list = spellingsByToken.get(text);
      if (list) list.push(index);
      else spellingsByToken.set(text, [index]);
    }
  });
  const words = [...spellingsByToken.keys()].filter(
    (text) => !SIZE.test(text) && !NUMBER.test(text),
  );
  const fuse = new Fuse(
    words.map((text) => ({ text })),
    {
      keys: ['text'],
      includeScore: true,
      threshold: 0.2,
      location: 0,
      distance: 4,
      minMatchCharLength: 3,
    },
  );

  /** Vocabulary tokens a query token stands for, with how well (0..1). */
  function similar(token: Token): Map<string, number> {
    const found = new Map<string, number>();
    if (spellingsByToken.has(token.text)) found.set(token.text, 1);
    const limit = token.kind === 'word' ? maxFuseScore(token.text.length) : undefined;
    if (limit === undefined) return found;
    for (const { item, score = 1 } of fuse.search(token.text)) {
      if (score <= limit && !found.has(item.text)) found.set(item.text, Math.min(0.9, 1 - score));
    }
    return found;
  }

  return {
    candidates(rawName, limit = MAX_CANDIDATES) {
      const query = tokenize(normalizeName(rawName));
      if (query.length === 0) return [];
      const queryWeight = query.reduce((sum, token) => sum + token.weight, 0);
      const similarity = query.map(similar);

      const touched = new Set<number>();
      for (const hits of similarity) {
        for (const text of hits.keys()) {
          for (const index of spellingsByToken.get(text) ?? []) touched.add(index);
        }
      }

      const best = new Map<string, MappingCandidate>();
      for (const index of touched) {
        const spelling = spellings[index];
        if (!spelling) continue;

        let spellingCovered = 0;
        let wordMatched = false;
        for (const token of spelling.tokens) {
          const sim = Math.max(0, ...similarity.map((hits) => hits.get(token.text) ?? 0));
          spellingCovered += sim * token.weight;
          if (token.kind === 'word' && sim > 0) wordMatched = true;
        }
        if (!wordMatched) continue; // a shared number or size alone says nothing

        let queryCovered = 0;
        query.forEach((token, i) => {
          const hits = similarity[i];
          const sim = Math.max(0, ...spelling.tokens.map((t) => hits?.get(t.text) ?? 0));
          queryCovered += sim * token.weight;
        });

        const recall = spellingCovered / spelling.weight;
        const precision = queryCovered / queryWeight;
        if (recall + precision === 0) continue;
        const score = Math.min(MAX_SCORE, (2 * recall * precision) / (recall + precision));
        const known = best.get(spelling.product.id);
        if (score >= MIN_SCORE && (!known || score > known.score)) {
          best.set(spelling.product.id, { product: spelling.product, score });
        }
      }

      return [...best.values()]
        .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'ro'))
        .slice(0, limit)
        .map(({ product, score }) => ({ product, score: Math.round(score * 100) / 100 }));
    },
  };
}
