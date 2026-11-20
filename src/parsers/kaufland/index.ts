import type { ReceiptParser } from '@/domain';
import { pdfRows } from '../pdf-rows';
import { emptyReceipt } from '../source';
import { detectKaufland, KAUFLAND_VERSION, parseKaufland } from './parse';

const parser: ReceiptParser = {
  id: 'kaufland',
  version: KAUFLAND_VERSION,
  // Kaufland receipts are read from the PDF text only.
  detect: (source) => (source.kind === 'pdf-text' ? detectKaufland(pdfRows(source)) : 0),
  parse: (source) =>
    source.kind === 'pdf-text'
      ? parseKaufland(source)
      : emptyReceipt(source, { id: 'kaufland', version: KAUFLAND_VERSION }, 'kaufland'),
};

export default parser;
