import type { ReceiptSource } from '@/domain';

/**
 * Lines of an `ocr-text` or `pasted-text` source, cleaned of the noise both kinds share: no-break
 * and exotic spaces, zero-width characters, typographic dashes, low quotes and full-width
 * punctuation standing in for a decimal comma, `×` for `x`. The OCR parsers (Lidl, Mega Image,
 * generic) read these instead of the raw text.
 */

export interface TextLine {
  /** Position among the non-empty lines of the source. */
  index: number;
  /** Cleaned text. */
  text: string;
  /** The line as the source has it (trimmed): what `ParsedLine.raw` shows. */
  printed: string;
  /** 0..1; only `ocr-text` with line data. */
  confidence?: number;
  /** Pixels of the original image; only `ocr-text` with line data. */
  bbox?: { x: number; y: number; w: number; h: number };
}

const INVISIBLE = /[\u00ad\u200b-\u200d\u2060\ufeff]/g;
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\t\f\v]/g;
const DASHES = /[\u2010-\u2015\u2212]/g;
// "‚", "„" and "，" are what a decimal comma turns into in low-resolution photos and some fonts.
const COMMA_LOOKALIKES = /[\u201a\u201e\uff0c]/g;

// One line is never longer than a receipt line; anything longer is junk and must not slow the
// regular expressions down. The same goes for the number of lines.
const MAX_LINE_LENGTH = 300;
const MAX_LINES = 1000;

export function cleanText(text: string): string {
  return text
    .replace(INVISIBLE, '')
    .replace(ODD_SPACES, ' ')
    .replace(DASHES, '-')
    .replace(COMMA_LOOKALIKES, ',')
    .replace(/\uff0e/g, '.')
    .replace(/[\u00d7\u2715\u2716]/g, 'x')
    .replace(/ {2,}/g, ' ')
    .trim();
}

type OcrLines = NonNullable<Extract<ReceiptSource, { kind: 'ocr-text' }>['lines']>;

/**
 * Pairs the text lines with the OCR line data, in order. Tesseract's `text` has blank lines between
 * blocks that `lines` does not, so the match is by (cleaned) content, skipping unmatched entries.
 */
function matchMeta(texts: readonly string[], lines: OcrLines): Array<OcrLines[number] | undefined> {
  const meta = lines.map((line) => ({ line, text: cleanText(line.text) }));
  let cursor = 0;
  return texts.map((text) => {
    for (let ahead = cursor; ahead < Math.min(meta.length, cursor + 4); ahead++) {
      if (meta[ahead]?.text === text) {
        cursor = ahead + 1;
        return meta[ahead]?.line;
      }
    }
    return undefined;
  });
}

export function textLines(source: ReceiptSource): TextLine[] {
  if (source.kind === 'pdf-text') return [];

  const printed = source.text
    .split(/\r\n|[\r\n\u2028\u2029]/)
    .slice(0, MAX_LINES)
    .map((line) => line.slice(0, MAX_LINE_LENGTH).trim());
  const cleaned = printed.map(cleanText);
  const meta =
    source.kind === 'ocr-text' && source.lines
      ? matchMeta(
          cleaned.filter((text) => text !== ''),
          source.lines,
        )
      : [];

  const lines: TextLine[] = [];
  cleaned.forEach((text, position) => {
    if (text === '') return;
    const info = meta[lines.length];
    lines.push({
      index: lines.length,
      text,
      printed: printed[position] ?? text,
      ...(info && {
        confidence: Math.min(1, Math.max(0, info.confidence / 100)),
        bbox: { ...info.bbox },
      }),
    });
  });
  return lines;
}

/** The smallest box around the boxes that exist; `undefined` when none has one. */
export function unionBox(lines: readonly TextLine[]): TextLine['bbox'] {
  const boxes = lines.flatMap((line) => (line.bbox ? [line.bbox] : []));
  if (boxes.length === 0) return undefined;
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    w: Math.max(0, Math.max(...boxes.map((box) => box.x + Math.max(0, box.w))) - x),
    h: Math.max(0, Math.max(...boxes.map((box) => box.y + Math.max(0, box.h))) - y),
  };
}

/** Mean OCR confidence of the lines that have one (0..1); `undefined` when none has. */
export function meanConfidence(lines: readonly TextLine[]): number | undefined {
  const values = lines.flatMap((line) => (line.confidence === undefined ? [] : [line.confidence]));
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}
