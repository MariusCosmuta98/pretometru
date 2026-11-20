import type { Chain, ExtractionEngine, ParsedReceipt, ReceiptSource } from '@/domain';

/** The engine that produced a source: what `meta.engine` of the receipt parsed from it says. */
export function engineForSource(source: ReceiptSource): ExtractionEngine {
  switch (source.kind) {
    case 'pdf-text':
      return 'pdfjs';
    case 'ocr-text':
      return 'tesseract';
    case 'pasted-text':
      return 'paste';
  }
}

/** A receipt with nothing extracted: for a source a parser cannot read, or that nobody recognises. */
export function emptyReceipt(
  source: ReceiptSource,
  parser: { id: string; version: string },
  chain: Chain = 'unknown',
): ParsedReceipt {
  return {
    schemaVersion: 1,
    chain,
    docType: 'receipt',
    currency: 'RON',
    totals: { grandTotalBani: 0 },
    lines: [],
    meta: {
      engine: engineForSource(source),
      parser: parser.id,
      parserVersion: parser.version,
      warnings: [],
    },
  };
}
