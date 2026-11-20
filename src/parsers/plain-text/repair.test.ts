import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { mulDiv, ParsedReceiptSchema, type ParsedLine, type ParsedReceipt } from '@/domain';
import { makeParsedLine, makeParsedReceipt } from '../testing';
import { checkLineArithmetic, checkSumMismatch, validateReceipt } from '../validate';
import {
  digitAlternatives,
  MAX_CORRECTIONS,
  repairDigits,
  repairReceipt,
  repairWarnings,
} from './repair';

const NOW = new Date('2026-11-20T12:00:00Z');

type LineSpec = Partial<ParsedLine> & { lineTotalBani: number };

/** A receipt whose printed TOTAL is `grandTotalBani` (default: the exact sum of the lines). */
function receipt(specs: LineSpec[], grandTotalBani?: number, extra: Partial<ParsedReceipt> = {}) {
  const lines = specs.map((spec, idx) =>
    makeParsedLine({ idx, rawName: `PRODUS ${idx}`, ...spec }),
  );
  const sum = lines.reduce((total, line) => total + line.lineTotalBani, 0);
  return makeParsedReceipt({
    chain: 'lidl',
    lines,
    totals: { grandTotalBani: grandTotalBani ?? sum },
    ...extra,
  });
}

const fixes = (outcome: ReturnType<typeof repairDigits>) =>
  outcome.corrections.map(({ lineIdx, field, from, to }) => ({ lineIdx, field, from, to }));

describe('digitAlternatives', () => {
  it('changes one confusable digit at a time: 0↔8, 5↔6↔9, 1↔7', () => {
    const values = (value: number) =>
      digitAlternatives(value, 3, 1)
        .map((alternative) => alternative.value)
        .sort((a, b) => a - b);

    expect(values(810)).toEqual([10, 818, 870]);
    expect(values(595)).toEqual([555, 565, 596, 599, 695, 995]);
  });

  it('pads to the width first, so a leading zero can be a misread 8, but never grows one', () => {
    const values = digitAlternatives(50, 3, 1).map((alternative) => alternative.value);

    expect(values).toContain(850);
    expect(values).toContain(58);
    expect(values).toContain(60);
    expect(values).toContain(90);
    // 80,07 -> 00,07 is a lost digit, not a confusion: no receipt prints it
    expect(digitAlternatives(8007, 3, 1).map((alternative) => alternative.value)).not.toContain(7);
    expect(digitAlternatives(8007, 3, 1).map((alternative) => alternative.value)).toContain(8001);
  });

  it('keeps the sign, counts the digits it changed, and never returns the value itself', () => {
    expect(digitAlternatives(-150, 3, 1).map((alternative) => alternative.value)).toEqual(
      expect.arrayContaining([-750, -160, -190, -158]),
    );
    const two = digitAlternatives(810, 3, 2);
    expect(two.find((alternative) => alternative.value === 878)?.cost).toBe(2);
    expect(two.map((alternative) => alternative.value)).not.toContain(810);
    expect(new Set(two.map((alternative) => alternative.value)).size).toBe(two.length);
  });

  it('stays inside the range the contract allows, and ignores what is not an integer', () => {
    expect(
      digitAlternatives(1_000_000_000, 10, 1).every(
        (alternative) => alternative.value <= 1_000_000_000,
      ),
    ).toBe(true);
    expect(digitAlternatives(1.5, 3, 1)).toEqual([]);
    expect(digitAlternatives(Number.NaN, 3, 1)).toEqual([]);
  });
});

