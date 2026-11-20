import { describe, expect, it } from 'vitest';
import type { ParsedReceipt } from '../src/domain';
import { alignLines, compareReceipts, nameSimilarity, ratio } from './ocr-bench-metrics.ts';

type Line = ParsedReceipt['lines'][number];

const line = (idx: number, rawName: string, lineTotalBani: number, qty = 1): Line => ({
  idx,
  rawName,
  kind: 'product',
  qty,
  qtyUnit: 'buc',
  lineTotalBani,
});

const receipt = (
  lines: Line[],
  grandTotalBani: number,
  warnings: ParsedReceipt['meta']['warnings'] = [],
): ParsedReceipt => ({
  schemaVersion: 1,
  chain: 'lidl',
  docType: 'receipt',
  currency: 'RON',
  totals: { grandTotalBani },
  lines,
  meta: { engine: 'tesseract', parser: 'lidl', parserVersion: '1.0.0', warnings },
});

const truth = receipt(
  [
    line(0, 'Lapte integral 1L', 599),
    line(1, 'Paine alba feliata', 349),
    line(2, 'Mere Golden', 654),
    line(3, 'Detergent rufe', 2199),
  ],
  3801,
);

describe('nameSimilarity', () => {
  it('ignores case, accents and spacing, and tells different names apart', () => {
    expect(nameSimilarity('Lapte integral 1L', 'LAPTE  INTEGRAL 1L')).toBe(1);
    expect(nameSimilarity('Pâine albă', 'paine alba')).toBe(1);
    expect(nameSimilarity('Lapte integral', 'Detergent rufe')).toBeLessThan(0.3);
    expect(nameSimilarity('', 'Lapte')).toBe(0);
    expect(nameSimilarity('a', 'b')).toBe(0);
  });
});

describe('compareReceipts', () => {
  it('scores a perfect reading', () => {
    const metrics = compareReceipts(receipt(truth.lines, 3801), truth);

    expect(metrics).toMatchObject({
      totalCorrect: true,
      sum: 'ok',
      truthLines: 4,
      readLines: 4,
      found: 4,
      exactPrices: 4,
      exactQuantities: 4,
      silentErrors: 0,
      warnings: {},
    });
  });

  it('counts a misread price, and calls it silent only when nothing flags it', () => {
    const wrong = [
      ...truth.lines.slice(0, 2),
      line(2, 'Mere Golden', 684),
      ...truth.lines.slice(3),
    ];

    expect(compareReceipts(receipt(wrong, 3801), truth)).toMatchObject({
      found: 4,
      exactPrices: 3,
      silentErrors: 1,
    });
    const flaggedLine = receipt(wrong, 3801, [
      { code: 'LINE_ARITHMETIC', message: '', lineIdx: 2 },
    ]);
    expect(compareReceipts(flaggedLine, truth)).toMatchObject({ exactPrices: 3, silentErrors: 0 });
    const flaggedSum = receipt(wrong, 3831, [{ code: 'SUM_MISMATCH', message: '' }]);
    expect(compareReceipts(flaggedSum, truth)).toMatchObject({
      totalCorrect: false,
      sum: 'mismatch',
      silentErrors: 0,
      warnings: { SUM_MISMATCH: 1 },
    });
    // without a total the sum cannot be checked, which the review shows as MISSING_TOTAL
    const noTotal = receipt(wrong, 0, [{ code: 'MISSING_TOTAL', message: '' }]);
    expect(compareReceipts(noTotal, truth)).toMatchObject({ sum: 'no-total', silentErrors: 0 });
  });

  it('keeps the other lines in step when a line is dropped, invented or its name garbled', () => {
    const read = [
      line(0, 'Lapte integral 1L', 599),
      line(1, 'Cota TVA', 123),
      line(2, 'Pa1ne a1ba fe1iata', 349),
      line(3, 'Mcrc Go1den', 654),
    ];
    const metrics = compareReceipts(receipt(read, 1725), truth);

    // `Detergent rufe` is missing; the garbled `Mere Golden` is still known by its price
    expect(metrics).toMatchObject({ truthLines: 4, readLines: 4, found: 3, exactPrices: 3 });
    expect(alignLines(truth.lines, read)).toEqual([
      [0, 0],
      [1, 2],
      [2, 3],
    ]);
  });
});

describe('ratio', () => {
  it('prints the share, or a dash when there is nothing to measure', () => {
    expect(ratio(7, 9)).toBe('7/9 (78%)');
    expect(ratio(0, 0)).toBe('-');
  });
});
