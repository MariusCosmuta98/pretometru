import { describe, expect, it } from 'vitest';
import { fixtures, normalizeForGolden, sourceOf } from '@fixtures';
import { parseReceipt } from './parse-receipt';
import { parsers } from './registry';

// Every fixture with a PDF text source whose chain has a parser must parse to its ground truth:
// the same lines, totals and VAT table, and exactly the warnings it declares (none for the real
// receipts: the 1 ban rounding gap of the METRO invoice is inside the tolerance).
const cases = fixtures.filter(
  (fixture) =>
    fixture.sources.some((source) => source.kind === 'pdf-text') &&
    parsers.some((parser) => parser.id === fixture.expected.chain),
);

describe('golden PDF fixtures', () => {
  it('cover Kaufland and METRO', () => {
    expect(cases.map((fixture) => fixture.expected.chain)).toEqual(
      expect.arrayContaining(['kaufland', 'metro']),
    );
  });

  it.each(cases.map((fixture) => [fixture.id, fixture] as const))(
    '%s is read by the parser of its chain and matches the ground truth',
    (_id, fixture) => {
      const { source, expected } = sourceOf(fixture, 'pdf-text');
      const receipt = parseReceipt(source, { now: new Date(fixture.now) });
      expect(receipt.meta.parser).toBe(expected.chain);
      expect(receipt.meta.engine).toBe('pdfjs');
      expect(normalizeForGolden(receipt)).toEqual(normalizeForGolden(expected));
    },
  );
});
