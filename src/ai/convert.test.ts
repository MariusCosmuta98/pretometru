import { fixtures, normalizeForGolden } from '@fixtures';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, SemverSchema, type ParsedReceipt } from '@/domain';
import { AiError } from './errors';
import { convertAnswer, MAX_ANSWER_CHARS, MAX_LINES, UNNAMED_LINE } from './convert';
import { answerFromReceipt, TEST_NOW } from './testing';

const MODEL = 'gemini-test-model';

/** A matcher that is a string to the type checker (`expect.stringContaining` is `any`). */
const containing = (text: string): string => expect.stringContaining(text) as string;

/** A header that raises no warning, so a test sees only the warnings it provokes. */
const HEADER = { chain: 'kaufland', purchasedAt: '2026-11-07T18:31:47' };

/** A small receipt that adds up: 2 x 5.99 + a weighed item = 34.97. */
const GOOD = {
  store: 'KAUFLAND',
  ...HEADER,
  documentType: 'receipt',
  lines: [
    { name: 'LAPTE UHT 1,5% 1L', quantity: 2, unit: 'buc', unitPrice: 5.99, total: 11.98 },
    { name: 'PULPE PUI', quantity: 0.92, unit: 'kg', total: 22.99 },
  ],
  total: 34.97,
};

function convert(answer: unknown, now = TEST_NOW): ParsedReceipt {
  return convertAnswer(typeof answer === 'string' ? answer : JSON.stringify(answer), {
    model: MODEL,
    now,
  });
}

function failure(answer: unknown): AiError {
  try {
    convert(answer);
  } catch (error) {
    if (error instanceof AiError) return error;
    throw error;
  }
  throw new Error('The answer was accepted');
}

const codes = (receipt: ParsedReceipt) =>
  receipt.meta.warnings.map((warning) => `${warning.code}${warning.lineIdx ?? ''}`).sort();

/** What an AI reading does not carry: VAT, section headers (and the printed VAT class). */
function withoutUnread(receipt: ParsedReceipt) {
  const normalized = normalizeForGolden(receipt);
  return {
    ...normalized,
    totals: { ...normalized.totals, vat: undefined },
    lines: normalized.lines.map((line) => ({
      ...line,
      vatRate: undefined,
      vatClass: undefined,
      storeCategoryHint: undefined,
    })),
    meta: {
      ...normalized.meta,
      warnings: normalized.meta.warnings.filter((w) => w.code !== 'VAT_MISMATCH'),
    },
  };
}

describe('the ground truth of every fixture, as a perfect model would answer it', () => {
  for (const fixture of fixtures) {
    it(`${fixture.id} comes back as the same receipt, with the same warnings`, () => {
      const reading = convertAnswer(answerFromReceipt(fixture.expected), {
        model: MODEL,
        now: new Date(fixture.now),
      });

      expect(reading.meta.engine).toBe('gemini');
      expect(reading.meta.parser).toBe(MODEL);
      expect(SemverSchema.safeParse(reading.meta.parserVersion).success).toBe(true);
      expect(withoutUnread(reading)).toEqual(withoutUnread(fixture.expected));
    });
  }
});

