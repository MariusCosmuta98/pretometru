/**
 * Test-only builders for parser output. Never import this from application code.
 */
import type { Chain, ParsedLine, ParsedReceipt } from '@/domain';

type LineSpec = Partial<ParsedLine> & { rawName: string };

/** A valid receipt of product lines (1 buc, 5,99 lei each unless overridden); `idx` is assigned. */
export function parsedReceipt(chain: Chain, lines: readonly LineSpec[]): ParsedReceipt {
  const full: ParsedLine[] = lines.map((line, idx) => ({
    qty: 1,
    qtyUnit: 'buc',
    kind: 'product',
    lineTotalBani: 599,
    ...line,
    idx,
  }));
  return {
    schemaVersion: 1,
    chain,
    docType: 'receipt',
    purchasedAt: '2026-11-07T14:32',
    currency: 'RON',
    totals: { grandTotalBani: full.reduce((sum, line) => sum + line.lineTotalBani, 0) },
    lines: full,
    meta: { engine: 'fixture', parser: 'test', parserVersion: '1.0.0', warnings: [] },
  };
}
