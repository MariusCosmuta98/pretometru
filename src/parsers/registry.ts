import type { ReceiptParser, ReceiptSource } from '@/domain';

// Every `src/parsers/<id>/index.ts` default-exports a `ReceiptParser`; adding a parser edits no
// shared file. Parser folders must not import the `@/parsers` barrel (it imports this module, which
// imports every parser): use `../validate`, `../source`, `../pdf-rows`, ... instead.
const modules = import.meta.glob<ReceiptParser>('./*/index.ts', { eager: true, import: 'default' });

/** The discovered parsers, in path order. */
export const parsers: readonly ReceiptParser[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, parser]) => parser);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** Problems that make a parser set unusable (duplicate ids, a version that is not semver, ...). */
export function validateParsers(candidates: readonly ReceiptParser[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const parser of candidates) {
    const name = JSON.stringify(parser.id);
    if (typeof parser.id !== 'string' || parser.id === '') {
      problems.push('Parser without an id');
    } else if (ids.has(parser.id)) {
      problems.push(`Duplicate parser id ${name}`);
    } else {
      ids.add(parser.id);
    }
    if (typeof parser.version !== 'string' || !SEMVER.test(parser.version)) {
      problems.push(`Parser ${name}: version ${JSON.stringify(parser.version)} is not semver`);
    }
    if (typeof parser.detect !== 'function' || typeof parser.parse !== 'function') {
      problems.push(`Parser ${name}: detect and parse must be functions`);
    }
  }
  return problems;
}

export interface RankedParser {
  parser: ReceiptParser;
  /** 0..1, > 0. */
  score: number;
}

function scoreOf(parser: ReceiptParser, source: ReceiptSource): number {
  try {
    const score = Number(parser.detect(source));
    return Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0;
  } catch {
    return 0;
  }
}

/**
 * The parsers that recognise `source`, best first; ties keep registry order. A parser whose
 * `detect` throws or answers 0 is left out. The generic fallback answers with a low constant, so it
 * comes last and only wins when nothing else recognises the document.
 */
export function rankParsers(
  source: ReceiptSource,
  candidates: readonly ReceiptParser[] = parsers,
): RankedParser[] {
  const ranked: RankedParser[] = [];
  for (const parser of candidates) {
    const score = scoreOf(parser, source);
    if (score > 0) ranked.push({ parser, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}
