import { describe, expect, it } from 'vitest';
import type { PdfTextItem } from '@/domain';
import { pdfRows, type PdfTextSource } from './pdf-rows';

// Monospace layout like the real documents: 4 units per character, items placed on a grid.
const item = (str: string, x: number, y: number, charW = 4): PdfTextItem => ({
  str,
  x,
  y,
  w: str.length * charW,
  h: 7,
});

const source = (...pages: PdfTextItem[][]): PdfTextSource => ({
  kind: 'pdf-text',
  pages: pages.map((items) => ({ width: 600, height: 800, items })),
});

describe('pdfRows', () => {
  it('reads rows top to bottom and cells left to right, whatever the item order', () => {
    const rows = pdfRows(
      source([
        item('3,29', 80, 700),
        item('LAPTE', 10, 690),
        item('BABY', 10, 700),
        item('5,99', 80, 690),
      ]),
    );
    expect(rows.map((row) => row.text)).toEqual(['BABY 3,29', 'LAPTE 5,99']);
    expect(rows[0]?.cells.map((cell) => cell.x)).toEqual([10, 80]);
  });

  it('joins items that touch and separates items that have a gap', () => {
    const [row] = pdfRows(
      source([item('SMANTANA', 10, 700), item('400G', 42, 700), item('7,99', 90, 700)]),
    );
    expect(row?.cells.map((cell) => cell.text)).toEqual(['SMANTANA400G', '7,99']);
    expect(row?.text).toBe('SMANTANA400G 7,99');
  });

  it('drops whitespace-only items but keeps their gap', () => {
    const [row] = pdfRows(
      source([item('FL', 10, 700), { ...item(' ', 18, 700), h: 0 }, item('H', 22, 700)]),
    );
    expect(row?.text).toBe('FL H');
  });

  it('puts items with slightly different baselines on one row but not neighbouring lines', () => {
    const rows = pdfRows(
      source([item('A', 10, 700), item('B', 30, 698.5), item('C', 10, 690), item('D', 30, 690.4)]),
    );
    expect(rows.map((row) => row.text)).toEqual(['A B', 'C D']);
  });

  it('keeps pages in order', () => {
    const rows = pdfRows(source([item('page one', 10, 100)], [item('page two', 10, 700)]));
    expect(rows.map((row) => [row.page, row.text])).toEqual([
      [0, 'page one'],
      [1, 'page two'],
    ]);
  });

  it('ignores empty pages and items with broken geometry', () => {
    const rows = pdfRows(source([], [{ ...item('NaN', 10, NaN) }, item('ok', 10, 10)]));
    expect(rows.map((row) => row.text)).toEqual(['ok']);
  });
});
