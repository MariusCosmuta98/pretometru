import type { ReceiptParser } from '@/domain';
import { emptyReceipt } from '../source';
import { detectMegaImage, MEGA_IMAGE_VERSION, parseMegaImage } from './parse';

// Mega Image receipts are read from text: OCR of a photo, or a copy from Live Text / Lens.
const parser: ReceiptParser = {
  id: 'mega-image',
  version: MEGA_IMAGE_VERSION,
  detect: (source) => (source.kind === 'pdf-text' ? 0 : detectMegaImage(source)),
  parse: (source) =>
    source.kind === 'pdf-text'
      ? emptyReceipt(source, { id: 'mega-image', version: MEGA_IMAGE_VERSION }, 'mega-image')
      : parseMegaImage(source),
};

export default parser;