describe('a reading that is right', () => {
  it('converts amounts to bani, derives the size from the name and finishes like any engine', () => {
    const receipt = convert(GOOD);
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.totals.grandTotalBani).toBe(3497);
    expect(receipt.lines).toEqual([
      {
        idx: 0,
        rawName: 'LAPTE UHT 1,5% 1L',
        kind: 'product',
        qty: 2,
        qtyUnit: 'buc',
        unitPriceBani: 599,
        lineTotalBani: 1198,
        pack: { qty: 1, unit: 'l' },
      },
      {
        idx: 1,
        rawName: 'PULPE PUI',
        kind: 'product',
        qty: 0.92,
        qtyUnit: 'kg',
        lineTotalBani: 2299,
      },
    ]);
    expect(receipt.meta.warnings).toEqual([]);
  });

  it('accepts one markdown fence around the JSON', () => {
    expect(convert(`\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\``).lines).toHaveLength(2);
  });

  it('puts a wrong reading where the review shows it: the arithmetic warnings', () => {
    const receipt = convert({
      ...GOOD,
      lines: [
        { name: 'LAPTE UHT 1L', quantity: 2, unitPrice: 5.99, total: 12.89 },
        { name: 'PAINE', total: 3 },
      ],
      total: 40,
    });
    expect(codes(receipt)).toEqual(['LINE_ARITHMETIC0', 'SUM_MISMATCH']);
  });

  it('adds what validation finds in the header: no date, a date in the future, an unknown chain', () => {
    expect(codes(convert({ ...GOOD, purchasedAt: undefined }))).toEqual(['MISSING_DATE']);
    expect(codes(convert({ ...GOOD, purchasedAt: '2026-12-29' }))).toEqual(['FUTURE_DATE']);
    expect(codes(convert({ ...GOOD, chain: 'unknown' }))).toEqual(['UNKNOWN_CHAIN']);
    expect(convert({ ...GOOD, chain: 'walmart' }).chain).toBe('unknown');
  });

  it('derives a voucher from a paid amount below the total', () => {
    const receipt = convert({ ...GOOD, paid: 32.97 });
    expect(receipt.totals).toEqual({ grandTotalBani: 3497, voucherBani: 200, paidBani: 3297 });
  });

  it('flags a row the model was unsure about, on that row', () => {
    const receipt = convert({
      ...GOOD,
      lines: [{ ...GOOD.lines[0], uncertain: true }, GOOD.lines[1]],
    });
    expect(receipt.meta.warnings).toEqual([
      expect.objectContaining({ code: 'LOW_CONFIDENCE', lineIdx: 0 }),
    ]);
  });
});

describe('an answer that is not an answer', () => {
  it('refuses what is not JSON of the asked shape', () => {
    for (const bad of [
      'I cannot read this image.',
      '',
      '[]',
      'null',
      '42',
      '"lines"',
      '{}',
      '{"lines": "x"}',
      '{"lines": {}}',
    ]) {
      expect(failure(bad).code, bad).toBe('MALFORMED');
    }
  });

  it('refuses an answer too long to be one, without parsing it', () => {
    expect(failure(`{"lines":[],"x":"${'a'.repeat(MAX_ANSWER_CHARS)}"}`).code).toBe('MALFORMED');
  });

  it('tells "found nothing" from "broken": no line, or no line that can be used', () => {
    expect(failure({ lines: [] }).code).toBe('NO_LINES');
    expect(failure({ lines: [null, {}, { name: '', total: 0 }] }).code).toBe('MALFORMED');
    expect(failure({ lines: [{ name: 'X', total: 'abc' }] }).code).toBe('MALFORMED');
  });

  it('refuses a looping model: more rows than any receipt has', () => {
    const row = { name: 'PAINE', total: 1 };
    expect(
      convert({ lines: Array.from({ length: MAX_LINES }, () => row), total: MAX_LINES }).lines,
    ).toHaveLength(MAX_LINES);
    expect(failure({ lines: Array.from({ length: MAX_LINES + 1 }, () => row) }).code).toBe(
      'MALFORMED',
    );
  });
});

