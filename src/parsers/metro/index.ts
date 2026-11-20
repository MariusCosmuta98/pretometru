import type { ReceiptParser } from '@/domain';
import { pdfRows } from '../pdf-rows';
import { emptyReceipt } from '../source';
import { detectMetro, METRO_VERSION, parseMetro } from './parse';

const parser: ReceiptParser = {
  id: 'metro',
  version: METRO_VERSION,
  // METRO invoices are read from the PDF text only.
  detect: (source) => (source.kind === 'pdf-text' ? detectMetro(pdfRows(source)) : 0),
  parse: (source) =>
    source.kind === 'pdf-text'
      ? parseMetro(source)
      : emptyReceipt(source, { id: 'metro', version: METRO_VERSION }, 'metro'),
};

export default parser;
