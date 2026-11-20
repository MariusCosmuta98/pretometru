import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ParsedLine, type ParsedReceipt } from '@/domain';
import { makeParsedLine, makeParsedReceipt } from './testing';
import {
  checkFutureDate,
  checkLineArithmetic,
  checkMissingDate,
  checkMissingTotal,
  checkSumMismatch,
  checkVatTotals,
  expectedLineTotal,
  validateReceipt,
} from './validate';

const NOW = new Date('2026-11-20T12:00:00Z'); // 14:00 in Bucharest

const codes = (warnings: { code: string }[]) => warnings.map((warning) => warning.code);

// Synthetic Kaufland-style receipt: multi-quantity, weighed, deposit and bag lines, a VAT table.
function kaufland(): ParsedReceipt {
  return makeParsedReceipt({
    totals: {
      grandTotalBani: 4265,
      voucherBani: 100,
      paidBani: 4165,
      vat: [
        { rate: 21, grossBani: 1866, netBani: 1542, vatBani: 324 },
        { rate: 11, grossBani: 2299, netBani: 2071, vatBani: 228 },
        { rate: 0, grossBani: 100, netBani: 100, vatBani: 0 },
      ],
    },
    lines: [
      makeParsedLine({
        idx: 0,
        rawName: 'LAPTE UHT 1L',
        qty: 3,
        unitPriceBani: 599,
        lineTotalBani: 1797,
        vatRate: 21,
        vatClass: 'B',
        pack: { qty: 1, unit: 'l' },
      }),
      makeParsedLine({
        idx: 1,
        rawName: 'PULPE PUI',
        qty: 0.92,
        qtyUnit: 'kg',
        unitPriceBani: 2499,
        lineTotalBani: 2299,
        vatRate: 11,
        vatClass: 'C',
      }),
      makeParsedLine({
        idx: 2,
        rawName: 'GARANTIE AMBALAJ',
        kind: 'deposit',
        qty: 2,
        unitPriceBani: 50,
        lineTotalBani: 100,
        vatRate: 0,
        vatClass: 'D',
      }),
      makeParsedLine({
        idx: 3,
        rawName: 'PUNGA BIO',
        kind: 'bag',
        lineTotalBani: 69,
        vatRate: 21,
        vatClass: 'B',
      }),
    ],
  });
}

describe('validateReceipt', () => {
  it('is silent on a consistent receipt', () => {
    const receipt = kaufland();
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(validateReceipt(receipt, { now: NOW })).toEqual([]);
  });

  it('accepts a truncated EAN as printed', () => {
    const receipt = kaufland();
    receipt.lines[0] = { ...receipt.lines[0]!, ean: '594879' };
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(validateReceipt(receipt, { now: NOW })).toEqual([]);
  });

  it('reports every failing check, document-level ones in a stable order', () => {
    const receipt = makeParsedReceipt({
      purchasedAt: '2026-12-29T10:00',
      totals: { grandTotalBani: 1000 },
      lines: [makeParsedLine({ qty: 2, unitPriceBani: 599, lineTotalBani: 500 })],
    });
    expect(codes(validateReceipt(receipt, { now: NOW }))).toEqual([
      'SUM_MISMATCH',
      'LINE_ARITHMETIC',
      'FUTURE_DATE',
    ]);
  });

  it('never throws, whatever a broken parser produced', () => {
    const receipt = makeParsedReceipt({
      purchasedAt: 'not a date',
      totals: { grandTotalBani: NaN, vat: [{ rate: NaN, grossBani: Infinity }, { rate: -100 }] },
      lines: [
        makeParsedLine({ qty: 1e9, unitPriceBani: 1e9, lineTotalBani: NaN, vatRate: -100 }),
        makeParsedLine({ idx: 1, qty: 0, unitPriceBani: 1.5, discountBani: 0.5 }),
      ],
    });
    expect(() => validateReceipt(receipt, { now: new Date(NaN) })).not.toThrow();
  });
});

