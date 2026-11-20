import { describe, expect, it } from 'vitest';
import { OcrLineSchema } from '@/domain';
import { toOcrText, type RawLine } from './lines';

const line = (text: string, x0: number, y0: number, x1: number, y1: number, confidence = 90) =>
  ({ text: `${text}\n`, confidence, bbox: { x0, y0, x1, y1 } }) satisfies RawLine;

const page = (...lines: RawLine[]) => ({
  text: '',
  confidence: 87,
  blocks: [{ paragraphs: [{ lines }] }],
});

const mapping = { scale: 3, imageSize: { w: 200, h: 400 } };

describe('toOcrText', () => {
  it('maps boxes back to original pixels and keeps text and lines aligned', () => {
    const result = toOcrText(
      page(line('Lapte 1L', 30, 60, 300, 90), line('TOTAL 9,99', 30, 120, 330, 150, 70)),
      mapping,
    );

    expect(result.text).toBe('Lapte 1L\nTOTAL 9,99');
    expect(result.lines.map((l) => l.text)).toEqual(['Lapte 1L', 'TOTAL 9,99']);
    expect(result.lines[0]?.bbox).toEqual({ x: 10, y: 20, w: 90, h: 10 });
    expect(result.lines[1]?.confidence).toBe(70);
    expect(result.confidence).toBe(87);
    for (const l of result.lines) expect(OcrLineSchema.safeParse(l).success).toBe(true);
  });

  it('merges the fragments of one printed row that layout analysis split apart', () => {
    // name block on the left, price block on the right, a few pixels apart vertically
    const result = toOcrText(
      page(line('Smantana 30%', 30, 300, 330, 330), line('9,10 B', 500, 303, 590, 333, 60)),
      mapping,
    );

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.text).toBe('Smantana 30% 9,10 B');
    expect(result.lines[0]?.bbox).toEqual({ x: 10, y: 100, w: 187, h: 11 });
    // confidence is weighted by the amount of text
    expect(result.lines[0]?.confidence).toBeGreaterThan(60);
    expect(result.lines[0]?.confidence).toBeLessThan(90);
  });

  it('keeps rows that only touch vertically apart and orders them top to bottom', () => {
    const result = toOcrText(
      page(line('second', 30, 100, 200, 130), line('first', 30, 10, 200, 40)),
      mapping,
    );
    expect(result.text).toBe('first\nsecond');
  });

  it('does not merge fragments that share horizontal space (they are different lines)', () => {
    const result = toOcrText(
      page(line('upper', 30, 10, 300, 40), line('lower', 60, 12, 330, 42)),
      mapping,
    );
    expect(result.lines).toHaveLength(2);
  });

  it('clamps boxes to the image and skips blank lines', () => {
    const result = toOcrText(
      page(line('edge', -30, 1100, 900, 1300), line('   ', 0, 0, 10, 10)),
      mapping,
    );
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.bbox).toEqual({ x: 0, y: 366, w: 200, h: 34 });
  });

  it('copes with a page without layout information', () => {
    expect(toOcrText({ text: 'x', confidence: null, blocks: null }, mapping)).toEqual({
      text: '',
      lines: [],
      confidence: 0,
    });
  });
});
