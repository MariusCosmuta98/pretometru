import type { OcrLine } from '@/domain';

/** The subset of a Tesseract.js `Page` that is used here (all coordinates in processed-image pixels). */
export interface RawBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export interface RawLine {
  text: string;
  confidence: number;
  bbox: RawBox;
}
export interface RawPage {
  text?: string | null;
  confidence?: number | null;
  blocks?: Array<{ paragraphs: Array<{ lines: RawLine[] }> }> | null;
}

export interface LineMapping {
  /** Factor between processed and original pixels (the upscale that was applied). */
  scale: number;
  /** Size of the original image; boxes are clamped to it. */
  imageSize: { w: number; h: number };
}

export interface OcrText {
  text: string;
  lines: OcrLine[];
  confidence: number;
}

// Two fragments belong to the same printed row when they overlap vertically by at least this
// fraction of the shorter one. Layout analysis often splits "name ...... price" into two blocks.
const SAME_ROW_OVERLAP = 0.5;

interface Fragment {
  text: string;
  confidence: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function verticalOverlap(a: Fragment, b: Fragment): number {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return overlap / Math.max(1, Math.min(a.y1 - a.y0, b.y1 - b.y0));
}

const horizontallyDisjoint = (a: Fragment, b: Fragment) => a.x1 <= b.x0 || b.x1 <= a.x0;

function join(fragments: Fragment[]): Fragment {
  const ordered = [...fragments].sort((a, b) => a.x0 - b.x0);
  const weight = (fragment: Fragment) => Math.max(1, fragment.text.length);
  const totalWeight = ordered.reduce((sum, fragment) => sum + weight(fragment), 0);
  return {
    text: ordered.map((fragment) => fragment.text).join(' '),
    confidence:
      ordered.reduce((sum, fragment) => sum + fragment.confidence * weight(fragment), 0) /
      totalWeight,
    x0: Math.min(...ordered.map((fragment) => fragment.x0)),
    y0: Math.min(...ordered.map((fragment) => fragment.y0)),
    x1: Math.max(...ordered.map((fragment) => fragment.x1)),
    y1: Math.max(...ordered.map((fragment) => fragment.y1)),
  };
}

/**
 * Turns Tesseract's layout into printed rows in reading order: one `OcrLine` per row, with its
 * box in pixels of the ORIGINAL image, and `text` = the rows joined by newlines (so `text` line
 * `i` is `lines[i]`). Fragments of one row that layout analysis split apart are merged.
 */
export function toOcrText(page: RawPage, mapping: LineMapping): OcrText {
  const { scale, imageSize } = mapping;
  const fragments: Fragment[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        const text = clean(line.text);
        if (!text) continue;
        fragments.push({
          text,
          confidence: Math.min(100, Math.max(0, line.confidence)),
          x0: Math.max(0, Math.floor(line.bbox.x0 / scale)),
          y0: Math.max(0, Math.floor(line.bbox.y0 / scale)),
          x1: Math.min(imageSize.w, Math.ceil(line.bbox.x1 / scale)),
          y1: Math.min(imageSize.h, Math.ceil(line.bbox.y1 / scale)),
        });
      }
    }
  }

  const groups: Fragment[][] = [];
  for (const fragment of fragments.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const group = groups.findLast((members) => {
      const span = join(members);
      return (
        verticalOverlap(span, fragment) >= SAME_ROW_OVERLAP &&
        members.every((member) => horizontallyDisjoint(member, fragment))
      );
    });
    if (group) group.push(fragment);
    else groups.push([fragment]);
  }

  const rows = groups.map(join).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: OcrLine[] = rows.map((row) => ({
    text: row.text,
    confidence: row.confidence,
    bbox: { x: row.x0, y: row.y0, w: row.x1 - row.x0, h: row.y1 - row.y0 },
  }));
  return {
    text: lines.map((line) => line.text).join('\n'),
    lines,
    confidence: page.confidence ?? 0,
  };
}
