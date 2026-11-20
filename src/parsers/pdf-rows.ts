import type { PdfTextItem, ReceiptSource } from '@/domain';

export type PdfTextSource = Extract<ReceiptSource, { kind: 'pdf-text' }>;

/** A run of text with no visible gap inside: pdf.js may cut one printed word into several items. */
export interface PdfCell {
  text: string;
  x: number;
  /** `x` plus the printed width. */
  right: number;
  y: number;
  h: number;
}

export interface PdfRow {
  /** 0-based page. */
  page: number;
  /** pdf.js user space (origin bottom-left): a larger `y` is higher on the page. */
  y: number;
  /** Left-to-right text runs separated by gaps: the printed columns. */
  cells: PdfCell[];
  /** The cells joined with single spaces. */
  text: string;
}

export interface RowOptions {
  /** Items closer than this fraction of the line height (vertically) share a row. Default 0.5. */
  rowTolerance?: number;
  /** A gap wider than this fraction of a character is a space. Default 0.3. */
  spaceRatio?: number;
}

const isUsable = (item: PdfTextItem): boolean =>
  item.str.trim() !== '' &&
  Number.isFinite(item.x) &&
  Number.isFinite(item.y) &&
  Number.isFinite(item.w) &&
  Number.isFinite(item.h);

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Average character width of an item, used to tell a space from kerning. */
function charWidth(item: PdfTextItem): number {
  const length = item.str.length;
  if (item.w > 0 && length > 0) return item.w / length;
  return item.h > 0 ? item.h / 2 : 1;
}

function cellsOf(items: PdfTextItem[], spaceRatio: number): PdfCell[] {
  const cells: PdfCell[] = [];
  let open: { cell: PdfCell; last: PdfTextItem } | undefined;
  for (const item of items) {
    const right = item.x + item.w;
    if (open) {
      const gap = item.x - (open.last.x + open.last.w);
      const spaced = /\s$/.test(open.last.str) || /^\s/.test(item.str);
      if (!spaced && gap <= spaceRatio * charWidth(open.last)) {
        open.cell.text += item.str;
        open.cell.right = Math.max(open.cell.right, right);
        open.cell.h = Math.max(open.cell.h, item.h);
        open.last = item;
        continue;
      }
    }
    const cell: PdfCell = { text: item.str, x: item.x, right, y: item.y, h: item.h };
    cells.push(cell);
    open = { cell, last: item };
  }
  return cells.map((cell) => ({ ...cell, text: collapse(cell.text) }));
}

/**
 * Rebuilds the printed rows of a text PDF: items on the same baseline form a row, rows read top
 * to bottom page after page, and the items of a row read left to right. Whitespace-only items
 * are dropped; spaces come from the geometry, so documents whose items already carry spaces and
 * documents whose items do not give the same rows. Pure and deterministic.
 */
export function pdfRows(source: PdfTextSource, options: RowOptions = {}): PdfRow[] {
  const { rowTolerance = 0.5, spaceRatio = 0.3 } = options;
  const rows: PdfRow[] = [];

  source.pages.forEach((page, pageIndex) => {
    const items = page.items.filter(isUsable).sort((a, b) => b.y - a.y || a.x - b.x);

    let group: PdfTextItem[] = [];
    let anchorY = 0;
    let tallest = 0;
    const flush = () => {
      if (group.length === 0) return;
      const cells = cellsOf(
        [...group].sort((a, b) => a.x - b.x),
        spaceRatio,
      );
      const y = group.reduce((sum, item) => sum + item.y, 0) / group.length;
      rows.push({ page: pageIndex, y, cells, text: cells.map((cell) => cell.text).join(' ') });
      group = [];
    };

    for (const item of items) {
      const tolerance = Math.max(1, rowTolerance * Math.max(tallest, item.h));
      if (group.length > 0 && anchorY - item.y > tolerance) flush();
      if (group.length === 0) {
        anchorY = item.y;
        tallest = 0;
      }
      group.push(item);
      tallest = Math.max(tallest, item.h);
    }
    flush();
  });

  return rows;
}
