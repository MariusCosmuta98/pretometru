import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ReceiptSource } from '@/domain';
import { parseReceipt } from '../parse-receipt';
import { rankParsers } from '../registry';
import generic from './index';
import { GENERIC_DETECT_SCORE } from './parse';

const NOW = new Date('2026-11-20T12:00:00Z');

const pasted = (...lines: string[]): ReceiptSource => ({
  kind: 'pasted-text',
  text: lines.join('\n'),
});

// A receipt of an invented store: no parser knows its layout.
const RECEIPT = pasted(
  'MAGAZIN EXEMPLU SRL',
  'CUI: RO1234567',
  'LAPTE UHT 1L          5,99 B',
  '5941234567890',
  'APA PLATA 2 x 2,50    5,00 A',
  '0,436 KG x 14,99',
  'MERE GOLDEN           6,54 A',
  'REDUCERE CUPON       -1,50 A',
  'SUBTOTAL 16,03',
  'TOTAL 16,03',
  'CARD 16,03',
  'DATA: 20/11/2026 ORA: 09:30:15',
);

describe('generic parser', () => {
  it('reads products with their quantity, EAN and VAT class, the total and the date, and says it is unsure', () => {
    const receipt = parseReceipt(RECEIPT, { now: NOW });

    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt).toMatchObject({
      chain: 'unknown',
      docType: 'receipt',
      purchasedAt: '2026-11-20T09:30:15',
      totals: { grandTotalBani: 1603 },
      meta: { engine: 'paste', parser: 'generic' },
    });
    expect(
      receipt.lines.map((line) => [
        line.rawName,
        line.kind,
        line.qty,
        line.qtyUnit,
        line.unitPriceBani,
        line.lineTotalBani,
      ]),
    ).toEqual([
      ['LAPTE UHT 1L', 'product', 1, 'buc', undefined, 599],
      ['APA PLATA', 'product', 2, 'buc', 250, 500],
      ['MERE GOLDEN', 'product', 0.436, 'kg', 1499, 654],
      ['REDUCERE CUPON', 'discount', 1, 'buc', undefined, -150],
    ]);
    expect(receipt.lines[0]).toMatchObject({
      ean: '5941234567890',
      vatClass: 'B',
      pack: { qty: 1, unit: 'l' },
    });
    // header, subtotal, total and payment rows are not products; the sum and the quantities check out
    expect(receipt.meta.warnings.map((warning) => warning.code).sort()).toEqual([
      'LOW_CONFIDENCE',
      'UNKNOWN_CHAIN',
    ]);
  });

  it('answers a low constant for any text and nothing for a PDF, so every specific parser wins', () => {
    expect(generic.detect(RECEIPT)).toBe(GENERIC_DETECT_SCORE);
    expect(generic.detect(pasted(''))).toBe(GENERIC_DETECT_SCORE);
    expect(generic.detect({ kind: 'ocr-text', text: 'x' })).toBe(GENERIC_DETECT_SCORE);
    expect(generic.detect({ kind: 'pdf-text', pages: [] })).toBe(0);
    expect(GENERIC_DETECT_SCORE).toBeLessThan(0.1);

    const [only, ...rest] = rankParsers(RECEIPT);
    expect(only?.parser.id).toBe('generic');
    expect(rest).toEqual([]);
  });

  it('reads an OCR source with its boxes and confidences', () => {
    const source: ReceiptSource = {
      kind: 'ocr-text',
      text: 'LAPTE 5,99\nTOTAL 5,99',
      lines: [
        { text: 'LAPTE 5,99', confidence: 80, bbox: { x: 5, y: 10, w: 100, h: 12 } },
        { text: 'TOTAL 5,99', confidence: 90, bbox: { x: 5, y: 30, w: 100, h: 12 } },
      ],
      confidence: 85,
    };
    const receipt = parseReceipt(source, { now: NOW });

    expect(receipt.lines[0]).toMatchObject({
      confidence: 0.8,
      bbox: { x: 5, y: 10, w: 100, h: 12 },
    });
    expect(receipt.meta).toMatchObject({ engine: 'tesseract', confidence: 0.85 });
  });

  it('warns that the text is hard to read when the OCR confidence is low', () => {
    const source: ReceiptSource = {
      kind: 'ocr-text',
      text: 'LAPTE 5,99\nTOTAL 5,99',
      confidence: 30,
    };
    const [warning] = parseReceipt(source, { now: NOW }).meta.warnings;

    expect(warning?.code).toBe('LOW_CONFIDENCE');
    expect(warning?.message).toContain('greu de citit');
  });

  it('repairs a misread digit like the store parsers do, and flags it', () => {
    const misread = pasted('LAPTE 5,99', 'PAINE 3,49', 'TOTAL 9,40');
    const receipt = parseReceipt(misread, { now: NOW });

    expect(receipt.totals.grandTotalBani).toBe(948);
    expect(receipt.meta.warnings.map((warning) => warning.code)).toContain('REPAIRED_DIGITS');
    expect(receipt.meta.warnings.map((warning) => warning.code)).not.toContain('SUM_MISMATCH');
  });

  it('keeps going without a total (MISSING_TOTAL from the validation) and ignores what follows the total', () => {
    const noTotal = parseReceipt(pasted('LAPTE 5,99', 'PAINE 3,49'), { now: NOW });
    expect(noTotal.lines).toHaveLength(2);
    expect(noTotal.meta.warnings.map((warning) => warning.code)).toContain('MISSING_TOTAL');

    const after = parseReceipt(pasted('LAPTE 5,99', 'TOTAL 5,99', 'PROMO CAFEA 9,99'), {
      now: NOW,
    });
    expect(after.lines.map((line) => line.rawName)).toEqual(['LAPTE']);
  });

  it('does not mistake products named like the totals block for it', () => {
    const receipt = parseReceipt(
      pasted('LAPTE 5,99 B', 'Total 0% grasime 5,99 B', 'Card cadou 50,00 A', 'TOTAL 61,98'),
      { now: NOW },
    );

    expect(receipt.lines.map((line) => [line.rawName, line.lineTotalBani])).toEqual([
      ['LAPTE', 599],
      ['Total 0% grasime', 599],
      ['Card cadou', 5000],
    ]);
    expect(receipt.totals.grandTotalBani).toBe(6198);
    expect(receipt.meta.warnings.map((warning) => warning.code)).not.toContain('SUM_MISMATCH');
  });

  it('returns an empty, schema-valid receipt for text without anything to read', () => {
    for (const text of ['', '   \n\n', 'Multumim pentru vizita!']) {
      const receipt = parseReceipt({ kind: 'pasted-text', text }, { now: NOW });

      expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
      expect(receipt.lines).toEqual([]);
      expect(receipt.meta.warnings.map((warning) => warning.code)).toEqual(
        expect.arrayContaining(['MISSING_TOTAL', 'MISSING_DATE']),
      );
    }
  });
});