describe('repairDigits', () => {
  it('returns a receipt that already adds up as it is', () => {
    const good = receipt([
      { qty: 2, unitPriceBani: 405, lineTotalBani: 810 },
      { lineTotalBani: 1849 },
    ]);
    const outcome = repairDigits(good);

    expect(outcome.status).toBe('valid');
    expect(outcome.receipt).toBe(good);
    expect(outcome.corrections).toEqual([]);
  });

  it('leaves a sum within the 5 bani tolerance alone, even if an exact fix exists', () => {
    // 4 bani off is a 5 misread as 9, the classic confusion: but the receipt validates.
    const close = receipt([{ lineTotalBani: 599 }, { lineTotalBani: 349 }], 952);

    expect(repairDigits(close).status).toBe('valid');
    expect(repairReceipt(close)).toBe(close);
  });

  it('fixes a unit price misread (9,18 for 9,10): the line total and the sum prove the line total right', () => {
    const misread = receipt([
      { qty: 2, unitPriceBani: 405, lineTotalBani: 810 },
      { unitPriceBani: 1849, lineTotalBani: 1849 },
      { unitPriceBani: 918, lineTotalBani: 910 },
    ]);
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 2, field: 'unitPrice', from: 918, to: 910 }]);
    expect(outcome.receipt.lines[2]?.unitPriceBani).toBe(910);
    expect(outcome.receipt.lines.map((line) => line.lineTotalBani)).toEqual([810, 1849, 910]);
    expect(validateReceipt(outcome.receipt, { now: NOW })).toEqual([]);
  });

  it('fixes a line total misread when the sum says the total, not the unit price, is wrong', () => {
    // 2 x 4,05 = 8,10 printed as 8,18; the TOTAL is the sum of the true totals.
    const misread = receipt(
      [{ qty: 2, unitPriceBani: 405, lineTotalBani: 818 }, { lineTotalBani: 1849 }],
      2659,
    );
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 0, field: 'lineTotal', from: 818, to: 810 }]);
  });

  it('fixes a quantity misread (7,000 for 1,000)', () => {
    const misread = receipt([{ qty: 7, unitPriceBani: 405, lineTotalBani: 405 }]);
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 0, field: 'qty', from: 7000, to: 1000 }]);
    expect(outcome.receipt.lines[0]?.qty).toBe(1);
  });

  it('fixes a misread printed TOTAL when only the sum of the lines can tell', () => {
    const misread = receipt([{ lineTotalBani: 599 }, { lineTotalBani: 349 }], 940);
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([
      { lineIdx: undefined, field: 'grandTotal', from: 940, to: 948 },
    ]);
    expect(outcome.receipt.totals.grandTotalBani).toBe(948);
  });

  it('fixes a line without a unit price when exactly one line could hold the misread digit', () => {
    // 10,58 printed as 10,50: no other line has a digit that fits (the TOTAL's 8 -> 0 would too, so
    // the grand total must be unable to explain it: it is read right here).
    const misread = receipt(
      [{ lineTotalBani: 1050 }, { lineTotalBani: 349 }, { lineTotalBani: 1199 }],
      2606,
    );
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 0, field: 'lineTotal', from: 1050, to: 1058 }]);
  });

  it('declines when two fixes are equally good, and names the lines it cannot choose between', () => {
    // True totals 10,58 and 20,30; the first was read 10,50. The second line (20,30 -> 20,38) and
    // the printed TOTAL (30,88 -> 30,80) would balance the sum just as well.
    const misread = receipt([{ lineTotalBani: 1050 }, { lineTotalBani: 2030 }], 3088);
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('ambiguous');
    expect(outcome.receipt).toBe(misread);
    expect(outcome.corrections).toEqual([]);
    expect(outcome.suspects).toEqual([0, 1]);
  });

  it('declines when no confusable digit explains the gap (3 misread as 9)', () => {
    const misread = receipt([{ lineTotalBani: 1793 }, { lineTotalBani: 1499 }], 3298);
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('unrepairable');
    expect(outcome.receipt).toBe(misread);
    expect(outcome.suspects).toEqual([]);
  });

  it('does not change a line that holds, whatever the sum says', () => {
    // The sum is 80 bani off; line 0 holds (2 x 4,05 = 8,10), so only the free line can move.
    const misread = receipt(
      [{ qty: 2, unitPriceBani: 405, lineTotalBani: 810 }, { lineTotalBani: 1209 }],
      2099,
    );
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 1, field: 'lineTotal', from: 1209, to: 1289 }]);
  });

  it('uses the printed VAT amounts to tell two equally good fixes apart', () => {
    // True: 12,89 (class A, 21%) and 22,09 (class B, 11%). Line 0 was read 12,09. Fixing line 1
    // (22,09 -> 22,89) balances the sum too, but then the VAT of class B no longer matches the
    // printed 2,19.
    const misread = receipt(
      [
        { lineTotalBani: 1209, vatRate: 21, vatClass: 'A' },
        { lineTotalBani: 2209, vatRate: 11, vatClass: 'B' },
      ],
      3498,
      {
        totals: {
          grandTotalBani: 3498,
          vat: [
            { rate: 21, vatBani: 224 },
            { rate: 11, vatBani: 219 },
          ],
        },
      },
    );
    const outcome = repairDigits(misread);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome)).toEqual([{ lineIdx: 0, field: 'lineTotal', from: 1209, to: 1289 }]);
  });

  it('lets each violated line add one correction, but never more than three', () => {
    const two = receipt([
      { qty: 2, unitPriceBani: 405, lineTotalBani: 810 },
      { unitPriceBani: 918, lineTotalBani: 910 },
      { unitPriceBani: 1055, lineTotalBani: 1059 },
    ]);
    const outcome = repairDigits(two);

    expect(outcome.status).toBe('repaired');
    expect(fixes(outcome).map((fix) => [fix.lineIdx, fix.field])).toEqual([
      [1, 'unitPrice'],
      [2, 'unitPrice'],
    ]);
    expect(outcome.corrections.length).toBeLessThanOrEqual(MAX_CORRECTIONS);

    const four = receipt([
      { unitPriceBani: 918, lineTotalBani: 910 },
      { unitPriceBani: 918, lineTotalBani: 910 },
      { unitPriceBani: 918, lineTotalBani: 910 },
      { unitPriceBani: 918, lineTotalBani: 910 },
    ]);
    expect(repairDigits(four).status).toBe('unrepairable');
  });

  it('declines when the fixes of two violated lines cancel out: the printed numbers fit both readings', () => {
    // Fixing both unit prices or fixing both totals (+8 and -8 bani) leaves the sum exact.
    const cancelling = receipt([
      { unitPriceBani: 918, lineTotalBani: 910 },
      { unitPriceBani: 1080, lineTotalBani: 1088 },
    ]);
    const outcome = repairDigits(cancelling);

    expect(outcome.status).toBe('ambiguous');
    expect(outcome.receipt).toBe(cancelling);
    expect(outcome.suspects).toEqual([0, 1]);
  });

  it('can only check the lines when the TOTAL was not read, and then cannot tell which number is wrong', () => {
    const noTotal = receipt([{ unitPriceBani: 918, lineTotalBani: 910 }], 0);
    const outcome = repairDigits(noTotal);

    expect(outcome.status).toBe('ambiguous');
    expect(outcome.receipt).toBe(noTotal);
    expect(outcome.suspects).toEqual([0]);
  });

  it('gives up on a receipt with an absurd number of lines instead of searching', () => {
    const huge = receipt(
      Array.from({ length: 200 }, () => ({ lineTotalBani: 1050 })),
      1,
    );
    const started = Date.now();

    expect(repairDigits(huge).status).toBe('unrepairable');
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('repairReceipt', () => {
  it('appends a REPAIRED_DIGITS warning on the line it changed, and says what changed', () => {
    const misread = receipt([
      { qty: 1, unitPriceBani: 918, lineTotalBani: 910, rawName: 'Smantana 30%' },
    ]);
    const repaired = repairReceipt(misread);

    expect(repaired.meta.warnings).toHaveLength(1);
    expect(repaired.meta.warnings[0]).toMatchObject({ code: 'REPAIRED_DIGITS', lineIdx: 0 });
    expect(repaired.meta.warnings[0]?.message).toContain('Smantana 30%');
    expect(repaired.meta.warnings[0]?.message).toContain('9,18 → 9,10');
    expect(ParsedReceiptSchema.safeParse(repaired).success).toBe(true);
  });

  it('puts a correction of the receipt total on the receipt, not on a line', () => {
    const repaired = repairReceipt(receipt([{ lineTotalBani: 599 }, { lineTotalBani: 349 }], 940));

    expect(repaired.meta.warnings).toHaveLength(1);
    expect(repaired.meta.warnings[0]?.code).toBe('REPAIRED_DIGITS');
    expect(repaired.meta.warnings[0]?.lineIdx).toBeUndefined();
    expect(repaired.meta.warnings[0]?.message).toContain('totalul bonului 9,40 → 9,48');
  });

  it('marks the candidate lines LOW_CONFIDENCE (and changes nothing) when it cannot choose', () => {
    const misread = receipt([{ lineTotalBani: 1050 }, { lineTotalBani: 2030 }], 3088);
    const result = repairReceipt(misread);

    expect(result.lines).toEqual(misread.lines);
    expect(result.meta.warnings.map((warning) => [warning.code, warning.lineIdx])).toEqual([
      ['LOW_CONFIDENCE', 0],
      ['LOW_CONFIDENCE', 1],
    ]);
  });

  it('returns the very same receipt when there is nothing to say', () => {
    const good = receipt([{ lineTotalBani: 599 }]);
    const lost = receipt([{ lineTotalBani: 1793 }, { lineTotalBani: 1499 }], 3298);

    expect(repairReceipt(good)).toBe(good);
    expect(repairReceipt(lost)).toBe(lost);
  });

  it('describes a repair in Romanian for the review screen', () => {
    const outcome = repairDigits(receipt([{ qty: 7, unitPriceBani: 405, lineTotalBani: 405 }]));

    expect(repairWarnings(outcome)[0]?.message).toContain('cantitatea 7 → 1');
  });
});

// --- Property-based tests -------------------------------------------------------------------

/** Digits that OCR confuses, written out here independently of the implementation. */
const CONFUSED: Record<string, string> = {
  '0': '8',
  '8': '0',
  '5': '69',
  '6': '59',
  '9': '56',
  '1': '7',
  '7': '1',
};

interface Cell {
  /** Where the number lives. */
  at: { line: number; field: 'qty' | 'unit' | 'total' } | { grand: true };
  value: number;
  width: number;
}

const cellsOf = (source: ParsedReceipt): Cell[] => [
  ...source.lines.flatMap((line, index): Cell[] => [
    { at: { line: index, field: 'qty' }, value: Math.round(line.qty * 1000), width: 4 },
    ...(line.unitPriceBani === undefined
      ? []
      : [{ at: { line: index, field: 'unit' as const }, value: line.unitPriceBani, width: 3 }]),
    { at: { line: index, field: 'total' }, value: line.lineTotalBani, width: 3 },
  ]),
  { at: { grand: true }, value: source.totals.grandTotalBani, width: 3 },
];

function withCell(source: ParsedReceipt, cell: Cell, value: number): ParsedReceipt {
  if ('grand' in cell.at) {
    return { ...source, totals: { ...source.totals, grandTotalBani: value } };
  }
  const { line: position, field } = cell.at;
  return {
    ...source,
    lines: source.lines.map((line, index) =>
      index !== position
        ? line
        : field === 'qty'
          ? { ...line, qty: value / 1000 }
          : field === 'unit'
            ? { ...line, unitPriceBani: value }
            : { ...line, lineTotalBani: value },
    ),
  };
}

/**
 * The receipt with ONE digit of one number replaced by a digit it is confused with; `undefined` if
 * the number has none. A leading digit never becomes 0 (8007 -> 0007): that loses a digit instead
 * of misreading one, and no receipt prints 00,07.
 */
function misreadOneDigit(source: ParsedReceipt, pick: number, which: number) {
  const candidates = cellsOf(source).flatMap((cell) => {
    const digits = String(cell.value).padStart(cell.width, '0');
    return [...digits].flatMap((digit, position) =>
      [...(CONFUSED[digit] ?? '')]
        .filter(
          (replacement) => !(position === 0 && replacement === '0' && digits.length > cell.width),
        )
        .map((replacement) => ({
          cell,
          value: Number(`${digits.slice(0, position)}${replacement}${digits.slice(position + 1)}`),
        })),
    );
  });
  const chosen = candidates[(pick * 7919 + which) % Math.max(candidates.length, 1)];
  return chosen && withCell(source, chosen.cell, chosen.value);
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b)))
      : inner,
  );

