import type { ReceiptParser } from '@/domain';
import { emptyReceipt } from '../source';
import { detectLidl, LIDL_VERSION, parseLidl } from './parse';

// Lidl receipts are read from text: OCR of the app screenshot, or a copy from Live Text / Lens.
const parser: ReceiptParser = {
  id: 'lidl',
  version: LIDL_VERSION,
  detect: (source) => (source.kind === 'pdf-text' ? 0 : detectLidl(source)),
  parse: (source) =>
    source.kind === 'pdf-text'
      ? emptyReceipt(source, { id: 'lidl', version: LIDL_VERSION }, 'lidl')
      : parseLidl(source),
};

export default parser;
