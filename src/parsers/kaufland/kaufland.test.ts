import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ParsedLine } from '@/domain';
import { parseReceipt } from '../parse-receipt';
import { pdfFromText } from '../testing';
import kaufland from './index';

const NOW = new Date('2026-11-20T12:00:00Z');

// Monospaced text art of a Kaufland receipt copy (synthetic): names at column 0, details at
// column 1 (column 17 beside a short name), amounts and VAT classes flush right at column 40.
const row = (left: string, right = '') => left.padEnd(40 - right.length) + right;
const vatRow = (label: string, gross: string, net: string, vat: string) =>
  label.padEnd(12) + gross.padStart(8) + net.padStart(10) + vat.padStart(10);

const HEADER = ['Receipt copy', row('', 'Preț RON')];
const VAT_TABLE = [
  'TVA %'.padEnd(12) + 'Brut'.padStart(8) + 'Net'.padStart(10) + 'Tva'.padStart(10),
  vatRow('B=21,00%', '14,27', '11,79', '2,48'),
  vatRow('C=11,00%', '3,50', '3,15', '0,35'),
  vatRow('D=0,00%', '0,50', '0,50', '0,00'),
];
const FOOTER = ['Magazin:  4670 Casa: 7', 'Data: 07.11.26 Timp:  18:31:47 Bon:70001'];

const RECEIPT = [
  ...HEADER,
  'Alimente',
  'SMANTANA 400G',
  row(' 3 * 5,19', '15,57 B'),
  row('PACHET PRAF', '1,77 C'),
  'Fructe / Legume',
  row('USTUROI'.padEnd(17) + '0,182 KG', '1,73 C'),
  row('GARANTIE AMBALAJ', '0,50 D'),
  row('PUNGA BIO'.padEnd(17) + '2 * 0,10', '0,20 B'),
  row('REDUCERE CUPON', '-1,50 B'),
  row('TOTAL', '18,27'),
  row('Tichet de ambalaje', '5,00'),
  row('Plată card', '13,27'),
  row('Rest', '0,00'),
  ...VAT_TABLE,
  ...FOOTER,
];

type Parsed = ReturnType<typeof parse>;

function parse(lines: string[]) {
  return parseReceipt(pdfFromText(lines), { now: NOW });
}

const codes = (receipt: Parsed) => receipt.meta.warnings.map((warning) => warning.code);

function lineAt(receipt: Parsed, idx: number): ParsedLine {
  const found = receipt.lines.find((candidate) => candidate.idx === idx);
  if (!found) throw new Error(`no line ${idx}`);
  return found;
}

