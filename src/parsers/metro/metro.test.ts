import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema } from '@/domain';
import { parseReceipt } from '../parse-receipt';
import { pdfPagesFromText } from '../testing';
import metro from './index';

const NOW = new Date('2026-11-20T12:00:00Z');

// Monospaced text art of a METRO invoice (synthetic), in the real column layout: EAN at column 0,
// description at 15, packaging code at 48 and the numbers right-aligned at fixed columns.
const at = (...parts: Array<[column: number, text: string]>) =>
  parts.reduce((line, [column, text]) => line.padEnd(column) + text, '');
const rightAt = (end: number, text: string): [number, string] => [end - text.length, text];

interface Item {
  ean?: string;
  name: string;
  /** Printed after the description when the unit of measure is not the default. */
  unitToken?: string;
  packaging?: string;
  price: string;
  qty: string;
  value: string;
  discount?: string;
  net: string;
  vat: string;
  total: string;
  sold?: string;
  unitPrice?: string;
}

function item(i: Item): string {
  return at(
    [0, i.ean ?? ''],
    [15, i.name],
    [42, i.unitToken ?? ''],
    [48, i.packaging ?? ''],
    rightAt(58, i.price),
    rightAt(64, i.qty),
    rightAt(74, i.value),
    ...(i.discount ? [rightAt(86, i.discount)] : []),
    rightAt(98, i.net),
    rightAt(105, i.vat),
    rightAt(115, i.total),
    rightAt(123, i.sold ?? '1'),
    rightAt(133, i.unitPrice ?? i.price),
  );
}

const HEADER = [
  at([0, 'METRO CASH & CARRY ROMANIA SRL'], [40, 'METRO Cash&Carry Cluj']),
  'Data Vanzare:  12.08.2026 19:33',
  'FACTURA NR 7000000000000042',
  at([0, 'Cod articol'], [15, 'Denumire articol'], [48, 'Mod amb'], [60, 'Cant.']),
];

// 11% of 34,25 ex-VAT is 3,77; the three lines add up to 38,02.
const TOTALS = [
  at(
    [30, 'Total factura'],
    rightAt(52, '34,25'),
    [56, '11%'],
    rightAt(70, '3,77'),
    rightAt(84, '38,02'),
  ),
  at([30, '-'.repeat(20)]),
  at(rightAt(52, '34,25'), rightAt(70, '3,77'), rightAt(84, '38,02'), [88, 'LEI']),
  at([30, 'Total de plata'], rightAt(60, '38,02'), [64, 'LEI']),
];

const BISCUITS: Item = {
  ean: '5941234567890',
  name: '500G TEST BISCUITI',
  packaging: 'PG',
  price: '4,00',
  qty: '3',
  value: '12,00',
  discount: '1,50-',
  net: '10,50',
  vat: '11',
  total: '11,66',
  unitPrice: '3,50',
};
const MILK: Item = {
  ean: '5949876543210',
  name: '1L LAPTE UHT',
  packaging: 'SI',
  price: '6,00',
  qty: '2',
  value: '12,00',
  net: '12,00',
  vat: '11',
  total: '13,32',
};
const APPLES: Item = {
  ean: '2000000012345',
  name: 'MERE GOLDEN',
  unitToken: 'KG',
  price: '5,00',
  qty: '2,350',
  value: '11,75',
  net: '11,75',
  vat: '11',
  total: '13,04',
};

const INVOICE = [...HEADER, item(BISCUITS), item(MILK), item(APPLES), ...TOTALS];

type Parsed = ReturnType<typeof parse>;

function parse(...pages: string[][]) {
  return parseReceipt(pdfPagesFromText(pages), { now: NOW });
}

const codes = (receipt: Parsed) => receipt.meta.warnings.map((warning) => warning.code);

