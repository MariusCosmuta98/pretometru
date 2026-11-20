import { describe, expect, it } from 'vitest';
import type { ReceiptSource } from '@/domain';
import { cleanText, meanConfidence, textLines, unionBox } from './text-lines';

describe('cleanText', () => {
  it('turns no-break and exotic spaces, zero-width characters and typographic dashes into plain text', () => {
    expect(cleanText('Lapte\u00a0UHT\u2009 1L\u200b  5,99')).toBe('Lapte UHT 1L 5,99');
    expect(cleanText('REDUCERE \u22121,50 \u2013 B')).toBe('REDUCERE -1,50 - B');
    expect(cleanText('\ufeff  TOTAL\t61,67  ')).toBe('TOTAL 61,67');
  });

  it('reads the marks that stand in for a decimal comma, and × for x', () => {
    expect(cleanText('Lapte 5„99')).toBe('Lapte 5,99');
    expect(cleanText('Lapte 5‚99')).toBe('Lapte 5,99');
    expect(cleanText('2,000 BUC × 4,05')).toBe('2,000 BUC x 4,05');
  });
});

describe('textLines', () => {
  const ocr: ReceiptSource = {
    kind: 'ocr-text',
    // Tesseract leaves a blank line between blocks that `lines` does not have.
    text: 'ALFA 1,00\n\nBETA 2,00\n',
    lines: [
      { text: 'ALFA 1,00', confidence: 90, bbox: { x: 10, y: 20, w: 100, h: 10 } },
      { text: 'BETA 2,00', confidence: 70, bbox: { x: 12, y: 40, w: 90, h: 12 } },
    ],
    confidence: 80,
  };

  it('numbers the non-empty lines and pairs each with its OCR confidence (0..1) and box', () => {
    const lines = textLines(ocr);

    expect(lines.map((line) => [line.index, line.text])).toEqual([
      [0, 'ALFA 1,00'],
      [1, 'BETA 2,00'],
    ]);
    expect(lines[0]).toMatchObject({ confidence: 0.9, bbox: { x: 10, y: 20, w: 100, h: 10 } });
    expect(lines[1]).toMatchObject({ confidence: 0.7, bbox: { x: 12, y: 40, w: 90, h: 12 } });
  });

  it('keeps the printed text next to the cleaned one', () => {
    const [line] = textLines({ kind: 'pasted-text', text: '  Lapte\u00a05,99  ' });

    expect(line).toMatchObject({ text: 'Lapte 5,99', printed: 'Lapte\u00a05,99' });
  });

  it('has no box or confidence for pasted text, and reads nothing from a PDF source', () => {
    const [line] = textLines({ kind: 'pasted-text', text: 'ALFA 1,00' });

    expect(line?.bbox).toBeUndefined();
    expect(line?.confidence).toBeUndefined();
    expect(textLines({ kind: 'pdf-text', pages: [] })).toEqual([]);
  });

  it('still reads the text when the OCR line data does not match it', () => {
    const lines = textLines({ ...ocr, lines: [{ ...ocr.lines![0]!, text: 'something else' }] });

    expect(lines.map((line) => line.text)).toEqual(['ALFA 1,00', 'BETA 2,00']);
    expect(lines.every((line) => line.bbox === undefined)).toBe(true);
  });

  it('splits on every kind of line break and bounds the work on absurd input', () => {
    expect(textLines({ kind: 'pasted-text', text: 'a\r\nb\rc\u2028d' }).map((l) => l.text)).toEqual(
      ['a', 'b', 'c', 'd'],
    );

    const huge = textLines({ kind: 'pasted-text', text: `${'x'.repeat(5000)}\n`.repeat(5000) });
    expect(huge.length).toBeLessThanOrEqual(1000);
    expect(huge[0]?.text.length).toBeLessThanOrEqual(300);
  });
});

describe('unionBox and meanConfidence', () => {
  const line = (bbox?: { x: number; y: number; w: number; h: number }, confidence?: number) => ({
    index: 0,
    text: 'x',
    printed: 'x',
    ...(bbox && { bbox }),
    ...(confidence !== undefined && { confidence }),
  });

  it('is the box around the boxes that exist', () => {
    expect(
      unionBox([
        line({ x: 10, y: 20, w: 100, h: 10 }),
        line(),
        line({ x: 5, y: 40, w: 50, h: 12 }),
      ]),
    ).toEqual({ x: 5, y: 20, w: 105, h: 32 });
    expect(unionBox([line()])).toBeUndefined();
  });

  it('never gives a negative size', () => {
    expect(unionBox([line({ x: 10, y: 10, w: -5, h: -5 })])).toEqual({ x: 10, y: 10, w: 0, h: 0 });
  });

  it('averages the confidences that exist', () => {
    expect(meanConfidence([line(undefined, 0.5), line(), line(undefined, 1)])).toBe(0.75);
    expect(meanConfidence([line()])).toBeUndefined();
  });
});
