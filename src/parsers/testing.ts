/**
 * Test-only builders for parser input and output: valid by default. Never import this from
 * application code.
 */
import type { ParsedLine, ParsedReceipt } from '@/domain';
import type { PdfTextSource } from './pdf-rows';

export interface TextLayout {
  /** Width of one character, in PDF units. Default 4. */
  charWidth?: number;
  /** Distance between baselines. Default 10. */
  lineHeight?: number;
  /** x of column 0. Default 10. */
  left?: number;
  /** Item height. Default 7. */
  fontHeight?: number;
}

/**
 * A `pdf-text` source from monospaced text art, one string per printed row and one array per
 * page: each run of text becomes an item, positioned by its column. Runs are separated by two or
 * more spaces (the wide gaps of the real documents); a single space stays inside a run.
 */
export function pdfPagesFromText(
  pages: readonly (readonly string[])[],
  layout: TextLayout = {},
): PdfTextSource {
  const { charWidth = 4, lineHeight = 10, left = 10, fontHeight = 7 } = layout;
  const height = 800;
  return {
    kind: 'pdf-text',
    pages: pages.map((lines) => ({
      width: 600,
      height,
      items: lines.flatMap((line, row) =>
        [...line.matchAll(/\S+(?: \S+)*/g)].map((run) => ({
          str: run[0],
          x: left + run.index * charWidth,
          y: height - 20 - row * lineHeight,
          w: run[0].length * charWidth,
          h: fontHeight,
        })),
      ),
    })),
  };
}

export function pdfFromText(lines: readonly string[], layout: TextLayout = {}): PdfTextSource {
  return pdfPagesFromText([lines], layout);
}

export function makeParsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return {
    idx: 0,
    rawName: 'LAPTE UHT 1L',
    kind: 'product',
    qty: 1,
    qtyUnit: 'buc',
    lineTotalBani: 599,
    ...overrides,
  };
}

export function makeParsedReceipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    schemaVersion: 1,
    chain: 'kaufland',
    docType: 'receipt',
    purchasedAt: '2026-11-07T18:31:47',
    currency: 'RON',
    totals: { grandTotalBani: 599 },
    lines: [makeParsedLine()],
    meta: { engine: 'pdfjs', parser: 'kaufland', parserVersion: '1.0.0', warnings: [] },
    ...overrides,
  };
}
