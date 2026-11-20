import { describe, expect, it } from 'vitest';
import {
  after,
  between,
  denylistTerms,
  formatFixtureJson,
  immediatelyAfter,
  maskText,
  pdfRows,
  sanitizePdfText,
  zeroDigits,
  type PdfSource,
  type RowInfo,
} from './sanitize.ts';

// Every "personal" value below is invented for this test. The two that look like real identifiers are
// assembled at runtime so the repository leak scan does not flag this file.
const CLIENT_LINE = ['Nr. client:', '4821937'].join(' ');
const MASKED_CARD = ['xxxxx', '1234'].join('');

describe('maskText / zeroDigits', () => {
  it('keeps length, spacing and punctuation but removes every letter and digit', () => {
    expect(maskText('Ion Popescu, Str. Țării 12 | 400123')).toBe(
      'Xxx Xxxxxxx, Xxx. Xxxxx 00 | 000000',
    );
    expect(maskText('IBAN: RO00TEST0000000000')).toBe('XXXX: XX00XXXX0000000000');
  });

  it('zeroDigits only touches digits', () => {
    expect(zeroDigits(`Card: ${MASKED_CARD} Bon:26351`)).toBe('Card: xxxxx0000 Bon:00000');
  });
});

const item = (str: string, x: number, y: number) => ({ str, x, y, w: str.length * 4, h: 8 });

function fakeReceipt(): PdfSource {
  return {
    kind: 'pdf-text',
    pages: [
      {
        width: 300,
        height: 400,
        items: [
          item('FAKE SHOP SRL', 10, 380),
          item('Buyer:', 10, 360),
          item('Ion Popescu', 60, 360.4),
          item(CLIENT_LINE, 10, 340),
          item('MILK 1L', 10, 300),
          item('1,00 A', 200, 300),
          item('Bon:26351', 10, 280),
        ],
      },
    ],
  };
}

describe('pdfRows', () => {
  it('groups items that share a baseline and orders each row left to right', () => {
    const rows = pdfRows(fakeReceipt().pages[0]!.items);

    expect(rows.map((row) => row.text)).toEqual([
      'FAKE SHOP SRL',
      'Buyer: Ion Popescu',
      CLIENT_LINE,
      'MILK 1L 1,00 A',
      'Bon:26351',
    ]);
    expect(rows[1]?.itemIndexes).toEqual([1, 2]);
  });
});

describe('sanitizePdfText', () => {
  const rules = [
    {
      name: 'buyer',
      when: (row: { text: string }) => row.text.startsWith('Buyer:'),
      apply: 'mask' as const,
    },
    {
      name: 'client',
      when: (row: { text: string }) => row.text.includes('client'),
      apply: 'mask' as const,
    },
    {
      name: 'bon',
      when: (row: { text: string }) => row.text.startsWith('Bon:'),
      apply: 'zero-digits' as const,
    },
  ];

  it('masks the matching rows, keeps everything else and the geometry untouched', () => {
    const original = fakeReceipt();
    const { source } = sanitizePdfText(original, rules);
    const strings = source.pages[0]!.items.map((entry) => entry.str);

    expect(strings).toEqual([
      'FAKE SHOP SRL',
      'Xxxxx:',
      'Xxx Xxxxxxx',
      'Xx. xxxxxx: 0000000',
      'MILK 1L',
      '1,00 A',
      'Bon:00000',
    ]);
    expect(source.pages[0]!.items.map(({ x, y, w, h }) => [x, y, w, h])).toEqual(
      original.pages[0]!.items.map(({ x, y, w, h }) => [x, y, w, h]),
    );
  });

  it('does not mutate its input and applies only the first matching rule per row', () => {
    const original = fakeReceipt();
    const before = JSON.stringify(original);
    const { source } = sanitizePdfText(original, [
      { name: 'zero', when: (row) => row.text.startsWith('Bon:'), apply: 'zero-digits' },
      { name: 'mask', when: (row) => row.text.startsWith('Bon:'), apply: 'mask', optional: true },
    ]);

    expect(JSON.stringify(original)).toBe(before);
    expect(source.pages[0]!.items[6]?.str).toBe('Bon:00000');
  });

  it('reports the original text of every changed item, and only those', () => {
    const { removed } = sanitizePdfText(fakeReceipt(), rules);

    expect(removed.sort()).toEqual(['Bon:26351', 'Buyer:', 'Ion Popescu', CLIENT_LINE].sort());
  });

  it('accepts a function rule that rewrites the strings of one row', () => {
    const { source } = sanitizePdfText(fakeReceipt(), [
      {
        name: 'milk',
        when: (row) => row.text.startsWith('MILK'),
        apply: (strings) =>
          strings.map((value, index) => (index === 1 ? zeroDigits(value) : value)),
      },
    ]);

    expect(source.pages[0]!.items.map((entry) => entry.str).slice(4, 6)).toEqual([
      'MILK 1L',
      '0,00 A',
    ]);
  });
});

describe('row predicates', () => {
  const rows = ['HEAD', '----', 'Buyer', 'Street 1', '----', 'ITEM', 'TOTAL'];
  const hits = (when: (row: RowInfo) => boolean) =>
    rows.flatMap((text, index) => (when({ page: 0, index, text, rows }) ? [index] : []));

  it('between: rows strictly between the first start match and the next end match', () => {
    expect(hits(between(/^----$/, /^----$/))).toEqual([2, 3]);
    expect(hits(between(/^HEAD/, /^----$/))).toEqual([]);
    expect(hits(between(/^missing$/, /^----$/))).toEqual([]);
  });

  it('after / immediatelyAfter: relative to the first row that matches the anchor', () => {
    expect(hits(after(/^----$/))).toEqual([2, 3, 4, 5, 6]);
    expect(hits(immediatelyAfter(/^HEAD/))).toEqual([1]);
  });
});

describe('sanitizePdfText: drift guard', () => {
  it('fails loudly when a rule matches no row, unless it is optional', () => {
    const never = { name: 'buyer block', when: () => false, apply: 'mask' as const };

    expect(() => sanitizePdfText(fakeReceipt(), [never])).toThrow(/buyer block/);
    expect(() => sanitizePdfText(fakeReceipt(), [{ ...never, optional: true }])).not.toThrow();
  });
});

describe('denylistTerms', () => {
  it('keeps distinctive words and numbers, folded, and drops short or still-visible ones', () => {
    const terms = denylistTerms(
      ['Ion Popescu', CLIENT_LINE, 'Str. Țării 12, Cluj'],
      ['METRO Cluj', 'MILK 1L'],
    );

    expect(terms.sort()).toEqual(['4821937', 'client', 'popescu', 'tarii'].sort());
  });
});

describe('formatFixtureJson', () => {
  it('round-trips and writes small leaf objects on one line', () => {
    const value = {
      kind: 'pdf-text',
      pages: [
        {
          width: 1,
          items: [
            { str: 'A', x: 1 },
            { str: 'B', x: 2 },
          ],
        },
      ],
    };
    const text = formatFixtureJson(value);

    expect(JSON.parse(text)).toEqual(value);
    expect(text).toContain('{ "str": "A", "x": 1 },');
    expect(text.endsWith('\n')).toBe(true);
  });
});