describe('checkSumMismatch', () => {
  const withSum = (sumBani: number) =>
    makeParsedReceipt({
      totals: { grandTotalBani: 1000 },
      lines: [makeParsedLine({ lineTotalBani: sumBani })],
    });

  it('tolerates up to 5 bani between the lines and the printed total', () => {
    expect(checkSumMismatch(withSum(1005))).toEqual([]);
    expect(checkSumMismatch(withSum(995))).toEqual([]);
    expect(codes(checkSumMismatch(withSum(1006)))).toEqual(['SUM_MISMATCH']);
    expect(codes(checkSumMismatch(withSum(994)))).toEqual(['SUM_MISMATCH']);
  });

  it('puts the amounts in the message', () => {
    const [warning] = checkSumMismatch(withSum(1150));
    expect(warning?.message).toContain('11,50 lei');
    expect(warning?.message).toContain('10,00 lei');
  });

  it('counts every kind of line, including standalone discounts', () => {
    const receipt = makeParsedReceipt({
      totals: { grandTotalBani: 1100 },
      lines: [
        makeParsedLine({ idx: 0, lineTotalBani: 1000 }),
        makeParsedLine({ idx: 1, rawName: 'PUNGA', kind: 'bag', lineTotalBani: 50 }),
        makeParsedLine({ idx: 2, rawName: 'GARANTIE', kind: 'deposit', lineTotalBani: 50 }),
        makeParsedLine({ idx: 3, rawName: 'CUPON', kind: 'discount', lineTotalBani: -150 }),
        makeParsedLine({ idx: 4, rawName: 'COMISION', kind: 'fee', lineTotalBani: 150 }),
      ],
    });
    expect(checkSumMismatch(receipt)).toEqual([]);
  });

  it('checks that the paid amount is the total minus the voucher', () => {
    const receipt = (paidBani: number) =>
      makeParsedReceipt({
        totals: { grandTotalBani: 599, voucherBani: 100, paidBani },
      });
    expect(checkSumMismatch(receipt(499))).toEqual([]);
    expect(codes(checkSumMismatch(receipt(599)))).toEqual(['SUM_MISMATCH']);
  });

  it('leaves a missing total to checkMissingTotal', () => {
    const receipt = makeParsedReceipt({ totals: { grandTotalBani: 0 } });
    expect(checkSumMismatch(receipt)).toEqual([]);
  });
});

describe('checkMissingTotal', () => {
  it.each([
    ['a total that is not an amount', NaN, [makeParsedLine()]],
    ['a total of 0 over priced lines', 0, [makeParsedLine()]],
    ['no lines and no total', 0, []],
  ])('flags %s', (_name, grandTotalBani, lines) => {
    const receipt = makeParsedReceipt({ totals: { grandTotalBani }, lines });
    expect(codes(checkMissingTotal(receipt))).toEqual(['MISSING_TOTAL']);
  });

  it('accepts a real zero total (every line is free)', () => {
    const receipt = makeParsedReceipt({
      totals: { grandTotalBani: 0 },
      lines: [makeParsedLine({ lineTotalBani: 0 })],
    });
    expect(checkMissingTotal(receipt)).toEqual([]);
  });

  it('is the only warning about the total when it is missing', () => {
    const receipt = makeParsedReceipt({ totals: { grandTotalBani: 0 } });
    expect(codes(validateReceipt(receipt, { now: NOW }))).toEqual(['MISSING_TOTAL']);
  });
});

