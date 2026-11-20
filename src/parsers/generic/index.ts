import type { ReceiptParser } from '@/domain';
import { emptyReceipt } from '../source';
import { detectGeneric, GENERIC_VERSION, parseGeneric } from './parse';

// The fallback: any text (OCR or pasted) that no specific parser recognises. `detect` answers a low
// constant, so it only wins when nothing else does.
const parser: ReceiptParser = {
  id: 'generic',
  version: GENERIC_VERSION,
  detect: detectGeneric,
  parse: (source) =>
    source.kind === 'pdf-text'
      ? emptyReceipt(source, { id: 'generic', version: GENERIC_VERSION })
      : parseGeneric(source),
};

export default parser;
