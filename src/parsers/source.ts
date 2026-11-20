import type { ExtractionEngine, ReceiptSource } from '@/domain';

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
