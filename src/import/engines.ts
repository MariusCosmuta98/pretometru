import { createProduct, rememberMappings, searchProducts, suggestMappings } from '@/catalog';
import { parseReceipt, validateReceipt } from '@/parsers';
import type { CatalogPort, EnginePort, ParserPort } from './ports';

/*
 * Composition root of the sibling modules: the one place that knows which real implementation
 * backs each port. Everything else in `src/import` and the screens code against the ports, so
 * swapping or adding an engine (for example the optional Gemini one) is a change here.
 *
 * pdf.js (`./pdf`) and Tesseract.js (`@/ocr`) are heavy: they are fetched on first use, so the
 * app shell and the receipt screens load without them.
 */

export const defaultParser: ParserPort = { parseReceipt, validateReceipt };

export const defaultEngines: EnginePort = {
  extractPdfText: async (data) => (await import('./pdf')).extractPdfText(data),
  recognizeImage: async (image, opts) => (await import('@/ocr')).recognizeImage(image, opts),
  cropRegion: async (image, bbox, options) =>
    (await import('@/ocr')).cropRegion(image, bbox, options),
};

export const defaultCatalog: CatalogPort = {
  suggestMappings,
  searchProducts,
  createProduct,
  rememberMappings,
};
