import { createProduct, rememberMappings, searchProducts, suggestMappings } from '@/catalog';
import { parseReceipt, validateReceipt } from '@/parsers';
import { ImportError } from './errors';
import type { CatalogPort, EnginePort, ParserPort } from './ports';

/*
 * Composition root of the sibling modules: the one place that knows which real implementation
 * backs each port. Everything else in `src/import` and the screens code against the ports, so a
 * module that has not landed on `main` yet is a single line here.
 *
 * Wired: `@/parsers`, `@/catalog`, `@/ocr` (loaded lazily on first use).
 * Pending (not on `main` when this was written): `@/import/pdf` (extractPdfText). Until it is
 * wired, importing a PDF fails with `ENGINE_UNAVAILABLE`; images, pasted text and manual
 * receipts work.
 */

const unavailable = (what: string) =>
  new ImportError('ENGINE_UNAVAILABLE', `${what} is not wired in`);

export const defaultParser: ParserPort = { parseReceipt, validateReceipt };

export const defaultEngines: EnginePort = {
  extractPdfText: () => Promise.reject(unavailable('PDF text extraction')),
  // Tesseract.js and its WASM are heavy: `@/ocr` is only fetched when someone reads an image.
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
