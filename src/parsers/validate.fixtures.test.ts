import { describe, expect, it } from 'vitest';
import type { ParseWarning, WarningCode } from '@/domain';
import { fixtures } from '@fixtures';
import { validateReceipt } from './validate';

// The warnings validateReceipt is responsible for; DUPLICATE, UNKNOWN_CHAIN, LOW_CONFIDENCE and
// REPAIRED_DIGITS come from the import orchestrator and the parsers.
const VALIDATED: readonly WarningCode[] = [
  'SUM_MISMATCH',
  'LINE_ARITHMETIC',
  'VAT_MISMATCH',
  'FUTURE_DATE',
  'MISSING_DATE',
  'MISSING_TOTAL',
];

const key = ({ code, lineIdx }: ParseWarning) =>
  `${code}${lineIdx === undefined ? '' : `@${lineIdx}`}`;
const validated = (warnings: readonly ParseWarning[]) =>
  warnings
    .filter(({ code }) => VALIDATED.includes(code))
    .map(key)
    .sort();

// Every fixture's ground truth declares the warnings that follow from the receipt and the clock.
// validateReceipt must derive exactly those from the receipt: the same codes, on the same lines.
describe.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
  'validateReceipt on the ground truth of %s',
  (_id, fixture) => {
    const receipts = [...new Set([fixture.expected, ...fixture.sources.map((s) => s.expected)])];

    it.each(receipts.map((receipt, index) => [index, receipt] as const))(
      'raises what ground truth #%i declares',
      (_index, receipt) => {
        const derived = validateReceipt(receipt, { now: new Date(fixture.now) });
        expect(validated(derived)).toEqual(validated(receipt.meta.warnings));
      },
    );
  },
);
