/**
 * Fixture sanitizer (library). Turns a private extraction of a real receipt into a source that is
 * safe to commit: personal rows are masked (letters -> x/X, digits -> 0, so length, layout and
 * punctuation survive) or rewritten, and everything that was changed is returned so a private
 * denylist can be built from it. Pure: no file or network access (see `sanitize-fixtures.ts`).
 *
 * Rules live next to the receipts they describe (`fixture-recipes.ts`) and contain no personal
 * data: they select rows by label or position, never by value.
 */
import type { ReceiptSource } from '../src/domain/receipt-source';

export type PdfSource = Extract<ReceiptSource, { kind: 'pdf-text' }>;
type PdfItem = PdfSource['pages'][number]['items'][number];

/** Items whose baselines differ by less than this (pdf user space) belong to the same row. */
const ROW_TOLERANCE = 2;
/** A horizontal gap wider than this between two items reads as a space. */
const WORD_GAP = 1;

export function maskText(text: string): string {
  return text.replace(/[\p{L}\p{Nd}]/gu, (char) => {
    if (/\p{Nd}/u.test(char)) return '0';
    return /\p{Lu}/u.test(char) ? 'X' : 'x';
  });
}

export function zeroDigits(text: string): string {
  return text.replace(/\p{Nd}/gu, '0');
}

export interface PdfRow {
  y: number;
  /** Indexes into the page's `items`, left to right. */
  itemIndexes: number[];
  text: string;
}

function rowText(entries: readonly PdfItem[]): string {
  let text = '';
  let end = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    if (text !== '' && entry.x - end > WORD_GAP) text += ' ';
    text += entry.str;
    end = entry.x + entry.w;
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** Rows of a page, top to bottom. */
export function pdfRows(items: readonly PdfItem[]): PdfRow[] {
  const groups: Array<{ y: number; indexes: number[] }> = [];
  items.forEach((entry, index) => {
    const group = groups.find((candidate) => Math.abs(candidate.y - entry.y) < ROW_TOLERANCE);
    if (group) group.indexes.push(index);
    else groups.push({ y: entry.y, indexes: [index] });
  });

  return groups
    .sort((a, b) => b.y - a.y)
    .map(({ y, indexes }) => {
      const ordered = indexes.toSorted((a, b) => (items[a]?.x ?? 0) - (items[b]?.x ?? 0));
      return {
        y,
        itemIndexes: ordered,
        text: rowText(ordered.flatMap((index) => items[index] ?? [])),
      };
    });
}

/** Rewrites the strings of one row, left to right; must return as many strings as it receives. */
export type RowTransform = (strings: string[]) => string[];

export interface RowInfo {
  page: number;
  /** Row number on the page, top to bottom. */
  index: number;
  text: string;
  /** Text of every row on the page. */
  rows: readonly string[];
}

export interface PdfRule {
  /** Shown when the rule matches nothing. */
  name: string;
  when: (row: RowInfo) => boolean;
  apply: 'mask' | 'zero-digits' | RowTransform;
  /** Rules must match at least one row, so a drifting extraction fails loudly instead of leaking. */
  optional?: boolean;
}

/** Rows strictly between the first row matching `start` and the next row matching `end`. */
export function between(start: RegExp, end: RegExp): (row: RowInfo) => boolean {
  return ({ index, rows }) => {
    const from = rows.findIndex((text) => start.test(text));
    if (from === -1 || index <= from) return false;
    const to = rows.findIndex((text, position) => position > from && end.test(text));
    return to !== -1 && index < to;
  };
}

/** Every row after the first row matching `anchor`. */
export function after(anchor: RegExp): (row: RowInfo) => boolean {
  return ({ index, rows }) => {
    const from = rows.findIndex((text) => anchor.test(text));
    return from !== -1 && index > from;
  };
}

/** Only the row right after the first row matching `anchor`. */
export function immediatelyAfter(anchor: RegExp): (row: RowInfo) => boolean {
  return ({ index, rows }) => {
    const from = rows.findIndex((text) => anchor.test(text));
    return from !== -1 && index === from + 1;
  };
}

export interface SanitizeResult<S> {
  source: S;
  /** Original text of every item that was changed. */
  removed: string[];
}

function transformRow(apply: PdfRule['apply'], strings: string[]): string[] {
  if (apply === 'mask') return strings.map(maskText);
  if (apply === 'zero-digits') return strings.map(zeroDigits);
  return apply(strings);
}

/** The first rule that matches a row decides what happens to it; unmatched rows are kept as they are. */
export function sanitizePdfText(
  source: PdfSource,
  rules: readonly PdfRule[],
): SanitizeResult<PdfSource> {
  const removed: string[] = [];
  const matches = new Map<PdfRule, number>();

  const pages = source.pages.map((page, pageIndex) => {
    const items = page.items.map((entry) => ({ ...entry }));
    const pageRows = pdfRows(page.items);
    const rows = pageRows.map((row) => row.text);

    pageRows.forEach((row, index) => {
      const info: RowInfo = { page: pageIndex, index, text: row.text, rows };
      const rule = rules.find((candidate) => candidate.when(info));
      if (!rule) return;
      matches.set(rule, (matches.get(rule) ?? 0) + 1);

      const before = row.itemIndexes.map((itemIndex) => items[itemIndex]?.str ?? '');
      const rewritten = transformRow(rule.apply, before);
      if (rewritten.length !== before.length) {
        throw new Error(`Rule "${rule.name}" changed the number of items in a row`);
      }

      row.itemIndexes.forEach((itemIndex, position) => {
        const target = items[itemIndex];
        const next = rewritten[position];
        if (!target || next === undefined || next === target.str) return;
        removed.push(target.str);
        target.str = next;
      });
    });

    return { ...page, items };
  });

  for (const rule of rules) {
    if (!rule.optional && !matches.has(rule)) {
      throw new Error(
        `Rule "${rule.name}" matched no row: the extraction no longer fits its recipe`,
      );
    }
  }

  return { source: { ...source, pages }, removed };
}

const fold = (text: string): string => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

function tokensOf(text: string): string[] {
  return (fold(text).match(/[\p{L}\p{Nd}]+/gu) ?? []).filter((token) =>
    /^\d+$/.test(token) ? token.length >= 5 : token.length >= 4,
  );
}

/**
 * Distinctive words and numbers of the removed text (folded to lower case, no diacritics), minus
 * anything that is still visible in the kept text.
 */
export function denylistTerms(removed: readonly string[], kept: readonly string[]): string[] {
  const visible = new Set(kept.flatMap(tokensOf));
  return [...new Set(removed.flatMap(tokensOf).filter((token) => !visible.has(token)))];
}

function formatValue(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = `${indent}  `;
    const lines = value.map((entry) => `${inner}${formatValue(entry, inner)}`);
    return `[\n${lines.join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
    if (entries.length === 0) return '{}';
    if (entries.every(([, entry]) => entry === null || typeof entry !== 'object')) {
      const fields = entries.map(
        ([key, entry]) => `${JSON.stringify(key)}: ${JSON.stringify(entry)}`,
      );
      return `{ ${fields.join(', ')} }`;
    }
    const inner = `${indent}  `;
    const lines = entries.map(
      ([key, entry]) => `${inner}${JSON.stringify(key)}: ${formatValue(entry, inner)}`,
    );
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Stable layout for committed fixtures: two-space indent, one line per leaf object (pdf items, OCR lines). */
export function formatFixtureJson(value: unknown): string {
  return `${formatValue(value, '')}\n`;
}
