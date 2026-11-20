import type { LineMapping, MappingChoice, NewProductInput } from '@/catalog';
import type { Chain, ParsedReceipt, ParseWarning, Product, ReceiptSource } from '@/domain';
import type { PretometruDB, StorageContext } from '@/storage';

/*
 * Small local ports for the sibling modules this one consumes. The signatures are the agreed
 * interfaces of docs/architecture.md; `engines.ts` plugs the real modules in, tests plug in fakes.
 */

export type PdfTextSource = Extract<ReceiptSource, { kind: 'pdf-text' }>;
export type OcrTextSource = Extract<ReceiptSource, { kind: 'ocr-text' }>;

/** `@/parsers`: pure parsing and arithmetic validation. */
export interface ParserPort {
  /** Never throws: returns a best-effort receipt plus warnings. */
  parseReceipt(source: ReceiptSource, opts: { now: Date }): ParsedReceipt;
  /** SUM_MISMATCH, LINE_ARITHMETIC, VAT_MISMATCH, FUTURE_DATE, MISSING_DATE, MISSING_TOTAL. */
  validateReceipt(receipt: ParsedReceipt, opts: { now: Date }): ParseWarning[];
}

export interface BoundingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecognizeOptions {
  signal?: AbortSignal;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
  /** Overrides of the image preprocessing; the second OCR pass reads at another `scale`. */
  preprocessing?: { scale?: number };
}

/** Text extraction: `@/import/pdf` (pdf.js) and `@/ocr` (Tesseract.js). */
export interface EnginePort {
  extractPdfText(data: ArrayBuffer): Promise<PdfTextSource>;
  recognizeImage(image: Blob, opts?: RecognizeOptions): Promise<OcrTextSource>;
  /** `bbox` is in image pixels; `padding` (pixels) widens the crop so glyphs are not cut at the edge. */
  cropRegion(image: Blob, bbox: BoundingBox, options?: { padding?: number }): Promise<Blob>;
}

export type { LineMapping, MappingChoice, NewProductInput, PackChoice } from '@/catalog';

/** `@/catalog`: product matching and the alias memory. */
export interface CatalogPort {
  /** One entry per receipt line, in the same order. */
  suggestMappings(db: PretometruDB, receipt: ParsedReceipt): Promise<LineMapping[]>;
  searchProducts(db: PretometruDB, query: string, limit?: number): Promise<Product[]>;
  createProduct(
    db: PretometruDB,
    input: NewProductInput,
    context?: StorageContext,
  ): Promise<Product>;
  /** Upserts aliases (by name and EAN) so the next import maps by itself. */
  rememberMappings(
    db: PretometruDB,
    chain: Chain,
    choices: readonly MappingChoice[],
    context?: StorageContext,
  ): Promise<void>;
}
