import type { ParsedReceipt, WarningCode } from '@/domain';

/**
 * The upscale of the second OCR pass. The engine's default (4x) is the first pass: a single scale
 * is sensitive (on the same photo 4x can lose a date row that 3x reads, and the other way round),
 * so a reading that does not add up is tried once more at another scale.
 */
export const SECOND_PASS_SCALE = 3;

/** What a different upscale can fix: a lost or misread price, total or date row. */
const SECOND_PASS_WARNINGS: ReadonlySet<WarningCode> = new Set([
  'SUM_MISMATCH',
  'MISSING_TOTAL',
  'MISSING_DATE',
  'LINE_ARITHMETIC',
]);

/** The lines cannot be checked against the printed total. */
const DOES_NOT_ADD_UP: ReadonlySet<WarningCode> = new Set(['SUM_MISMATCH', 'MISSING_TOTAL']);

const hasWarning = (receipt: ParsedReceipt, codes: ReadonlySet<WarningCode>): boolean =>
  receipt.meta.warnings.some((warning) => codes.has(warning.code));

const countWarnings = (receipt: ParsedReceipt, codes?: ReadonlySet<WarningCode>): number =>
  receipt.meta.warnings.filter((warning) => codes === undefined || codes.has(warning.code)).length;

/** True when a first OCR reading still carries a warning that a second pass may clear. */
export function needsSecondPass(receipt: ParsedReceipt): boolean {
  return hasWarning(receipt, SECOND_PASS_WARNINGS);
}

/**
 * The better of two readings of the same image, in this order: a reading with no line never wins;
 * the one whose lines add up to the printed total (no SUM_MISMATCH or MISSING_TOTAL); the one with
 * fewer warnings; the one with fewer of the warnings that trigger a second pass (a date that was
 * found, even if it lies in the future, beats a missing one); on a tie the first reading stays.
 */
export function pickBetterPass(first: ParsedReceipt, second: ParsedReceipt): ParsedReceipt {
  if ((first.lines.length === 0) !== (second.lines.length === 0)) {
    return first.lines.length === 0 ? second : first;
  }
  const firstAddsUp = !hasWarning(first, DOES_NOT_ADD_UP);
  const secondAddsUp = !hasWarning(second, DOES_NOT_ADD_UP);
  if (firstAddsUp !== secondAddsUp) return secondAddsUp ? second : first;

  const fewer = countWarnings(second) - countWarnings(first);
  if (fewer !== 0) return fewer < 0 ? second : first;
  return countWarnings(second, SECOND_PASS_WARNINGS) < countWarnings(first, SECOND_PASS_WARNINGS)
    ? second
    : first;
}
