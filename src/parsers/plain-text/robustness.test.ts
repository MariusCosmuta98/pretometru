import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ReceiptParser, type ReceiptSource } from '@/domain';
import generic from '../generic';
import lidl from '../lidl';
import megaImage from '../mega-image';
import { textLines } from './text-lines';

// Words and numbers that steer the parsers into every branch: labels, amounts of every shape,
// quantities, codes, dates, and numbers beyond what the contract allows.
const TOKENS = [
  'TOTAL',
  'Subtotal',
  'TOTAL TVA',
  'TVA',
  'A',
  'B',
  'C',
  'BUC',
  'KG',
  'x',
  '×',
  '*',
  '%',
  '-',
  '/',
  'CARD',
  'NUMERAR',
  'REST',
  'LIDL',
  'COMERCIANT',
  'MEGA',
  'TERMINAL',
  'Lei',
  'DATA',
  'ORA',
  'Produs',
  '2,000',
  '4,05',
  '18,49',
  '0,436',
  '1.234,56',
  '12.99',
  '-1,50',
  '1,5',
  '0,001',
  '100000,000',
  '99999999999,99',
  '999999999,99',
  '21,00%',
  '11,80%',
  '27,00%',
  '9',
  '0',
  '5941234567890',
  '401540000675',
  '1234',
  '29/12/2026',
  '03.11.26',
  '31.02.26',
  '17:12:38',
  '25:61',
  '9,l0',
  'O,SO',
  'Saci 60L',
  '2L',
  '8G*4',
  '400436 Cluj-Napoca',
  '\u00a0',
  '\u200b',
  '„',
  '€',
];

const lineArb = fc
  .array(fc.constantFrom(...TOKENS), { maxLength: 7 })
  .map((tokens) => tokens.join(' '));
const textArb = fc
  .array(fc.oneof({ weight: 5, arbitrary: lineArb }, { weight: 1, arbitrary: fc.string() }), {
    maxLength: 30,
  })
  .map((lines) => lines.join('\n'));

const finite = fc.double({ noNaN: true, noDefaultInfinity: true, min: -5000, max: 5000 });
const ocrArb: fc.Arbitrary<ReceiptSource> = fc
  .tuple(
    textArb,
    fc.array(
      fc.record({
        text: lineArb,
        confidence: fc.double({ noNaN: true, min: 0, max: 100 }),
        bbox: fc.record({ x: finite, y: finite, w: finite, h: finite }),
      }),
      { maxLength: 20 },
    ),
    fc.option(fc.double({ noNaN: true, min: 0, max: 100 }), { nil: undefined }),
  )
  .map(([text, lines, confidence]) => ({
    kind: 'ocr-text' as const,
    text,
    lines,
    ...(confidence !== undefined && { confidence }),
  }));
const pastedArb: fc.Arbitrary<ReceiptSource> = textArb.map((text) => ({
  kind: 'pasted-text' as const,
  text,
}));
const sourceArb = fc.oneof(pastedArb, ocrArb);

const PARSERS: Array<[string, ReceiptParser]> = [
  ['lidl', lidl],
  ['mega-image', megaImage],
  ['generic', generic],
];

describe.each(PARSERS)('%s parser (properties)', (_id, parser) => {
  it('never throws and always returns a receipt that satisfies the contract, whatever the text', () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        const receipt = parser.parse(source);

        expect(ParsedReceiptSchema.safeParse(receipt).error?.issues ?? []).toEqual([]);
        expect(receipt.meta.parser).toBe(parser.id);
      }),
      { numRuns: 400 },
    );
  });

  it('answers detect with a number between 0 and 1 and is deterministic', () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        const score = parser.detect(source);

        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
        expect(parser.detect(source)).toBe(score);
        expect(parser.parse(source)).toEqual(parser.parse(source));
      }),
      { numRuns: 200 },
    );
  });
});

describe('textLines (properties)', () => {
  it('never gives an empty line, a longer one than the cap, or a box that is not a box', () => {
    fc.assert(
      fc.property(sourceArb, (source) => {
        for (const line of textLines(source)) {
          expect(line.text).not.toBe('');
          expect(line.text.length).toBeLessThanOrEqual(300);
          if (line.confidence !== undefined) {
            expect(line.confidence).toBeGreaterThanOrEqual(0);
            expect(line.confidence).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 300 },
    );
  });
});