describe('METRO parser', () => {
  it('reads ex-VAT lines into VAT-inclusive totals and converts the discount', () => {
    const receipt = parse(INVOICE);
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.meta.warnings).toEqual([]);
    expect(receipt.lines).toEqual([
      {
        idx: 0,
        rawName: '500G TEST BISCUITI',
        kind: 'product',
        ean: '5941234567890',
        qty: 3,
        qtyUnit: 'buc',
        discountBani: 167, // round(1,50 x 1,11)
        lineTotalBani: 1166, // the printed value with VAT, not 3 x a derived price
        vatRate: 11,
        pack: { qty: 500, unit: 'g' },
      },
      {
        idx: 1,
        rawName: '1L LAPTE UHT',
        kind: 'product',
        ean: '5949876543210',
        qty: 2,
        qtyUnit: 'buc',
        lineTotalBani: 1332,
        vatRate: 11,
        pack: { qty: 1, unit: 'l' },
      },
      {
        idx: 2,
        rawName: 'MERE GOLDEN KG',
        kind: 'product',
        ean: '2000000012345',
        qty: 2.35,
        qtyUnit: 'kg',
        lineTotalBani: 1304,
        vatRate: 11,
      },
    ]);
  });

  it('reads the header, the VAT table and the totals', () => {
    const { storeName, branch, docType, documentNo, purchasedAt, totals } = parse(INVOICE);
    expect([storeName, branch, docType, documentNo, purchasedAt]).toEqual([
      'METRO CASH & CARRY ROMANIA SRL',
      { city: 'Cluj' },
      'invoice',
      '7000000000000042',
      '2026-08-12T19:33',
    ]);
    expect(totals).toEqual({
      grandTotalBani: 3802,
      paidBani: 3802,
      vat: [{ rate: 11, netBani: 3425, vatBani: 377, grossBani: 3802 }],
    });
  });

  it('keeps a stray unit token in the name and the packaging code out of it', () => {
    const receipt = parse([
      ...HEADER,
      item({ ...MILK, name: '200G VIVA PERNITE', unitToken: 'BUC', packaging: 'BU' }),
    ]);
    expect(receipt.lines[0]).toMatchObject({
      rawName: '200G VIVA PERNITE BUC',
      qtyUnit: 'buc',
      pack: { qty: 200, unit: 'g' },
    });
  });

  it('treats a fractional quantity without a unit of measure as a weight', () => {
    const receipt = parse([...HEADER, item({ ...APPLES, unitToken: undefined })]);
    expect(receipt.lines[0]).toMatchObject({ qty: 2.35, qtyUnit: 'kg' });
  });

  it('keeps a truncated EAN as printed and drops one that is too short to be an EAN', () => {
    const receipt = parse([
      ...HEADER,
      item({ ...MILK, ean: '59487920' }),
      item({ ...MILK, ean: '594' }),
      item({ ...MILK, ean: undefined }),
    ]);
    expect(receipt.lines.map((line) => line.ean)).toEqual(['59487920', undefined, undefined]);
    expect(receipt.lines.map((line) => line.rawName)).toEqual(Array(3).fill('1L LAPTE UHT'));
  });

  it('cross-checks "Unit. vanz." against a counted size in the name', () => {
    const rolls = { ...MILK, name: '8 ROLE FL H IG ALBA' };
    expect(codes(parse([...HEADER, item({ ...rolls, sold: '8' })]))).not.toContain(
      'LOW_CONFIDENCE',
    );
    const receipt = parse([...HEADER, item({ ...rolls, sold: '6' })]);
    expect(receipt.meta.warnings).toContainEqual(
      expect.objectContaining({ code: 'LOW_CONFIDENCE', lineIdx: 0 }),
    );
    expect(receipt.lines[0]?.pack).toEqual({ qty: 8, unit: 'role' });
  });

  it('flags a line whose printed columns do not add up', () => {
    const receipt = parse([...HEADER, item({ ...MILK, value: '14,00' })]);
    expect(receipt.meta.warnings).toContainEqual(
      expect.objectContaining({ code: 'LINE_ARITHMETIC', lineIdx: 0 }),
    );
  });

  it('reads an invoice of several pages: lines of every page, the VAT table of the last', () => {
    const page1 = [
      ...HEADER,
      item(BISCUITS),
      item(MILK),
      at(
        [30, 'Subtotal'],
        rightAt(52, '22,50'),
        [56, '11%'],
        rightAt(70, '2,50'),
        rightAt(84, '25,00'),
      ),
    ];
    const page2 = [...HEADER, item(APPLES), ...TOTALS];
    const receipt = parse(page1, page2);
    expect(receipt.lines.map((line) => line.idx)).toEqual([0, 1, 2]);
    expect(receipt.totals.vat).toEqual([
      { rate: 11, netBani: 3425, vatBani: 377, grossBani: 3802 },
    ]);
    expect(receipt.meta.warnings).toEqual([]);
  });

  it('writes 0 for a total it cannot find, and the validation says so', () => {
    const receipt = parse([...HEADER, item(MILK)]);
    expect(receipt.totals.grandTotalBani).toBe(0);
    expect(codes(receipt)).toContain('MISSING_TOTAL');
  });

  it('skips rows it cannot read and never throws', () => {
    const noise = ['1234567890123  12,50  abc  3  x', '------', 'Pagina: 1'];
    expect(() => parse([])).not.toThrow();
    expect(parse([...HEADER, ...noise, item(MILK)]).lines).toHaveLength(1);
  });

  it('recognises its own documents and nothing else', () => {
    expect(metro.detect(pdfPagesFromText([INVOICE]))).toBeGreaterThan(0.9);
    expect(metro.detect(pdfPagesFromText([['Receipt copy', 'Preț RON', 'TOTAL 1,00']]))).toBe(0);
    expect(metro.detect({ kind: 'pasted-text', text: 'METRO CASH & CARRY' })).toBe(0);
  });
});
