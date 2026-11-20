import { describe, expect, it } from 'vitest';
import {
  formatBani,
  isFutureDate,
  parsePackSize,
  sumBani,
  type ParsedLine,
  type ParsedReceipt,
} from '@/domain';
import {
  fixtures,
  getFixture,
  normalizeForGolden,
  sourceOf,
  type Fixture,
  type FixtureSource,
} from '@fixtures';
import { pdfRows } from '../scripts/sanitize';

// Tolerances from docs/contracts.md (warning codes).
const TOLERANCE = { sum: 5, line: 1, vat: 5 } as const;

const squash = (text: string): string => text.replace(/\s+/g, '');

function lineArithmeticOff(line: ParsedLine): boolean {
  if (line.unitPriceBani === undefined) return false;
  const total = Math.round(line.qty * line.unitPriceBani) - (line.discountBani ?? 0);
  return Math.abs(total - line.lineTotalBani) > TOLERANCE.line;
}

/** `undefined` when the per-rate check is impossible (a line has no rate). */
function vatTotalsOff(receipt: ParsedReceipt): boolean | undefined {
  const entries = receipt.totals.vat;
  if (!entries || receipt.lines.some((line) => line.vatRate === undefined)) return undefined;
  return entries.some((entry) => {
    if (entry.grossBani === undefined) return false;
    const gross = sumBani(
      receipt.lines.filter((line) => line.vatRate === entry.rate).map((line) => line.lineTotalBani),
    );
    return Math.abs(gross - entry.grossBani) > TOLERANCE.vat;
  });
}

/** Warnings that follow from the receipt itself and the clock (not from how well the text was read). */
function derivedWarnings(receipt: ParsedReceipt, now: Date): Set<string> {
  const codes = new Set<string>();
  const sum = sumBani(receipt.lines.map((line) => line.lineTotalBani));
  if (Math.abs(sum - receipt.totals.grandTotalBani) > TOLERANCE.sum) codes.add('SUM_MISMATCH');
  if (receipt.lines.some(lineArithmeticOff)) codes.add('LINE_ARITHMETIC');
  if (receipt.purchasedAt === undefined) codes.add('MISSING_DATE');
  else if (isFutureDate(receipt.purchasedAt, now)) codes.add('FUTURE_DATE');
  if (receipt.chain === 'unknown') codes.add('UNKNOWN_CHAIN');
  return codes;
}

const DERIVABLE = [
  'SUM_MISMATCH',
  'LINE_ARITHMETIC',
  'FUTURE_DATE',
  'MISSING_DATE',
  'UNKNOWN_CHAIN',
];