describe('Kaufland parser', () => {
  it('reads two-row items, weighed items, deposits, bags and discounts', () => {
    const receipt = parse(RECEIPT);
    expect(ParsedReceiptSchema.safeParse(receipt).success).toBe(true);
    expect(receipt.meta.warnings).toEqual([]);
    expect(
      receipt.lines.map((line) => [
        line.kind,
        line.rawName,
        line.qty,
        line.qtyUnit,
        line.lineTotalBani,
      ]),
    ).toEqual([
      ['product', 'SMANTANA 400G', 3, 'buc', 1557],
      ['product', 'PACHET PRAF', 1, 'buc', 177],
      ['product', 'USTUROI', 0.182, 'kg', 173],
      ['deposit', 'GARANTIE AMBALAJ', 1, 'buc', 50],
      ['bag', 'PUNGA BIO', 2, 'buc', 20],
      ['discount', 'REDUCERE CUPON', 1, 'buc', -150],
    ]);
    expect(lineAt(receipt, 0)).toMatchObject({
      unitPriceBani: 519,
      storeCategoryHint: 'Alimente',
      pack: { qty: 400, unit: 'g' },
    });
    expect(lineAt(receipt, 2)).toMatchObject({ storeCategoryHint: 'Fructe / Legume' });
    expect(lineAt(receipt, 2).unitPriceBani).toBeUndefined();
    expect(lineAt(receipt, 4)).toMatchObject({ unitPriceBani: 10, vatClass: 'B', vatRate: 21 });
  });

  it('reads the totals, the packaging voucher, the VAT table and the footer', () => {
    const { totals, purchasedAt, documentNo, branch } = parse(RECEIPT);
    expect(totals).toEqual({
      grandTotalBani: 1827,
      voucherBani: 500,
      paidBani: 1327,
      vat: [
        { rate: 21, grossBani: 1427, netBani: 1179, vatBani: 248 },
        { rate: 11, grossBani: 350, netBani: 315, vatBani: 35 },
        { rate: 0, grossBani: 50, netBani: 50, vatBani: 0 },
      ],
    });
    expect([purchasedAt, documentNo, branch]).toEqual([
      '2026-11-07T18:31:47',
      '70001',
      { code: '4670' },
    ]);
  });

  it('takes the city from the merchant block of the card slip', () => {
    const receipt = parse([...RECEIPT, 'Kaufland RO 4670', 'str Exemplu 1', '400000 Cluj-Napoca']);
    expect(receipt.branch).toEqual({ code: '4670', city: 'Cluj-Napoca' });
  });

  it('does not guess a VAT rate when the table is missing', () => {
    const receipt = parse(RECEIPT.filter((text) => !/^(TVA|[BCD]=)/.test(text.trim())));
    expect(lineAt(receipt, 0)).toMatchObject({ vatClass: 'B' });
    expect(lineAt(receipt, 0).vatRate).toBeUndefined();
    expect(receipt.totals.vat).toBeUndefined();
  });

  it('leaves the paid amount out when nothing says what was paid', () => {
    const receipt = parse(RECEIPT.filter((text) => !/^(Tichet|Plată)/.test(text)));
    expect(receipt.totals.voucherBani).toBeUndefined();
    expect(receipt.totals.paidBani).toBeUndefined();
  });

  it('writes 0 for a total it cannot find, and does not read the payment rows as items', () => {
    const receipt = parse(RECEIPT.filter((text) => !text.startsWith('TOTAL')));
    expect(receipt.totals.grandTotalBani).toBe(0);
    expect(receipt.lines).toHaveLength(6);
    expect(codes(receipt)).toContain('MISSING_TOTAL');
  });

  it('keeps the amount of a line whose name is missing and flags it', () => {
    const receipt = parse([...HEADER, row('', '4,00 B'), row('TOTAL', '4,00'), ...FOOTER]);
    expect(receipt.lines).toMatchObject([{ rawName: 'Produs necunoscut', lineTotalBani: 400 }]);
    expect(receipt.meta.warnings).toMatchObject([{ code: 'LOW_CONFIDENCE', lineIdx: 0 }]);
  });

  it('reads the VAT class when pdf.js delivers it as an item of its own', () => {
    const receipt = parse([...HEADER, row('PAINE', '4,00   B'), row('TOTAL', '4,00')]);
    expect(receipt.lines).toMatchObject([{ rawName: 'PAINE', lineTotalBani: 400, vatClass: 'B' }]);
  });

  it('falls back to the date and time of the card slip', () => {
    const receipt = parse([
      ...HEADER,
      row('PAINE', '4,00 B'),
      row('TOTAL', '4,00'),
      'Date: 07.11.26  Time: 18:31',
    ]);
    expect(receipt.purchasedAt).toBe('2026-11-07T18:31');
  });

  it('never throws on an empty or truncated document', () => {
    expect(() => parse([])).not.toThrow();
    expect(() => parse(['Receipt copy', 'Preț RON', 'Alimente'])).not.toThrow();
    expect(parse(HEADER).lines).toEqual([]);
  });

  it('recognises its own documents and nothing else', () => {
    const detect = (lines: string[]) => kaufland.detect(pdfFromText(lines));
    expect(detect(RECEIPT)).toBeGreaterThan(0.4);
    expect(detect([...RECEIPT, 'Kaufland RO 4670'])).toBeGreaterThan(0.9);
    expect(detect(['METRO CASH & CARRY ROMANIA SRL', 'FACTURA NR 1'])).toBe(0);
    expect(kaufland.detect({ kind: 'pasted-text', text: 'Kaufland' })).toBe(0);
  });
});
