import { describe, expect, it } from 'vitest';
import { makeAlias, makeProduct } from '@/domain/testing';
import { createFuzzyMatcher, tokenize } from './fuzzy';

const cream = makeProduct({ name: 'Smântână 30%' });
const creamSku = makeProduct({ name: 'Smântână 30% 400g', brand: 'Napolact' });
const milk15 = makeProduct({ name: 'Lapte UHT 1,5% 1L' });
const milk35 = makeProduct({ name: 'Lapte UHT 3,5% 1L' });
const paper = makeProduct({ name: 'Hârtie igienică' });
const wipes = makeProduct({ name: 'Șervețele umede 120 buc' });
const feta = makeProduct({ name: 'Brânză telemea' });
const products = [cream, creamSku, milk15, milk35, paper, wipes, feta];

const matcher = createFuzzyMatcher(products, []);
const names = (rawName: string) => matcher.candidates(rawName).map((c) => c.product.name);

describe('createFuzzyMatcher', () => {
  it('suggests the product whose words the printed name contains, exact spelling first', () => {
    expect(names('SMANTANA 30% 400G')).toEqual(['Smântână 30%', 'Smântână 30% 400g']);
    expect(names('LAPTE UHT 1.5% 1L')[0]).toBe('Lapte UHT 1,5% 1L');
  });

  it('copes with truncated words and typos in the printed name', () => {
    // the line names the brand, so the branded product beats the generic one
    expect(names('SMANT NAPOLACT 30%')).toEqual(['Smântână 30% 400g', 'Smântână 30%']);
    expect(names('SMANTNA 30%')[0]).toBe('Smântână 30%');
    expect(names('H.IGIENICA 8ROLE')).toEqual(['Hârtie igienică']);
  });

  it('still offers a product with another percentage, but ranks it lower', () => {
    const found = matcher.candidates('LAPTE UHT 3.5% 1L');
    expect(found.map((c) => c.product.name)).toEqual(['Lapte UHT 3,5% 1L', 'Lapte UHT 1,5% 1L']);
    expect(found[0]!.score).toBeGreaterThan(found[1]!.score);
  });

  it('never scores 1: only an alias or an EAN match is certain', () => {
    const [best] = matcher.candidates('Smântână 30%');
    expect(best?.score).toBeLessThan(1);
    expect(best?.score).toBeGreaterThan(0.9);
  });

  it('suggests a product through the spelling another chain taught it', () => {
    const withAlias = createFuzzyMatcher(products, [
      makeAlias({ productId: wipes.id, normName: 'tissue fresh 72buc', chain: 'lidl' }),
    ]);
    expect(withAlias.candidates('TISSUE FRESH 72BUC')[0]?.product).toBe(wipes);
  });

  it('ignores aliases of products that are not in the catalog any more', () => {
    const orphan = createFuzzyMatcher(products, [
      makeAlias({ productId: makeProduct().id, normName: 'tissue fresh' }),
    ]);
    expect(orphan.candidates('TISSUE FRESH')).toEqual([]);
  });

  it('does not match on a shared number or size alone', () => {
    const odd = createFuzzyMatcher([makeProduct({ name: 'Ceva 30' })], []);
    expect(odd.candidates('ALTCEVA 30')).toEqual([]);
  });

  it('keeps short words exact, so "apa" does not turn into "paine"', () => {
    const small = createFuzzyMatcher([makeProduct({ name: 'Pâine' })], []);
    expect(small.candidates('APA 2L')).toEqual([]);
  });

  it('offers nothing for unrelated, empty or word-less names', () => {
    expect(names('CIOCOLATA MILKA')).toEqual([]);
    expect(names('')).toEqual([]);
    expect(names('1 L')).toEqual([]);
  });

  it('lists each product once, best first, and honours the limit', () => {
    const found = matcher.candidates('LAPTE UHT 1L', 1);
    expect(found).toHaveLength(1);
    const all = matcher.candidates('SMANTANA NAPOLACT 30% 400G');
    expect(new Set(all.map((c) => c.product.id)).size).toBe(all.length);
    expect(all.map((c) => c.score)).toEqual(all.map((c) => c.score).toSorted((a, b) => b - a));
  });
});

describe('tokenize', () => {
  it('keeps numbers and sizes, drops filler words, and lists each token once', () => {
    expect(tokenize('lapte de vaca 1.5 1l 1l x').map((t) => [t.text, t.kind])).toEqual([
      ['lapte', 'word'],
      ['vaca', 'word'],
      ['1.5', 'number'],
      ['1l', 'size'],
    ]);
  });
});