function hasValidGs1CheckDigit(ean: string): boolean {
  const digits = [...ean].map(Number);
  const check = digits.pop();
  const sum = digits
    .reverse()
    .reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function sourceText(source: FixtureSource): string | undefined {
  const { source: raw } = source;
  if (raw.kind === 'pdf-text') {
    return raw.pages.flatMap((page) => pdfRows(page.items).map((row) => row.text)).join('\n');
  }
  return raw.kind === 'pasted-text' ? raw.text : undefined; // raw OCR may misread names
}

const distinctReceipts = (fixture: Fixture): ParsedReceipt[] => [
  ...new Set([fixture.expected, ...fixture.sources.map((source) => source.expected)]),
];

describe.each(fixtures.map((fixture) => [fixture.id, fixture] as const))(
  'fixture %s',
  (_id, fixture) => {
    const now = new Date(fixture.now);

    it.each(distinctReceipts(fixture).map((receipt, index) => [index, receipt] as const))(
      'ground truth #%i is arithmetically consistent and declares the warnings it implies',
      (_index, receipt) => {
        const { totals } = receipt;

        if (totals.paidBani !== undefined) {
          expect(totals.paidBani).toBe(totals.grandTotalBani - (totals.voucherBani ?? 0));
        }
        for (const entry of totals.vat ?? []) {
          if (
            entry.grossBani !== undefined &&
            entry.netBani !== undefined &&
            entry.vatBani !== undefined
          ) {
            expect(Math.abs(entry.netBani + entry.vatBani - entry.grossBani)).toBeLessThanOrEqual(
              1,
            );
          }
        }

        const declared = new Set<string>(receipt.meta.warnings.map((warning) => warning.code));
        const derived = derivedWarnings(receipt, now);
        const vatOff = vatTotalsOff(receipt);
        const comparable = vatOff === undefined ? DERIVABLE : [...DERIVABLE, 'VAT_MISMATCH'];
        if (vatOff) derived.add('VAT_MISMATCH');
        for (const code of comparable) {
          expect(declared.has(code), `warning ${code}`).toBe(derived.has(code));
        }

        const offLines = receipt.lines.filter(lineArithmeticOff).map((line) => line.idx);
        const flaggedLines = receipt.meta.warnings
          .filter((warning) => warning.code === 'LINE_ARITHMETIC')
          .map((warning) => warning.lineIdx);
        expect(flaggedLines, 'lines flagged LINE_ARITHMETIC').toEqual(offLines);
      },
    );

    it('prints sizes the way parsePackSize reads them and EANs with a valid check digit', () => {
      for (const receipt of distinctReceipts(fixture)) {
        for (const line of receipt.lines) {
          const parsed = parsePackSize(line.rawName);
          const pack = parsed ? { qty: parsed.qty, unit: parsed.unit } : undefined;
          expect(line.pack, line.rawName).toEqual(pack);
          if (line.ean?.length === 13) {
            expect(hasValidGs1CheckDigit(line.ean), `EAN of ${line.rawName}`).toBe(true);
          }
        }
      }
    });

    it.each(fixture.sources.map((source) => [source.kind, source] as const))(
      'ground truth is readable in the %s source',
      (_kind, source) => {
        const text = sourceText(source);
        if (text === undefined) return;
        const haystack = squash(text);
        const { expected } = source;

        for (const line of expected.lines) {
          expect(haystack, `name "${line.rawName}"`).toContain(squash(line.rawName));
          if (line.storeCategoryHint) {
            expect(haystack, `section "${line.storeCategoryHint}"`).toContain(
              squash(line.storeCategoryHint),
            );
          }
        }
        expect(haystack).toContain(squash(formatBani(expected.totals.grandTotalBani)));
        if (expected.documentNo) expect(haystack).toContain(expected.documentNo);
      },
    );
  },
);

describe('loader', () => {
  it('gives every real case a source, while synthetic receipt-level cases may have none', () => {
    const real = fixtures.filter((fixture) => fixture.group === 'real');

    expect(real.length).toBeGreaterThan(0);
    expect(real.every((fixture) => fixture.sources.length > 0)).toBe(true);
    expect(getFixture('promo-deposit-voucher').sources).toEqual([]);
  });

  it('finds cases by id and sources by kind, and says what exists when it cannot', () => {
    const fixture = getFixture('kaufland-2026-11-07');

    expect(sourceOf(fixture, 'pdf-text').source.pages.length).toBeGreaterThan(0);
    expect(() => sourceOf(fixture, 'pasted-text')).toThrow(/has no pasted-text source.*pdf-text/);
    expect(() => getFixture('nope')).toThrow(/Available: .*kaufland-2026-11-07/);
  });
});

describe('normalizeForGolden', () => {
  const base = getFixture('kaufland-2026-11-07').expected;

  it('ignores the producer, confidences, regions, raw text and warning wording/order, nothing else', () => {
    const noisy: ParsedReceipt = {
      ...base,
      lines: base.lines.map((line) => ({
        ...line,
        confidence: 0.4,
        bbox: { x: 1, y: 2, w: 3, h: 4 },
        raw: 'whatever was printed',
      })),
      meta: {
        engine: 'pdfjs',
        parser: 'kaufland',
        parserVersion: '2.3.4',
        confidence: 0.9,
        warnings: [
          { code: 'SUM_MISMATCH', message: 'altfel' },
          { code: 'LINE_ARITHMETIC', message: 'x', lineIdx: 3 },
        ],
      },
    };
    const reordered: ParsedReceipt = {
      ...base,
      meta: {
        ...base.meta,
        warnings: [
          { code: 'LINE_ARITHMETIC', message: 'y', lineIdx: 3 },
          { code: 'SUM_MISMATCH', message: 'z' },
        ],
      },
    };

    expect(normalizeForGolden(noisy)).toEqual(normalizeForGolden(reordered));
  });

  it('still tells real differences apart', () => {
    const wrongTotal = { ...base, totals: { ...base.totals, grandTotalBani: 1 } };
    const [first, ...rest] = base.lines;
    const wrongLine = { ...base, lines: [{ ...first!, lineTotalBani: 1 }, ...rest] };

    expect(normalizeForGolden(wrongTotal)).not.toEqual(normalizeForGolden(base));
    expect(normalizeForGolden(wrongLine)).not.toEqual(normalizeForGolden(base));
  });
});