describe('checkLineArithmetic', () => {
  const lineWarnings = (...overrides: Partial<ParsedLine>[]) =>
    checkLineArithmetic(
      makeParsedReceipt({ lines: overrides.map((o, idx) => makeParsedLine({ idx, ...o })) }),
    );

  it('multiplies a weighed quantity by the price per kg', () => {
    // 0,574 kg x 8,99 = 5,16026 -> 5,16
    expect(
      lineWarnings({ qty: 0.574, qtyUnit: 'kg', unitPriceBani: 899, lineTotalBani: 516 }),
    ).toEqual([]);
    const [warning] = lineWarnings({
      qty: 0.574,
      qtyUnit: 'kg',
      unitPriceBani: 899,
      lineTotalBani: 561,
    });
    expect(warning).toMatchObject({ code: 'LINE_ARITHMETIC', lineIdx: 0 });
  });

  it('subtracts the discount folded into the line', () => {
    const base = { qty: 2, unitPriceBani: 1519, discountBani: 380 };
    expect(lineWarnings({ ...base, lineTotalBani: 2658 })).toEqual([]);
    expect(codes(lineWarnings({ ...base, lineTotalBani: 3038 }))).toEqual(['LINE_ARITHMETIC']);
  });

  it('allows 1 ban between the printed total and quantity x unit price', () => {
    const at = (qty: number, drift: number) =>
      lineWarnings({ qty, unitPriceBani: 1000, lineTotalBani: qty * 1000 + drift });
    expect(at(1, 1)).toEqual([]);
    expect(at(6, -1)).toEqual([]);
    expect(codes(at(1, 2))).toEqual(['LINE_ARITHMETIC']);
    expect(codes(at(6, 2))).toEqual(['LINE_ARITHMETIC']);
  });

  it('skips lines without a printed unit price', () => {
    expect(lineWarnings({ qty: 3, lineTotalBani: 1 })).toEqual([]);
  });

  it('points at the line by idx, not by position', () => {
    const receipt = makeParsedReceipt({
      lines: [
        makeParsedLine({ idx: 4 }),
        makeParsedLine({ idx: 9, qty: 2, unitPriceBani: 100, lineTotalBani: 500 }),
      ],
    });
    expect(checkLineArithmetic(receipt)).toMatchObject([{ lineIdx: 9 }]);
  });

  it('exposes the expected total for reuse', () => {
    const line = makeParsedLine({ qty: 3, unitPriceBani: 499, discountBani: 302 });
    expect(expectedLineTotal(line)).toBe(1195);
    expect(expectedLineTotal(makeParsedLine())).toBeUndefined();
  });
});

