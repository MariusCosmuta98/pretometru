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

/** What a Gemini reading reports while it runs: the photo is prepared, then sent. */
export type AiReadPhase = 'preparing' | 'sending';

/**
 * `@/ai`: the optional Gemini reading of a photo. Off by default, and nothing of it is loaded
 * until the user presses "Citește cu AI" and confirms what is sent.
 */
export interface AiPort {
  /** True when the user switched the feature on and saved a key. Reads this device's settings, no network. */
  isEnabled(db: PretometruDB): Promise<boolean>;
  /**
   * Reads a photo with Gemini: the one call that sends an image to Google. Call it only after the
   * user confirmed. The receipt it answers with is validated like any engine's (`meta.engine` is
   * `gemini`). Rejects with an `AiError` (`describeAiError` of `@/ai` has its Romanian text).
   */
  readReceipt(
    image: Blob,
    options?: { signal?: AbortSignal; onPhase?: (phase: AiReadPhase) => void },
  ): Promise<ParsedReceipt>;
}
