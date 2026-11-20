import { describe, expect, it } from 'vitest';
import { ParsedReceiptSchema, type ParsedReceipt } from './parsed-receipt';
import { ReceiptSourceSchema } from './receipt-source';

// Synthetic receipt (no real data): weighed item, multi-qty item, deposit, bag, payment voucher.
function receipt(): ParsedReceipt {
  return {
    schemaVersion: 1,
    chain: 'kaufland',
    storeName: 'KAUFLAND ROMANIA SCS',
    branch: { code: '1234', city: 'Cluj-Napoca' },
    docType: 'receipt',
    documentNo: '0042',
    purchasedAt: '2026-11-07T14:32',
    currency: 'RON',
    totals: {
      grandTotalBani: 3666,
      voucherBani: 100,
      paidBani: 3566,
      vat: [{ rate: 21, grossBani: 2299, vatBani: 399 }],
    },
    lines: [
      {
        idx: 0,
        rawName: 'PULPE PUI',
        kind: 'product',
        qty: 0.92,
        qtyUnit: 'kg',
        unitPriceBani: 2499,
        lineTotalBani: 2299,
        vatRate: 21,
        vatClass: 'B',
        storeCategoryHint: 'Carne',
      },
      {
        idx: 1,
        rawName: 'LAPTE UHT 1.5% 1L',
        kind: 'product',
        ean: '5941234567890',
        qty: 2,
        qtyUnit: 'buc',
        unitPriceBani: 599,
        lineTotalBani: 1198,
        pack: { qty: 1, unit: 'l' },
      },
      {
        idx: 2,
        rawName: 'GARANTIE AMBALAJ',
        kind: 'deposit',
        qty: 2,
        qtyUnit: 'buc',
        lineTotalBani: 100,
      },
      { idx: 3, rawName: 'PUNGA BIO', kind: 'bag', qty: 1, qtyUnit: 'buc', lineTotalBani: 69 },
    ],
    meta: { engine: 'fixture', parser: 'ground-truth', parserVersion: '1.0.0', warnings: [] },
  };
}

function issuePaths(value: unknown): string[] {
  const result = ParsedReceiptSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('ParsedReceiptSchema', () => {
  it('accepts a complete receipt', () => {
    expect(ParsedReceiptSchema.safeParse(receipt()).success).toBe(true);
  });

  it('accepts a minimal receipt: only what every parser can always provide', () => {
    const minimal = {
      schemaVersion: 1,
      chain: 'unknown',
      docType: 'receipt',
      currency: 'RON',
      totals: { grandTotalBani: 0 },
      lines: [],
      meta: { engine: 'paste', parser: 'generic', parserVersion: '0.1.0', warnings: [] },
    };
    expect(ParsedReceiptSchema.safeParse(minimal).success).toBe(true);
  });

  it('rejects money that is not an integer number of bani', () => {
    const bad = receipt();
    bad.lines[0]!.lineTotalBani = 22.99;
    expect(issuePaths(bad)).toContain('lines.0.lineTotalBani');
  });

  it('rejects unknown keys, so a typo cannot pass silently', () => {
    const bad = { ...receipt(), totals: { grandTotalBani: 1, grandTotalBanii: 2 } };
    expect(issuePaths(bad)).toContain('totals');
  });

  it('rejects quantities with more than three decimals and non-positive quantities', () => {
    const tooPrecise = receipt();
    tooPrecise.lines[0]!.qty = 0.9205;
    expect(issuePaths(tooPrecise)).toContain('lines.0.qty');

    const zero = receipt();
    zero.lines[1]!.qty = 0;
    expect(issuePaths(zero)).toContain('lines.1.qty');
  });

  it('rejects a negative discount (discounts are positive amounts)', () => {
    const bad = receipt();
    bad.lines[1]!.discountBani = -50;
    expect(issuePaths(bad)).toContain('lines.1.discountBani');
  });

  it('allows a standalone discount line with a negative total', () => {
    const withDiscount = receipt();
    withDiscount.lines.push({
      idx: 4,
      rawName: 'REDUCERE',
      kind: 'discount',
      qty: 1,
      qtyUnit: 'buc',
      lineTotalBani: -150,
    });
    expect(ParsedReceiptSchema.safeParse(withDiscount).success).toBe(true);
  });

  it('accepts a printed date in the future (that is a warning, not a schema error) but not an impossible one', () => {
    const lidl = { ...receipt(), purchasedAt: '2026-12-29' };
    expect(ParsedReceiptSchema.safeParse(lidl).success).toBe(true);
    expect(issuePaths({ ...receipt(), purchasedAt: '2026-02-30' })).toContain('purchasedAt');
  });

  it('requires line idx to be strictly increasing', () => {
    const bad = receipt();
    bad.lines[2]!.idx = 1;
    expect(issuePaths(bad)).toContain('lines.2.idx');
  });

  it('requires warnings to point at an existing line', () => {
    const bad = receipt();
    bad.meta.warnings.push({
      code: 'LINE_ARITHMETIC',
      message: 'qty * price != total',
      lineIdx: 9,
    });
    expect(issuePaths(bad)).toContain('meta.warnings.0.lineIdx');
  });

  it('rejects a chain or warning code the contract does not define', () => {
    expect(issuePaths({ ...receipt(), chain: 'carrefour' })).toContain('chain');
    const bad = receipt();
    bad.meta.warnings.push({ code: 'SOMETHING_NEW' as 'DUPLICATE', message: 'x' });
    expect(issuePaths(bad)).toContain('meta.warnings.0.code');
  });

  it('rejects an EAN that is not digits only', () => {
    const bad = receipt();
    bad.lines[1]!.ean = '594 123 456';
    expect(issuePaths(bad)).toContain('lines.1.ean');
  });
});

describe('ReceiptSourceSchema', () => {
  it('accepts the three parser inputs', () => {
    expect(
      ReceiptSourceSchema.safeParse({
        kind: 'pdf-text',
        pages: [{ width: 595, height: 842, items: [{ str: 'TOTAL', x: 10, y: 20, w: 30, h: 8 }] }],
      }).success,
    ).toBe(true);
    expect(
      ReceiptSourceSchema.safeParse({
        kind: 'ocr-text',
        text: 'TOTAL 61,67',
        confidence: 85,
        lines: [{ text: 'TOTAL 61,67', confidence: 91.5, bbox: { x: 0, y: 0, w: 100, h: 12 } }],
        imageSize: { w: 720, h: 1600 },
      }).success,
    ).toBe(true);
    expect(
      ReceiptSourceSchema.safeParse({ kind: 'pasted-text', text: 'TOTAL 61,67' }).success,
    ).toBe(true);
  });

  it('rejects an unknown kind and OCR confidence outside Tesseract’s 0-100 scale', () => {
    expect(ReceiptSourceSchema.safeParse({ kind: 'image', text: '' }).success).toBe(false);
    expect(
      ReceiptSourceSchema.safeParse({ kind: 'ocr-text', text: 'x', confidence: 1.5e3 }).success,
    ).toBe(false);
  });
});
