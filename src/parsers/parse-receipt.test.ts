import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ReceiptParser, type ReceiptSource } from '@/domain';
import { parseReceipt, parseReceiptWith } from './parse-receipt';
import { parsers, rankParsers, validateParsers } from './registry';
import { makeParsedLine, makeParsedReceipt } from './testing';

const NOW = new Date('2026-11-20T12:00:00Z');
const SOURCE: ReceiptSource = { kind: 'pasted-text', text: 'TOTAL 5,99' };

function fakeParser(
  id: string,
  score: number,
  parse: ReceiptParser['parse'] = () => makeParsedReceipt({ meta: meta(id) }),
): ReceiptParser {
  return { id, version: '1.0.0', detect: () => score, parse };
}

const meta = (parser: string) => ({
  engine: 'paste' as const,
  parser,
  parserVersion: '1.0.0',
  warnings: [],
});

describe('rankParsers', () => {
  it('orders by score, keeps registry order on ties and drops parsers that answer 0', () => {
    const ranked = rankParsers(SOURCE, [
      fakeParser('low', 0.1),
      fakeParser('none', 0),
      fakeParser('first', 0.9),
      fakeParser('second', 0.9),
    ]);
    expect(ranked.map((entry) => entry.parser.id)).toEqual(['first', 'second', 'low']);
  });

  it('treats a throwing or nonsensical detect as "not mine"', () => {
    const broken = fakeParser('throws', 1);
    broken.detect = () => {
      throw new Error('boom');
    };
    const nan = fakeParser('nan', NaN);
    expect(
      rankParsers(SOURCE, [broken, nan, fakeParser('ok', 0.5)]).map((r) => r.parser.id),
    ).toEqual(['ok']);
  });
});

describe('parseReceiptWith', () => {
  it('parses with the best parser and appends the validation warnings', () => {
    const receipt = parseReceiptWith(
      [
        fakeParser('generic', 0.1),
        fakeParser('kaufland', 0.9, () =>
          makeParsedReceipt({
            purchasedAt: '2026-12-29',
            totals: { grandTotalBani: 1000 },
            lines: [makeParsedLine({ lineTotalBani: 599 })],
            meta: meta('kaufland'),
          }),
        ),
      ],
      SOURCE,
      { now: NOW },
    );
    expect(receipt.meta.parser).toBe('kaufland');
    expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual([
      'SUM_MISMATCH',
      'FUTURE_DATE',
    ]);
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
  });

  it('keeps the parser warnings first and does not repeat one the parser already raised', () => {
    const receipt = parseReceiptWith(
      [
        fakeParser('p', 1, () =>
          makeParsedReceipt({
            totals: { grandTotalBani: 1000 },
            meta: {
              ...meta('p'),
              warnings: [
                { code: 'LOW_CONFIDENCE', message: 'blurry' },
                { code: 'SUM_MISMATCH', message: 'parser says so' },
              ],
            },
          }),
        ),
      ],
      SOURCE,
      { now: NOW },
    );
    expect(receipt.meta.warnings).toEqual([
      { code: 'LOW_CONFIDENCE', message: 'blurry' },
      { code: 'SUM_MISMATCH', message: 'parser says so' },
    ]);
  });

  it('falls through to the next parser when the best one throws', () => {
    const receipt = parseReceiptWith(
      [
        fakeParser('crashes', 0.9, () => {
          throw new Error('boom');
        }),
        fakeParser('works', 0.5),
      ],
      SOURCE,
      { now: NOW },
    );
    expect(receipt.meta.parser).toBe('works');
    expect(receipt.meta.warnings).toMatchObject([
      { code: 'LOW_CONFIDENCE', message: expect.stringContaining('crashes') as string },
    ]);
  });

  it('returns an empty receipt, with warnings, when nothing recognises the document', () => {
    const receipt = parseReceiptWith([fakeParser('no', 0)], SOURCE, { now: NOW });
    expect(receipt).toMatchObject({ chain: 'unknown', lines: [], meta: { engine: 'paste' } });
    expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual([
      'UNKNOWN_CHAIN',
      'MISSING_TOTAL',
      'MISSING_DATE',
    ]);
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
  });

  it('flags an unknown chain even when the parser forgot to', () => {
    const receipt = parseReceiptWith(
      [fakeParser('generic', 0.1, () => makeParsedReceipt({ chain: 'unknown' }))],
      SOURCE,
      { now: NOW },
    );
    expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual(['UNKNOWN_CHAIN']);
  });

  it('survives a parser that returns garbage', () => {
    const garbage = fakeParser(
      'garbage',
      1,
      (() => undefined) as unknown as ReceiptParser['parse'],
    );
    const receipt = parseReceiptWith([garbage], SOURCE, { now: NOW });
    expect(receipt.chain).toBe('unknown');
    expect(receipt.meta.warnings.map((warning) => warning.code)).toContain('LOW_CONFIDENCE');
  });
});

describe('the registry', () => {
  it('only holds usable parsers', () => {
    expect(validateParsers(parsers)).toEqual([]);
  });

  it('rejects duplicate ids, a version that is not semver and missing functions', () => {
    const bad = { id: 'x', version: '1', detect: () => 1 } as unknown as ReceiptParser;
    expect(validateParsers([fakeParser('a', 1), fakeParser('a', 1)])).toEqual([
      'Duplicate parser id "a"',
    ]);
    expect(validateParsers([bad])).toEqual([
      'Parser "x": version "1" is not semver',
      'Parser "x": detect and parse must be functions',
    ]);
  });

  it('never throws from parseReceipt, even on an empty document', () => {
    const empty: ReceiptSource = { kind: 'pdf-text', pages: [] };
    const receipt = parseReceipt(empty, { now: NOW });
    expect(receipt.meta.engine).toBe('pdfjs');
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
  });
});