describe('checkVatTotals', () => {
  it('accepts a table that matches the lines of every rate', () => {
    expect(checkVatTotals(kaufland())).toEqual([]);
  });

  it('does nothing without a printed table', () => {
    const receipt = kaufland();
    delete receipt.totals.vat;
    expect(checkVatTotals(receipt)).toEqual([]);
  });

  // METRO: the lines hold per-line VAT-inclusive totals, the table is rounded once per rate.
  const metro = (printedGross: number) =>
    makeParsedReceipt({
      totals: {
        grandTotalBani: 23973,
        vat: [{ rate: 21, netBani: 19812, vatBani: 4161, grossBani: printedGross }],
      },
      lines: [
        makeParsedLine({ idx: 0, lineTotalBani: 11994, vatRate: 21 }),
        makeParsedLine({ idx: 1, lineTotalBani: 11980, vatRate: 21 }),
      ],
    });

  it('tolerates the per-rate rounding difference of 1 ban', () => {
    expect(checkVatTotals(metro(23973))).toEqual([]);
  });

  it('flags a rate whose lines differ from the printed total by more than 5 bani', () => {
    const [warning] = checkVatTotals(metro(23967));
    expect(warning).toMatchObject({ code: 'VAT_MISMATCH' });
    expect(warning?.message).toContain('21%');
  });

  it('flags a printed rate that no line carries', () => {
    const receipt = kaufland();
    receipt.totals.vat = [...(receipt.totals.vat ?? []), { rate: 9, grossBani: 500 }];
    expect(codes(checkVatTotals(receipt))).toEqual(['VAT_MISMATCH']);
  });

  it('flags a line rate that is missing from the printed table', () => {
    const receipt = kaufland();
    receipt.totals.vat = receipt.totals.vat?.filter((entry) => entry.rate !== 11);
    expect(codes(checkVatTotals(receipt))).toEqual(['VAT_MISMATCH']);
  });

  it('flags a printed table that contradicts itself', () => {
    const baseAndVat = kaufland();
    baseAndVat.totals.vat = [{ rate: 21, grossBani: 1866, netBani: 1542, vatBani: 400 }];
    baseAndVat.lines = baseAndVat.lines.filter((line) => line.vatRate === 21);
    expect(checkVatTotals(baseAndVat).length).toBeGreaterThan(0);

    const rate = kaufland();
    rate.totals.vat = [{ rate: 11, grossBani: 2299, vatBani: 500 }];
    rate.lines = rate.lines.filter((line) => line.vatRate === 11);
    expect(codes(checkVatTotals(rate))).toEqual(['VAT_MISMATCH']);
  });

  it('compares the VAT amount alone when no gross was printed', () => {
    const receipt = kaufland();
    receipt.totals.vat = [
      { rate: 21, vatBani: 324 },
      { rate: 11, vatBani: 228 },
      { rate: 0, vatBani: 0 },
    ];
    expect(checkVatTotals(receipt)).toEqual([]);
    receipt.totals.vat[0] = { rate: 21, vatBani: 1000 };
    expect(codes(checkVatTotals(receipt))).toEqual(['VAT_MISMATCH']);
  });

  it('does not compare lines that do not all carry a rate', () => {
    const receipt = kaufland();
    delete receipt.lines[0]!.vatRate;
    expect(checkVatTotals(receipt)).toEqual([]);
  });
});

describe('checkMissingDate', () => {
  it('flags an absent date and one that is not a calendar date', () => {
    const absent = makeParsedReceipt();
    delete absent.purchasedAt;
    expect(codes(checkMissingDate(absent))).toEqual(['MISSING_DATE']);
    expect(codes(checkMissingDate(makeParsedReceipt({ purchasedAt: '2026-02-30' })))).toEqual([
      'MISSING_DATE',
    ]);
    expect(checkMissingDate(makeParsedReceipt({ purchasedAt: '2026-11-07' }))).toEqual([]);
  });
});

describe('checkFutureDate', () => {
  const at = (purchasedAt: string, now = NOW) =>
    checkFutureDate(makeParsedReceipt({ purchasedAt }), now);

  it('flags the Lidl sample, dated 29.12.2026, against a clock set on 19.11.2026', () => {
    const [warning] = at('2026-12-29T10:15', new Date('2026-11-19T10:00:00Z'));
    expect(warning).toMatchObject({ code: 'FUTURE_DATE' });
    expect(warning?.message).toContain('29.12.2026 10:15');
    expect(at('2026-12-29T10:15', new Date('2026-12-30T10:00:00Z'))).toEqual([]);
  });

  it('compares the day for a date-only receipt and the time within today', () => {
    expect(at('2026-11-20')).toEqual([]);
    expect(codes(at('2026-11-21'))).toEqual(['FUTURE_DATE']);
    expect(at('2026-11-20T13:59')).toEqual([]);
    expect(codes(at('2026-11-20T14:01'))).toEqual(['FUTURE_DATE']);
  });

  it('reads "today" in Bucharest, not in UTC', () => {
    const justAfterMidnightLocal = new Date('2026-11-19T22:30:00Z'); // 20.11 00:30 in Bucharest
    expect(at('2026-11-20', justAfterMidnightLocal)).toEqual([]);
    expect(codes(at('2026-11-21', justAfterMidnightLocal))).toEqual(['FUTURE_DATE']);
  });

  it('skips a missing date', () => {
    const receipt = makeParsedReceipt();
    delete receipt.purchasedAt;
    expect(checkFutureDate(receipt, NOW)).toEqual([]);
  });
});
