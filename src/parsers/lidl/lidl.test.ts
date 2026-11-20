import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ReceiptSource } from '@/domain';
import { getFixture, normalizeForGolden, sourceOf } from '@fixtures';
import { parseReceipt } from '../parse-receipt';
import { rankParsers } from '../registry';
import lidl from './index';

const fixture = getFixture('lidl-2026-12-29');
const NOW = new Date(fixture.now);

const parse = (source: ReceiptSource) => parseReceipt(source, { now: NOW });

/** JSON with sorted keys, to compare objects whatever the order their keys were written in. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

describe('Lidl golden: lidl-2026-12-29', () => {
  const pasted = sourceOf(fixture, 'pasted-text');
  const ocr = sourceOf(fixture, 'ocr-text');

  it('reads the clean pasted text exactly as the truth', () => {
    const receipt = parse(pasted.source);

    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(normalizeForGolden(receipt)).toEqual(normalizeForGolden(pasted.expected));
    expect(receipt.meta).toMatchObject({ engine: 'paste', parser: 'lidl' });
  });

  it('reads the raw OCR as a perfect arithmetic-only reader would: unit price and VAT rate repaired', () => {
    const receipt = parse(ocr.source);

    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(normalizeForGolden(receipt)).toEqual(normalizeForGolden(ocr.expected));
    expect(receipt.meta).toMatchObject({ engine: 'tesseract', parser: 'lidl' });
  });

  it('keeps the misreads that no arithmetic can repair, and differs from the truth only there', () => {
    const receipt = normalizeForGolden(parse(ocr.source));
    const truth = normalizeForGolden(fixture.expected);

    const differing = receipt.lines.filter(
      (line, index) => canonical(line) !== canonical(truth.lines[index]),
    );
    expect(differing.map((line) => line.rawName)).toEqual(['Saci menajeri 68L']);
    expect(receipt.purchasedAt).toBe('2026-12-29T17:12:38');
    expect(truth.purchasedAt).toBe('2026-12-29T17:12:30');
    expect(receipt.totals).toEqual(truth.totals);
  });

  it('flags every repair on the line it changed, and warns about the future date', () => {
    const { meta } = parse(ocr.source);
    const key = (warning: { code: string; lineIdx?: number }) =>
      `${warning.code}:${warning.lineIdx ?? '-'}`;

    expect(meta.warnings.map(key).sort()).toEqual([
      'FUTURE_DATE:-',
      'REPAIRED_DIGITS:-',
      'REPAIRED_DIGITS:4',
    ]);
  });

  it('adds up: the lines sum to the total, with the repairs', () => {
    const receipt = parse(ocr.source);
    const sum = receipt.lines.reduce((total, line) => total + line.lineTotalBani, 0);

    expect(sum).toBe(receipt.totals.grandTotalBani);
    expect(receipt.totals.paidBani).toBe(receipt.totals.grandTotalBani);
  });

  it('carries the box and confidence of every OCR line for the review crops', () => {
    const receipt = parse(ocr.source);

    for (const line of receipt.lines) {
      expect(line.bbox?.w).toBeGreaterThan(0);
      expect(line.confidence).toBeGreaterThan(0);
      expect(line.raw?.split('\n')).toHaveLength(2);
    }
    expect(receipt.meta.confidence).toBeCloseTo(0.89);
  });

  it('is what parseReceipt picks, well ahead of the generic fallback', () => {
    for (const { source } of [ocr, pasted]) {
      const [best, ...others] = rankParsers(source);
      expect(best?.parser.id).toBe('lidl');
      expect(best?.score).toBeGreaterThan(0.9);
      expect(others.every((other) => other.score < 0.1)).toBe(true);
    }
  });

  it('does not take other text for a Lidl receipt', () => {
    expect(lidl.detect({ kind: 'pasted-text', text: 'Lapte 5,99\nTOTAL 5,99' })).toBe(0);
    expect(lidl.detect({ kind: 'pdf-text', pages: [] })).toBe(0);
    // a weighed line is on many receipts: it does not make a store's receipt a Lidl one
    expect(lidl.detect({ kind: 'pasted-text', text: '0,436 KG x 14,99\nMere 6,54 A' })).toBe(0);
  });
});

// A made-up Lidl receipt: pieces, a weighed item, a discount, a VAT table, cash with change.
const SYNTHETIC = [
  'S.C. LIDL DISCOUNT S.R.L.',
  'Strada Exemplu 1',
  '400000 Cluj-Napoca',
  'Lei',
  '2,000 BUC x 4,05',
  'Saci menajeri 60L 8,10 A',
  '0,436 KG x 14,99',
  'Mere Golden 6,54 B',
  'Reducere Lidl Plus -1,50 B',
  'Subtotal 13,14',
  'TOTAL 13,14',
  'TOTAL TVA 1,91',
  'TVA A 21,00% 1,41',
  'TVA B 11,00% 0,50',
  'NUMERAR 20,00',
  'REST 6,86',
  'DATA:20/11/2026 ORA:09:30:15',
];

const text = (lines: readonly string[]): ReceiptSource => ({
  kind: 'pasted-text',
  text: lines.join('\n'),
});
const without = (...prefixes: string[]) =>
  SYNTHETIC.filter((line) => !prefixes.some((prefix) => line.startsWith(prefix)));
const warningCodes = (receipt: ReturnType<typeof parse>) =>
  receipt.meta.warnings.map((warning) => `${warning.code}:${warning.lineIdx ?? '-'}`);

describe('Lidl parser on other receipts', () => {
  it('reads pieces, a weighed item, a discount, the VAT table and cash with change', () => {
    const receipt = parse(text(SYNTHETIC));

    expect(receipt).toMatchObject({
      chain: 'lidl',
      storeName: 'S.C. LIDL DISCOUNT S.R.L.',
      branch: { city: 'Cluj-Napoca' },
      purchasedAt: '2026-11-20T09:30:15',
      totals: {
        grandTotalBani: 1314,
        paidBani: 1314,
        vat: [
          { rate: 21, vatBani: 141 },
          { rate: 11, vatBani: 50 },
        ],
      },
    });
    expect(
      receipt.lines.map((line) => [
        line.rawName,
        line.kind,
        line.qty,
        line.qtyUnit,
        line.unitPriceBani,
        line.lineTotalBani,
        line.vatRate,
      ]),
    ).toEqual([
      ['Saci menajeri 60L', 'product', 2, 'buc', 405, 810, 21],
      ['Mere Golden', 'product', 0.436, 'kg', 1499, 654, 11],
      ['Reducere Lidl Plus', 'discount', 1, 'buc', undefined, -150, 11],
    ]);
    expect(receipt.lines[0]?.pack).toEqual({ qty: 60, unit: 'l' });
    expect(receipt.lines[1]?.pack).toBeUndefined();
    // it adds up (TOTAL TVA is not the total), and nothing needed repairing
    expect(warningCodes(receipt)).toEqual([]);
  });

  it('reads text with no-break spaces and × exactly like the plain text', () => {
    const noisy = SYNTHETIC.map((line) =>
      line.replaceAll(' ', '\u00a0').replace('\u00a0x\u00a0', '\u00a0×\u00a0'),
    );

    // only `raw` (what was printed, with its no-break spaces) differs
    expect(normalizeForGolden(parse(text(noisy)))).toEqual(
      normalizeForGolden(parse(text(SYNTHETIC))),
    );
    expect(parse(text(noisy)).lines[0]?.raw).toContain('\u00a0');
  });

  it('falls back to the usual class rates (A 21, B 11) when the VAT table is not there', () => {
    const receipt = parse(text(without('TVA A', 'TVA B', 'TOTAL TVA')));

    expect(receipt.totals.vat).toBeUndefined();
    expect(receipt.lines.map((line) => line.vatRate)).toEqual([21, 11, 11]);
  });

  it('keeps a class it has no rate for, and warns about a rate it cannot read', () => {
    const totals = SYNTHETIC.indexOf('Subtotal 13,14');
    const odd = [
      ...SYNTHETIC.slice(0, totals),
      'Cafea 9,99 C',
      ...SYNTHETIC.slice(totals).map((line) =>
        line.startsWith('TVA B') ? 'TVA B 14,00% 0,50' : line,
      ),
    ];
    const receipt = parse(text(odd));
    const cafea = receipt.lines.find((line) => line.rawName === 'Cafea');

    expect(cafea).toMatchObject({ vatClass: 'C', lineTotalBani: 999 });
    expect(cafea?.vatRate).toBeUndefined();
    expect(
      receipt.meta.warnings.filter((warning) => warning.code === 'LOW_CONFIDENCE'),
    ).toHaveLength(1);
    // the unreadable rate row is left out; the class keeps its usual rate on the lines
    expect(receipt.totals.vat).toEqual([{ rate: 21, vatBani: 141 }]);
    expect(
      receipt.lines.filter((line) => line.vatClass === 'B').map((line) => line.vatRate),
    ).toEqual([11, 11]);
  });

  it('takes the total from the subtotal, or from what was paid, when the TOTAL row is missing', () => {
    expect(parse(text(without('TOTAL 13,14'))).totals.grandTotalBani).toBe(1314);
    expect(parse(text(without('TOTAL 13,14', 'Subtotal'))).totals.grandTotalBani).toBe(1314);
    expect(
      parse(text(without('TOTAL 13,14', 'Subtotal', 'NUMERAR', 'REST'))).totals.grandTotalBani,
    ).toBe(0);
  });

  it('keeps a quantity line whose product line is unreadable, flagged, with the total it proves', () => {
    const damaged = SYNTHETIC.map((line) => (line.startsWith('Saci') ? '%%% ??? ~~' : line));
    const receipt = parse(text(damaged));

    expect(receipt.lines[0]).toMatchObject({
      rawName: 'Produs necunoscut',
      qty: 2,
      unitPriceBani: 405,
      lineTotalBani: 810,
    });
    expect(warningCodes(receipt)).toEqual(['LOW_CONFIDENCE:0']);
  });

  it('leaves a sum that no confusable digit explains to the validation, without inventing a repair', () => {
    // 6,54 printed as 6,43: no 0/8, 5/6/9 or 1/7 confusion gets from one to the other
    const wrong = SYNTHETIC.map((line) => (line.startsWith('Mere') ? 'Mere Golden 6,43 B' : line));
    const receipt = parse(text(wrong));

    expect(receipt.lines[1]?.lineTotalBani).toBe(643);
    expect(warningCodes(receipt).sort()).toEqual(['LINE_ARITHMETIC:1', 'SUM_MISMATCH:-'].sort());
  });

  it('does not mistake products named like the totals block for it', () => {
    const totals = SYNTHETIC.indexOf('Subtotal 13,14');
    const tricky = [
      ...SYNTHETIC.slice(0, totals),
      '1,000 BUC x 5,99',
      'Total 0% grasime 5,99 B',
      '1,000 BUC x 50,00',
      'Card cadou 50,00 A',
      'Subtotal 69,13',
      'TOTAL 69,13',
      'TOTAL TVA 11,17',
      'TVA A 21,00% 10,08',
      'TVA B 11,00% 1,09',
      'NUMERAR 100,00',
      'REST 30,87',
      'DATA:20/11/2026 ORA:09:30:15',
    ];
    const receipt = parse(text(tricky));

    expect(receipt.lines.map((line) => [line.rawName, line.lineTotalBani])).toEqual([
      ['Saci menajeri 60L', 810],
      ['Mere Golden', 654],
      ['Reducere Lidl Plus', -150],
      ['Total 0% grasime', 599],
      ['Card cadou', 5000],
    ]);
    expect(receipt.totals).toMatchObject({ grandTotalBani: 6913, paidBani: 6913 });
    expect(warningCodes(receipt)).toEqual([]);
  });

  it('recognises a screenshot cropped above the store name by its quantity lines, with less certainty', () => {
    const { source } = sourceOf(fixture, 'pasted-text');
    const body = source.text.split('\n').slice(4).join('\n');
    const [best] = rankParsers({ kind: 'pasted-text', text: body });

    expect(best?.parser.id).toBe('lidl');
    expect(best?.score).toBeGreaterThan(0.3);
    expect(best?.score).toBeLessThan(0.6);
  });
});