const lineArb: fc.Arbitrary<LineSpec> = fc.oneof(
  // sold with a printed unit price: the total follows from it
  fc
    .tuple(
      fc.oneof(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 120, max: 3000 }).map((g) => g / 1000),
      ),
      fc.integer({ min: 100, max: 20_000 }),
    )
    .map(([qty, unitPriceBani]) => ({
      qty,
      qtyUnit: Number.isInteger(qty) ? ('buc' as const) : ('kg' as const),
      unitPriceBani,
      lineTotalBani: mulDiv(Math.round(qty * 1000), unitPriceBani, 1000),
    })),
  // no unit price printed
  fc.integer({ min: 25, max: 30_000 }).map((lineTotalBani) => ({ lineTotalBani })),
);

const specsArb = (max: number) => fc.array(lineArb, { minLength: 1, maxLength: max });

/** A receipt that adds up exactly, with or without unit prices. */
const exactReceiptArb = (max = 8) => specsArb(max).map((specs) => receipt(specs));

/** A receipt whose every line prints a unit price (the Lidl layout). */
const pricedReceiptArb = fc
  .array(
    fc
      .tuple(fc.integer({ min: 1, max: 6 }), fc.integer({ min: 100, max: 20_000 }))
      .map(([qty, unitPriceBani]) => ({
        qty,
        unitPriceBani,
        lineTotalBani: qty * unitPriceBani,
      })),
    { minLength: 1, maxLength: 8 },
  )
  .map((specs) => receipt(specs));

