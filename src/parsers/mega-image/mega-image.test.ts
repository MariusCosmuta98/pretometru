import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ReceiptSource } from '@/domain';
import { getFixture, normalizeForGolden, sourceOf } from '@fixtures';
import { parseReceipt } from '../parse-receipt';
import { rankParsers } from '../registry';
import megaImage from './index';

const fixture = getFixture('mega-image-2026-11-03');
const NOW = new Date(fixture.now);

const parse = (source: ReceiptSource) => parseReceipt(source, { now: NOW });
const codes = (receipt: ReturnType<typeof parse>) =>
  receipt.meta.warnings.map((warning) => `${warning.code}:${warning.lineIdx ?? '-'}`);

describe('Mega Image golden: mega-image-2026-11-03', () => {
  const pasted = sourceOf(fixture, 'pasted-text');
  const ocr = sourceOf(fixture, 'ocr-text');

  it('reads the clean pasted text exactly as the truth', () => {
    const receipt = parse(pasted.source);

    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(normalizeForGolden(receipt)).toEqual(normalizeForGolden(pasted.expected));
    expect(receipt.meta.warnings).toEqual([]);
    expect(receipt.meta).toMatchObject({ engine: 'paste', parser: 'mega-image' });
  });

  it('reads the noisy OCR literally, and the lines that do not add up are flagged by SUM_MISMATCH', () => {
    const receipt = parse(ocr.source);

    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(normalizeForGolden(receipt)).toEqual(normalizeForGolden(ocr.expected));
    expect(codes(receipt)).toEqual(['SUM_MISMATCH:-']);
    expect(receipt.meta).toMatchObject({ engine: 'tesseract', parser: 'mega-image' });
  });

  it('does not "repair" prices it cannot prove: the 3→9 and 5→9 misreads are not fixed by arithmetic', () => {
    const receipt = parse(ocr.source);
    const truth = fixture.expected;

    expect(receipt.lines.map((line) => line.lineTotalBani)).toEqual([1785, 1499, 1299, 1893]);
    expect(truth.lines.map((line) => line.lineTotalBani)).toEqual([1789, 1499, 1299, 1999]);
    expect(receipt.lines.some((line) => line.confidence !== undefined)).toBe(true);
  });

  it('keeps the EAN as printed, truncated or misread, and never reads the number under TOTAL as one', () => {
    const receipt = parse(ocr.source);

    expect(receipt.lines.map((line) => line.ean)).toEqual([
      '401540000675',
      '853042107579',
      '853042107549',
      '534506503482',
    ]);
    expect(receipt.lines).toHaveLength(4);
  });

  it('is the Mega Image parser for both texts, by the card-slip merchant line and the layout', () => {
    for (const { source } of [ocr, pasted]) {
      const [best, ...others] = rankParsers(source);
      expect(best?.parser.id).toBe('mega-image');
      expect(best?.score).toBeGreaterThan(0.9);
      expect(others.every((other) => other.score < 0.1)).toBe(true);
    }
  });

  it('recognises a cropped photo by its layout alone, but with less certainty', () => {
    const cropped: ReceiptSource = {
      kind: 'pasted-text',
      text: 'LAPTE 1L 5,99\n5941234567890\nPAINE 3,49\n5949876543210\nTOTAL 9,48',
    };
    const score = megaImage.detect(cropped);

    expect(score).toBeGreaterThan(0.3);
    expect(score).toBeLessThan(0.6);
    expect(parseReceipt(cropped, { now: NOW }).chain).toBe('mega-image');
  });

  it('does not take other text or a PDF for a Mega Image receipt', () => {
    expect(megaImage.detect({ kind: 'pasted-text', text: 'Lapte 5,99\nTOTAL 5,99' })).toBe(0);
    expect(megaImage.detect({ kind: 'pdf-text', pages: [] })).toBe(0);
  });

  it('needs the whole product-then-EAN layout to recognise a receipt without the slip line', () => {
    // one product with an EAN among three is a receipt that prints a code here and there
    const some = 'LAPTE 5,99\n5941234567890\nPAINE 3,49\nOUA 8,99\nTOTAL 18,47';
    const single = 'LAPTE 5,99\n5941234567890\nTOTAL 5,99';

    expect(megaImage.detect({ kind: 'pasted-text', text: some })).toBe(0);
    expect(megaImage.detect({ kind: 'pasted-text', text: single })).toBe(0);
    expect(
      megaImage.detect({ kind: 'pasted-text', text: `${single}\nTERMINAL MI1 COMERCIANT MEGA1` }),
    ).toBe(0.6);
  });
});

// A made-up receipt in the Mega Image layout.
const SYNTHETIC = [
  'LAPTE 1L 5,99',
  '5941234567890',
  'COLA 2,5L 6,99',
  '5949876543210',
  'PAINE 3,49',
  'TOTAL 16,47',
  '0000000000000',
  'TERMINAL MI000000 COMERCIANT MEGA0B00',
  'DATA 20.11.26 ORA 09:30:15',
];

const text = (lines: readonly string[]): ReceiptSource => ({
  kind: 'pasted-text',
  text: lines.join('\n'),
});

describe('Mega Image parser on other receipts', () => {
  it('reads products with and without an EAN, the total and the date of the slip', () => {
    const receipt = parse(text(SYNTHETIC));

    expect(receipt).toMatchObject({
      chain: 'mega-image',
      purchasedAt: '2026-11-20T09:30:15',
      totals: { grandTotalBani: 1647 },
    });
    expect(receipt.lines.map((line) => [line.rawName, line.lineTotalBani, line.ean])).toEqual([
      ['LAPTE 1L', 599, '5941234567890'],
      ['COLA 2,5L', 699, '5949876543210'],
      ['PAINE', 349, undefined],
    ]);
    expect(receipt.lines[0]?.pack).toEqual({ qty: 1, unit: 'l' });
    expect(receipt.meta.warnings).toEqual([]);
  });

  it('reads text with no-break spaces and an EAN split into groups like the plain text', () => {
    const noisy = SYNTHETIC.map((line) =>
      line.replaceAll(' ', '\u00a0').replace('5941234567890', '5941 2345 67890'),
    );

    expect(normalizeForGolden(parse(text(noisy)))).toEqual(
      normalizeForGolden(parse(text(SYNTHETIC))),
    );
  });

  it('stops at the card slip when there is no TOTAL row, leaving the total to the validation', () => {
    const receipt = parse(text(SYNTHETIC.filter((line) => !line.startsWith('TOTAL'))));

    expect(receipt.lines.map((line) => line.rawName)).toEqual(['LAPTE 1L', 'COLA 2,5L', 'PAINE']);
    expect(receipt.totals.grandTotalBani).toBe(0);
    expect(receipt.meta.warnings.map((warning) => warning.code)).toContain('MISSING_TOTAL');
  });

  it('repairs a misread TOTAL that the lines prove (16,47 read as 16,41) and flags it', () => {
    const receipt = parse(
      text(SYNTHETIC.map((line) => (line.startsWith('TOTAL') ? 'TOTAL 16,41' : line))),
    );

    expect(receipt.totals.grandTotalBani).toBe(1647);
    expect(receipt.meta.warnings.map((warning) => [warning.code, warning.lineIdx])).toEqual([
      ['REPAIRED_DIGITS', undefined],
    ]);
  });
});
