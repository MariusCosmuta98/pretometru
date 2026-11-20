import { describe, expect, it } from 'vitest';
import type { ParsedReceipt, WarningCode } from '@/domain';
import { makeParsedLine, makeParsedReceipt } from '@/parsers/testing';
import { needsSecondPass, pickBetterPass } from './second-pass';

/** A reading with `lineCount` lines and the given warnings; `name` tells the readings apart. */
function reading(name: string, codes: WarningCode[], lineCount = 3): ParsedReceipt {
  return makeParsedReceipt({
    lines: Array.from({ length: lineCount }, (_, idx) => makeParsedLine({ idx, rawName: name })),
    meta: {
      engine: 'tesseract',
      parser: 'lidl',
      parserVersion: '1.0.0',
      warnings: codes.map((code) => ({ code, message: code })),
    },
  });
}

const nameOf = (receipt: ParsedReceipt) => receipt.lines[0]?.rawName;

describe('needsSecondPass', () => {
  it.each(['SUM_MISMATCH', 'MISSING_TOTAL', 'MISSING_DATE', 'LINE_ARITHMETIC'] as const)(
    'asks for a second pass on %s',
    (code) => {
      expect(needsSecondPass(reading('first', ['REPAIRED_DIGITS', code]))).toBe(true);
    },
  );

  it('lets a clean reading, or one with only soft warnings, be', () => {
    expect(needsSecondPass(reading('first', []))).toBe(false);
    expect(
      needsSecondPass(
        reading('first', ['REPAIRED_DIGITS', 'LOW_CONFIDENCE', 'FUTURE_DATE', 'VAT_MISMATCH']),
      ),
    ).toBe(false);
  });
});

describe('pickBetterPass', () => {
  it('prefers the reading whose lines add up to the total, even with more warnings', () => {
    const first = reading('first', ['SUM_MISMATCH']);
    const second = reading('second', ['REPAIRED_DIGITS', 'LOW_CONFIDENCE', 'MISSING_DATE']);
    expect(nameOf(pickBetterPass(first, second))).toBe('second');
    // Whichever order they come in, the one that adds up wins.
    expect(nameOf(pickBetterPass(second, first))).toBe('second');

    // A lost total is as bad as a wrong sum.
    expect(nameOf(pickBetterPass(reading('first', ['MISSING_TOTAL']), second))).toBe('second');
  });

  it('prefers fewer warnings when both add up, or neither does', () => {
    expect(
      nameOf(
        pickBetterPass(
          reading('first', ['REPAIRED_DIGITS', 'LOW_CONFIDENCE']),
          reading('second', ['REPAIRED_DIGITS']),
        ),
      ),
    ).toBe('second');
    expect(
      nameOf(
        pickBetterPass(
          reading('first', ['SUM_MISMATCH']),
          reading('second', ['SUM_MISMATCH', 'LINE_ARITHMETIC']),
        ),
      ),
    ).toBe('first');
  });

  it('keeps the first reading on a tie', () => {
    expect(
      nameOf(
        pickBetterPass(reading('first', ['MISSING_DATE']), reading('second', ['MISSING_DATE'])),
      ),
    ).toBe('first');
    expect(nameOf(pickBetterPass(reading('first', []), reading('second', [])))).toBe('first');
  });

  it('breaks a tie on the warning count by the warnings a retry is meant to clear', () => {
    // The date was found this time, even if it lies in the future: better than no date.
    expect(
      nameOf(
        pickBetterPass(reading('first', ['MISSING_DATE']), reading('second', ['FUTURE_DATE'])),
      ),
    ).toBe('second');
    expect(
      nameOf(
        pickBetterPass(reading('first', ['FUTURE_DATE']), reading('second', ['MISSING_DATE'])),
      ),
    ).toBe('first');
  });

  it('never trades a reading with lines for one without', () => {
    const empty = reading('empty', [], 0);
    expect(nameOf(pickBetterPass(reading('first', ['SUM_MISMATCH', 'MISSING_DATE']), empty))).toBe(
      'first',
    );
    expect(
      pickBetterPass(empty, reading('second', ['SUM_MISMATCH', 'MISSING_DATE'])).lines,
    ).toHaveLength(3);
  });
});