describe('hostile values cannot corrupt a reading', () => {
  it('takes strings for numbers only when they are exactly an amount', () => {
    const receipt = convert({
      ...HEADER,
      lines: [
        { name: 'A', quantity: '2', unitPrice: '1.50', total: '3.00' },
        { name: 'B', total: '4,50' },
        { name: 'C', total: '1e2' },
        { name: 'D', total: 'NaN' },
        { name: 'E', total: ' 5.5 ' },
      ],
      total: '8.5',
    });
    expect(receipt.lines.map((line) => [line.rawName, line.lineTotalBani, line.qty])).toEqual([
      ['A', 300, 2],
      ['E', 550, 1],
    ]);
    expect(receipt.totals.grandTotalBani).toBe(850);
    // Three rows were dropped and the review is told, once.
    expect(receipt.meta.warnings).toEqual([
      expect.objectContaining({
        code: 'LOW_CONFIDENCE',
        message: containing('3 linii'),
      }),
    ]);
  });

  it('never passes on a field outside the schema, whatever it is called', () => {
    const answer = JSON.parse(
      `{"__proto__": {"polluted": true}, "constructor": {"x": 1}, "status": "confirmed", "id": "01ABC", "storeId": "s1",
        "lines": [{"name": "PAINE", "total": 3, "id": "x", "receiptId": "r", "productId": "p", "categoryId": "c", "status": "confirmed", "deletedAt": "2020-01-01T00:00:00.000Z"}],
        "total": 3, "meta": {"engine": "pdfjs"}, "warnings": []}`,
    ) as unknown;
    const receipt = convert(answer);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.keys(receipt).sort()).toEqual(
      ['chain', 'currency', 'docType', 'lines', 'meta', 'schemaVersion', 'totals'].sort(),
    );
    expect(Object.keys(receipt.lines[0] ?? {}).sort()).toEqual(
      ['idx', 'kind', 'lineTotalBani', 'qty', 'qtyUnit', 'rawName'].sort(),
    );
    expect(receipt.meta.engine).toBe('gemini');
    expect(receipt.meta.warnings).toEqual([
      expect.objectContaining({ code: 'UNKNOWN_CHAIN' }),
      expect.objectContaining({ code: 'MISSING_DATE' }),
    ]);
  });

  it('drops a row with a huge amount and ignores a huge or negative total', () => {
    const huge = convert({
      lines: [GOOD.lines[0], { name: 'X', total: 1e12 }, { name: 'Y', total: '10000000.01' }],
      total: 1e12,
    });
    expect(huge.lines.map((line) => line.rawName)).toEqual(['LAPTE UHT 1,5% 1L']);
    expect(codes(huge)).toContain('MISSING_TOTAL');

    const negative = convert({ ...GOOD, total: -34.97, paid: -1 });
    expect(negative.totals).toEqual({ grandTotalBani: 0 });
    expect(codes(negative)).toContain('MISSING_TOTAL');
  });

  it('treats a negative product as a discount row and flags a discount that adds money', () => {
    const receipt = convert({
      lines: [
        { name: 'PAINE', total: 4 },
        { name: 'REDUCERE', kind: 'product', total: -1 },
        { name: 'CUPON', kind: 'discount', total: 2 },
      ],
      total: 5,
    });
    expect(receipt.lines.map((line) => line.kind)).toEqual(['product', 'discount', 'discount']);
    expect(receipt.meta.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'LOW_CONFIDENCE', lineIdx: 2 })]),
    );
  });

  it('keeps the name and the sign in charge of what a row is, whatever the model says', () => {
    const receipt = convert({
      lines: [
        { name: 'GARANTIE AMBALAJ', kind: 'product', total: 0.5 },
        { name: 'PUNGA BIO', kind: 'product', total: 0.7 },
        { name: 'TAXA VERDE', kind: 'fee', total: 0.1 },
        { name: 'FOO', kind: 'gift', total: 1 },
      ],
      total: 2.3,
    });
    expect(receipt.lines.map((line) => line.kind)).toEqual(['deposit', 'bag', 'fee', 'product']);
  });

  it('skips empty rows without a word and keeps the numbering of the rest', () => {
    const receipt = convert({
      ...HEADER,
      lines: [
        null,
        {},
        { name: '', total: 0 },
        { name: '  ' },
        GOOD.lines[0],
        undefined,
        7,
        'x',
        GOOD.lines[1],
      ],
      total: 34.97,
    });
    expect(receipt.lines.map((line) => line.idx)).toEqual([0, 1]);
    // `7` and `"x"` are not rows: they are counted, the empty ones are not.
    expect(receipt.meta.warnings).toEqual([
      expect.objectContaining({
        code: 'LOW_CONFIDENCE',
        message: containing('2 linii'),
      }),
    ]);
  });

  it('keeps a row with an amount but no name, under a placeholder the review shows', () => {
    const receipt = convert({ ...HEADER, lines: [{ name: '\u200B', total: 3.5 }], total: 3.5 });
    expect(receipt.lines[0]?.rawName).toBe(UNNAMED_LINE);
    expect(receipt.meta.warnings).toEqual([
      expect.objectContaining({ code: 'LOW_CONFIDENCE', lineIdx: 0 }),
    ]);
  });

  it('cleans text and cuts a runaway name', () => {
    const receipt = convert({
      store: '  KAUFLAND\u202E ',
      lines: [{ name: `<script>alert(1)</script>\n${'A'.repeat(5000)}`, total: 1 }],
      total: 1,
    });
    expect(receipt.storeName).toBe('KAUFLAND');
    const name = receipt.lines[0]?.rawName ?? '';
    expect(name.length).toBeLessThanOrEqual(200);
    expect(name).not.toContain('\n');
  });

  it('flags a quantity or unit it cannot use and puts the safe default, never a guess', () => {
    const receipt = convert({
      ...HEADER,
      lines: [
        { name: 'A', quantity: 0, total: 1 },
        { name: 'B', quantity: '2 buc', unit: 'bucati', total: 1 },
        { name: 'C', quantity: null, unit: null, total: 1 },
      ],
      total: 3,
    });
    expect(receipt.lines.map((line) => [line.qty, line.qtyUnit])).toEqual([
      [1, 'buc'],
      [1, 'buc'],
      [1, 'buc'],
    ]);
    expect(codes(receipt)).toEqual(['LOW_CONFIDENCE0', 'LOW_CONFIDENCE1']);
  });

  it('ignores a zero unit price (how a model says "not printed") instead of failing the arithmetic', () => {
    const receipt = convert({
      ...HEADER,
      lines: [{ name: 'A', quantity: 3, unitPrice: 0, discount: 0, total: 9 }],
      total: 9,
    });
    expect(receipt.lines[0]).not.toHaveProperty('unitPriceBani');
    expect(receipt.lines[0]).not.toHaveProperty('discountBani');
    expect(codes(receipt)).not.toContain('LINE_ARITHMETIC0');
  });

  it('drops a barcode whose check digit is wrong, flags the row, and ignores a placeholder', () => {
    const receipt = convert({
      ...HEADER,
      lines: [
        { name: 'A', ean: '5948792073283', total: 1 },
        { name: 'B', ean: '0'.repeat(13), total: 1 },
        { name: 'C', ean: '5948792073282', total: 1 },
      ],
      total: 3,
    });
    expect(receipt.lines.map((line) => line.ean)).toEqual([undefined, undefined, '5948792073282']);
    expect(codes(receipt)).toEqual(['LOW_CONFIDENCE0']);
  });

  it('ignores a date that is not one and a document type that is not a type', () => {
    const receipt = convert({ ...GOOD, purchasedAt: '2026-13-45', documentType: 'ticket' });
    expect(receipt.docType).toBe('receipt');
    expect(receipt.purchasedAt).toBeUndefined();
    expect(codes(receipt)).toEqual(['MISSING_DATE']);
  });
});

