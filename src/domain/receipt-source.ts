import { z } from 'zod';
import type { ParsedReceipt } from './parsed-receipt';

/** pdf.js user space, origin bottom-left. */
export const PdfTextItemSchema = z.strictObject({
  str: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type PdfTextItem = z.infer<typeof PdfTextItemSchema>;

/** `confidence` uses Tesseract's 0-100 scale (parsers normalise to 0..1 in their output). */
export const OcrLineSchema = z.strictObject({
  text: z.string(),
  confidence: z.number().min(0).max(100),
  bbox: z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
});
export type OcrLine = z.infer<typeof OcrLineSchema>;

export const ReceiptSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('pdf-text'),
    pages: z.array(
      z.strictObject({
        width: z.number().positive(),
        height: z.number().positive(),
        items: z.array(PdfTextItemSchema),
      }),
    ),
  }),
  z.strictObject({
    kind: z.literal('ocr-text'),
    text: z.string(),
    lines: z.array(OcrLineSchema).optional(),
    confidence: z.number().min(0).max(100).optional(),
    imageSize: z.strictObject({ w: z.number().positive(), h: z.number().positive() }).optional(),
  }),
  z.strictObject({ kind: z.literal('pasted-text'), text: z.string() }),
]);
export type ReceiptSource = z.infer<typeof ReceiptSourceSchema>;

/**
 * Parsers are pure and deterministic: no DOM, IndexedDB or network. They never throw on malformed
 * input; they return a best-effort receipt plus `meta.warnings`.
 */
export interface ReceiptParser {
  /** e.g. 'kaufland' */
  id: string;
  /** semver */
  version: string;
  /** 0..1 confidence that this parser handles the document. */
  detect(source: ReceiptSource): number;
  parse(source: ReceiptSource): ParsedReceipt;
}
