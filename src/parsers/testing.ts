/**
 * Test-only builders for parser output: valid by default. Never import this from application code.
 */
import type { ParsedLine, ParsedReceipt } from '@/domain';

export function makeParsedLine(overrides: Partial<ParsedLine> = {}): ParsedLine {
  return {
    idx: 0,
    rawName: 'LAPTE UHT 1L',
    kind: 'product',
    qty: 1,
    qtyUnit: 'buc',
    lineTotalBani: 599,
    ...overrides,
  };
}

export function makeParsedReceipt(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    schemaVersion: 1,
    chain: 'kaufland',
    docType: 'receipt',
    purchasedAt: '2026-11-07T18:31:47',
    currency: 'RON',
    totals: { grandTotalBani: 599 },
    lines: [makeParsedLine()],
    meta: { engine: 'pdfjs', parser: 'kaufland', parserVersion: '1.0.0', warnings: [] },
    ...overrides,
  };
}