describe('repairDigits (properties)', () => {
  it('never changes a receipt that already validates, and says so', () => {
    const validArb = fc
      .tuple(specsArb(10), fc.integer({ min: -5, max: 5 }))
      .map(([specs, drift]) => {
        const exact = receipt(specs);
        return receipt(specs, exact.totals.grandTotalBani + drift);
      });

    fc.assert(
      fc.property(validArb, (valid) => {
        // by construction: no SUM_MISMATCH, no LINE_ARITHMETIC
        expect(checkSumMismatch(valid)).toEqual([]);
        expect(checkLineArithmetic(valid)).toEqual([]);

        const outcome = repairDigits(valid);
        expect(outcome.status).toBe('valid');
        expect(outcome.receipt).toBe(valid);
        expect(outcome.corrections).toEqual([]);
        expect(repairReceipt(valid)).toBe(valid);
      }),
      { numRuns: 300 },
    );
  });

  it('turns one misread digit back into the original, or declines: it never invents a third receipt', () => {
    fc.assert(
      fc.property(exactReceiptArb(), fc.nat(), fc.nat(), (original, pick, which) => {
        const misread = misreadOneDigit(original, pick, which);
        fc.pre(misread !== undefined);
        if (!misread) return;

        const outcome = repairDigits(misread);
        if (outcome.status === 'repaired') {
          expect(canonical(outcome.receipt)).toBe(canonical(original));
        } else {
          expect(outcome.receipt).toBe(misread);
          expect(outcome.corrections).toEqual([]);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('restores a misread digit in most receipts that print a unit price on every line', () => {
    const samples = fc.sample(fc.tuple(pricedReceiptArb, fc.nat(), fc.nat()), {
      numRuns: 300,
      seed: 20_261_120,
    });
    let misreads = 0;
    let restored = 0;
    for (const [original, pick, which] of samples) {
      const misread = misreadOneDigit(original, pick, which);
      if (!misread || validateReceipt(misread, { now: NOW }).length === 0) continue;
      misreads++;
      const outcome = repairDigits(misread);
      if (outcome.status === 'repaired' && canonical(outcome.receipt) === canonical(original)) {
        restored++;
      }
    }

    expect(misreads).toBeGreaterThan(200);
    expect(restored / misreads).toBeGreaterThan(0.9);
  });

  it('only ever applies confusable digits, within the limit, and the result adds up', () => {
    // up to three misreads, or plain noise in a number: whatever comes out of a repair must pass
    // the checks, differ from the input in at most MAX_CORRECTIONS numbers and only by confusable digits
    const noisyArb = fc
      .tuple(
        exactReceiptArb(),
        fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean(), fc.integer({ min: 1, max: 60_000 })), {
          maxLength: 3,
        }),
      )
      .map(([original, edits]) => {
        let current = original;
        for (const [pick, which, noise, noiseValue] of edits) {
          const cells = cellsOf(current);
          const cell = cells[pick % cells.length];
          if (!cell) continue;
          const next = noise
            ? withCell(current, cell, noiseValue)
            : misreadOneDigit(current, pick, which);
          current = next ?? current;
        }
        return current;
      });

    fc.assert(
      fc.property(noisyArb, (input) => {
        const outcome = repairDigits(input);
        if (outcome.status !== 'repaired') {
          expect(outcome.receipt).toBe(input);
          expect(outcome.corrections).toEqual([]);
          return;
        }

        expect(checkSumMismatch(outcome.receipt)).toEqual([]);
        expect(checkLineArithmetic(outcome.receipt)).toEqual([]);
        expect(outcome.corrections.length).toBeGreaterThan(0);
        expect(outcome.corrections.length).toBeLessThanOrEqual(MAX_CORRECTIONS);

        const before = cellsOf(input);
        const after = cellsOf(outcome.receipt);
        const changed = before.flatMap((cell, index) => {
          const now = after[index];
          return now && now.value !== cell.value ? [{ cell, now }] : [];
        });
        expect(changed).toHaveLength(outcome.corrections.length);
        for (const { cell, now } of changed) {
          const a = String(cell.value).padStart(cell.width, '0');
          const b = String(now.value).padStart(cell.width, '0');
          expect(b).toHaveLength(a.length);
          [...a].forEach((digit, position) => {
            if (digit !== b[position]) expect(CONFUSED[digit]).toContain(b[position]);
          });
        }

        // a repair is final: there is nothing left to repair
        expect(repairDigits(outcome.receipt).status).toBe('valid');
        expect(ParsedReceiptSchema.safeParse(repairReceipt(input)).success).toBe(true);
      }),
      { numRuns: 400 },
    );
  });
});
