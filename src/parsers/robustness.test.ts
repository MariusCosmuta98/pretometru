import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema } from '@/domain';
import { getFixture, sourceOf } from '@fixtures';
import { parseReceipt } from './parse-receipt';
import { parsers } from './registry';
import { pdfFromText } from './testing';

const NOW = new Date('2026-11-20T12:00:00Z');

// Amounts as printed (`15,57`): mostly plausible, sometimes values the contract rejects as runaway reads.
const wholeLei = fc.oneof(
  { weight: 9, arbitrary: fc.integer({ min: 0, max: 5_000 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: 99_999_999_999 }) },
);
const amount = fc
  .tuple(wholeLei, fc.integer({ min: 0, max: 99 }))
  .map(([whole, cents]) => `${whole},${String(cents).padStart(2, '0')}`);
const signed = fc
  .tuple(fc.boolean(), amount)
  .map(([negative, text]) => (negative ? `-${text}` : text));
const count = fc.oneof(
  fc.integer({ min: 0, max: 40 }).map(String),
  fc.constantFrom('1,250', '999999999', '0,001'),
);
const name = fc.stringMatching(/^[A-Z0-9][A-Z0-9 .%*+-]{0,18}[A-Z0-9]$/);

const kauflandRow = fc.oneof(
  fc.constantFrom('Alimente', 'Mopro/Brânză/Ouă', 'Casa mea'),
  name,
  fc
    .tuple(name, signed, fc.constantFrom('A', 'B', 'C', 'D', 'Z'))
    .map(([n, a, c]) => `${n}  ${a} ${c}`),
  fc.tuple(count, signed, signed).map(([q, p, a]) => ` ${q} * ${p}  ${a} B`),
  fc.tuple(count, signed).map(([w, a]) => ` ${w} KG  ${a} C`),
  fc.tuple(name, count, signed).map(([n, w, a]) => `${n}  ${w},9 KG  ${a} C`),
);
const kauflandDocument = fc
  .tuple(
    fc.array(kauflandRow, { maxLength: 25 }),
    fc.option(signed),
    fc.array(
      fc.tuple(
        fc.constantFrom('B', 'C', 'D', 'X'),
        fc.integer({ min: 0, max: 999 }),
        amount,
        amount,
        amount,
      ),
      {
        maxLength: 3,
      },
    ),
  )
  .map(([rows, total, vat]) => [
    'Receipt copy',
    'Preț RON',
    ...rows,
    ...(total === null ? [] : [`TOTAL  ${total}`]),
    'Tichet de ambalaje  5,00',
    'Plată card  13,27',
    'TVA %  Brut  Net  Tva',
    ...vat.map(([c, r, g, n, v]) => `${c}=${r},00%  ${g}  ${n}  ${v}`),
    'Magazin:  4670',
    'Data: 07.11.26 Timp:  18:31:47 Bon:1',
  ]);

const metroRow = fc
  .tuple(
    fc.stringMatching(/^[0-9]{0,15}$/),
    name,
    fc.constantFrom('', 'BUC', 'KG', 'L'),
    fc.constantFrom('', 'PC', 'BU'),
    fc.array(
      fc.oneof(
        amount,
        signed.map((text) => `${text}-`),
        count,
      ),
      { minLength: 6, maxLength: 11 },
    ),
  )
  .map(([ean, n, unit, pkg, numbers]) =>
    [ean, n, unit, pkg, ...numbers].filter(Boolean).join('  '),
  );
const metroDocument = fc
  .tuple(
    fc.array(metroRow, { maxLength: 20 }),
    fc.option(amount),
    fc.constantFrom('11', '21', '999'),
  )
  .map(([rows, total, rate]) => [
    'METRO CASH & CARRY ROMANIA SRL  METRO Cash&Carry Cluj',
    'Data Vanzare:  12.08.2026 19:33',
    'FACTURA NR 1',
    'Cod articol  Denumire articol',
    ...rows,
    `Total factura  111,42  ${rate}%  12,26  123,68`,
    ...(total === null ? [] : [`Total de plata  ${total}  LEI`]),
  ]);

// Fragments of real documents mixed with noise, at random positions on a coarse grid of baselines.
const TOKENS = [
  'TOTAL',
  'Preț RON',
  'TVA %',
  'B=21,00%',
  '15,57 C',
  '3 * 5,19',
  '0,920 KG',
  'Plată card',
  'Magazin: 4670',
  'Kaufland RO 4670',
  'METRO CASH & CARRY',
  'FACTURA NR 1',
  'Cod articol',
  'Total factura',
  'Total de plata',
  '11%',
  'LEI',
  '4,12',
  '2,49-',
  '5948792073282',
  '120BUC',
  'PC',
  'BUC',
  '1.234,56',
  '999999999999,99',
  '-1,50',
  '0',
  '3',
  'x',
];
const noisyItem = fc.record({
  str: fc.oneof(fc.constantFrom(...TOKENS), fc.string({ maxLength: 10 })),
  x: fc.integer({ min: 0, max: 600 }),
  y: fc.integer({ min: 0, max: 30 }).map((row) => row * 10),
  w: fc.integer({ min: 0, max: 80 }),
  h: fc.integer({ min: 0, max: 12 }),
});
const noisySource = fc
  .array(
    fc.record({
      width: fc.constant(600),
      height: fc.constant(800),
      items: fc.array(noisyItem, { maxLength: 80 }),
    }),
    { maxLength: 3 },
  )
  .map((pages) => ({ kind: 'pdf-text' as const, pages }));

function expectValid(receipt: ReturnType<typeof parseReceipt>) {
  const result = ParsedReceiptSchema.safeParse(receipt);
  expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true);
}

describe('the PDF parsers on malformed input', () => {
  it('never throw and always return a valid receipt, whatever the Kaufland-like rows say', () => {
    fc.assert(
      fc.property(kauflandDocument, (lines) => {
        expectValid(parseReceipt(pdfFromText(lines), { now: NOW }));
      }),
      { numRuns: 300 },
    );
  });

  it('never throw and always return a valid receipt, whatever the METRO-like rows say', () => {
    fc.assert(
      fc.property(metroDocument, (lines) => {
        expectValid(parseReceipt(pdfFromText(lines), { now: NOW }));
      }),
      { numRuns: 300 },
    );
  });

  it('survive fragments of real documents at random positions, and detect() stays within 0..1', () => {
    fc.assert(
      fc.property(noisySource, (source) => {
        expectValid(parseReceipt(source, { now: NOW }));
        for (const parser of parsers) {
          const score = parser.detect(source);
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe('the PDF parsers on the real fixtures', () => {
  it.each(['kaufland-2026-11-07', 'metro-invoice-2026-08-12'])(
    '%s: the order in which pdf.js lists the items does not matter',
    (id) => {
      const { source } = sourceOf(getFixture(id), 'pdf-text');
      const items = source.pages[0]?.items ?? [];
      const expected = parseReceipt(source, { now: NOW });
      fc.assert(
        fc.property(fc.shuffledSubarray(items, { minLength: items.length }), (shuffled) => {
          const page = { ...(source.pages[0] as (typeof source.pages)[number]), items: shuffled };
          expect(parseReceipt({ ...source, pages: [page] }, { now: NOW })).toEqual(expected);
        }),
        { numRuns: 15 },
      );
    },
  );
});
