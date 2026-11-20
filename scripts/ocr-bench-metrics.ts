/**
 * How well a receipt read from a photo matches its ground truth, as counts only. Nothing here
 * returns or prints receipt text: the benchmark runs on private originals (plan §11).
 */
import type { ParsedReceipt } from '../src/domain';

type Line = ParsedReceipt['lines'][number];

export type SumCheck = 'ok' | 'mismatch' | 'no-total';

export interface ReceiptMetrics {
  totalCorrect: boolean;
  /** Whether the lines read add up to the total read (`no-total`: no total could be read). */
  sum: SumCheck;
  truthLines: number;
  readLines: number;
  /** Lines of the truth that a read line stands for. */
  found: number;
  /** Of those, with the exact line total. */
  exactPrices: number;
  /** Of those, with the exact quantity. */
  exactQuantities: number;
  /** Wrong line totals that nothing flags: no warning on the line, and the sum checks out. */
  silentErrors: number;
  /** Warning codes read, with how often each came up. */
  warnings: Readonly<Record<string, number>>;
}

const MATCH_BY_NAME = 0.5;
// A garbled name still stands for the line when its price is exactly the one expected.
const MATCH_BY_PRICE = 0.2;

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function bigrams(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let at = 0; at < text.length - 1; at++) {
    const pair = text.slice(at, at + 2);
    counts.set(pair, (counts.get(pair) ?? 0) + 1);
  }
  return counts;
}

/** 0..1, the Sørensen–Dice coefficient of the character pairs, ignoring case, accents and spacing. */
export function nameSimilarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (x === '' || y === '') return 0;
  if (x === y) return 1;
  const left = bigrams(x);
  const right = bigrams(y);
  let shared = 0;
  for (const [pair, count] of left) shared += Math.min(count, right.get(pair) ?? 0);
  const pairs = x.length - 1 + (y.length - 1);
  return pairs === 0 ? 0 : (2 * shared) / pairs;
}

function pairScore(truth: Line, read: Line): number | undefined {
  const name = nameSimilarity(truth.rawName, read.rawName);
  const samePrice = truth.lineTotalBani === read.lineTotalBani;
  if (name < MATCH_BY_NAME && !(samePrice && name >= MATCH_BY_PRICE)) return undefined;
  return name + (samePrice ? 1 : 0);
}

/**
 * Pairs the lines of the truth with the lines read, in reading order: a line the OCR dropped or
 * invented does not shift the others. Returns `[truthIdx, readIdx]` pairs.
 */
export function alignLines(
  truth: readonly Line[],
  read: readonly Line[],
): Array<[truth: number, read: number]> {
  // best[i][j]: the best total score of pairing the first i truth lines with the first j read lines
  const best = Array.from({ length: truth.length + 1 }, () =>
    new Array<number>(read.length + 1).fill(0),
  );
  for (let i = 1; i <= truth.length; i++) {
    for (let j = 1; j <= read.length; j++) {
      const score = pairScore(truth[i - 1]!, read[j - 1]!);
      best[i]![j] = Math.max(
        best[i - 1]![j]!,
        best[i]![j - 1]!,
        score === undefined ? 0 : best[i - 1]![j - 1]! + score,
      );
    }
  }

  const pairs: Array<[number, number]> = [];
  let i = truth.length;
  let j = read.length;
  while (i > 0 && j > 0) {
    const here = best[i]![j]!;
    if (here === best[i - 1]![j]!) i--;
    else if (here === best[i]![j - 1]!) j--;
    else pairs.push([--i, --j]);
  }
  return pairs.reverse();
}

export function compareReceipts(read: ParsedReceipt, truth: ParsedReceipt): ReceiptMetrics {
  const { warnings } = read.meta;
  const has = (code: string) => warnings.some((warning) => warning.code === code);
  const sum: SumCheck = has('SUM_MISMATCH') ? 'mismatch' : has('MISSING_TOTAL') ? 'no-total' : 'ok';

  let exactPrices = 0;
  let exactQuantities = 0;
  let silentErrors = 0;
  const pairs = alignLines(truth.lines, read.lines);
  for (const [truthIdx, readIdx] of pairs) {
    const want = truth.lines[truthIdx]!;
    const got = read.lines[readIdx]!;
    if (got.lineTotalBani === want.lineTotalBani) exactPrices++;
    else if (sum === 'ok' && !warnings.some((warning) => warning.lineIdx === readIdx)) {
      silentErrors++;
    }
    if (got.qty === want.qty) exactQuantities++;
  }

  const codes: Record<string, number> = {};
  for (const { code } of warnings) codes[code] = (codes[code] ?? 0) + 1;

  return {
    totalCorrect: read.totals.grandTotalBani === truth.totals.grandTotalBani,
    sum,
    truthLines: truth.lines.length,
    readLines: read.lines.length,
    found: pairs.length,
    exactPrices,
    exactQuantities,
    silentErrors,
    warnings: codes,
  };
}

/** `7/9 (78%)`, or `-` when there is nothing to measure. */
export function ratio(part: number, whole: number): string {
  return whole === 0 ? '-' : `${part}/${whole} (${Math.round((part / whole) * 100)}%)`;
}