describe('whatever the model writes', () => {
  const anyJson = fc.jsonValue();
  const field = fc.oneof(anyJson, fc.constant(undefined));
  const lineArbitrary = fc.record(
    {
      name: field,
      quantity: field,
      unit: field,
      unitPrice: field,
      discount: field,
      total: fc.oneof(
        field,
        fc.double({ min: -2e7, max: 2e7 }),
        fc.integer({ min: -1e9, max: 1e9 }).map((n) => n / 100),
      ),
      kind: field,
      ean: field,
      uncertain: field,
    },
    { requiredKeys: [] },
  );
  const answerArbitrary = fc.record(
    {
      store: field,
      chain: field,
      city: field,
      storeCode: field,
      documentType: field,
      documentNumber: field,
      purchasedAt: field,
      lines: fc.oneof(fc.array(lineArbitrary, { maxLength: 12 }), anyJson),
      total: field,
      paid: field,
    },
    { requiredKeys: [] },
  );

  it('either fails with an AiError or returns a receipt that satisfies the contract', () => {
    fc.assert(
      fc.property(fc.oneof(answerArbitrary, anyJson), (answer) => {
        try {
          const receipt = convert(answer);
          expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
          expect(receipt.meta.engine).toBe('gemini');
          expect(receipt.lines.length).toBeGreaterThan(0);
        } catch (error) {
          expect(error).toBeInstanceOf(AiError);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('never shows an amount it did not read: every line total is one the answer contained', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), {
          minLength: 1,
          maxLength: 10,
        }),
        (baniList) => {
          const receipt = convert({
            lines: baniList.map((bani, index) => ({ name: `P${index}`, total: bani / 100 })),
            total: 1,
          });
          expect(receipt.lines.map((line) => line.lineTotalBani)).toEqual(baniList);
        },
      ),
    );
  });
});
