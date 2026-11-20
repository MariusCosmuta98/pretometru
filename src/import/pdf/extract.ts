import type { ReceiptSource } from '@/domain';
import { loadPdfJs, type PdfJs } from './pdfjs';

type PdfTextSource = Extract<ReceiptSource, { kind: 'pdf-text' }>;
type PdfItem = PdfTextSource['pages'][number]['items'][number];

/** The slice of pdf.js that the conversion reads (so tests can stand in for a document). */
export interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
}

export interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: readonly unknown[] }>;
  cleanup?(): unknown;
}

interface RawTextItem {
  str: string;
  transform: ArrayLike<number>;
  width: number;
  height: number;
}

const isTextItem = (value: unknown): value is RawTextItem =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as RawTextItem).str === 'string' &&
  (value as RawTextItem).transform?.length >= 6;

/**
 * pdf.js text items in the shape of `ReceiptSource` (docs/contracts.md): user space, origin
 * bottom-left, in the order pdf.js returns them. Empty strings are dropped; whitespace-only items
 * stay, because their position tells the parsers where a column gap is.
 */
function toItems(raw: readonly unknown[]): PdfItem[] {
  const items: PdfItem[] = [];
  for (const entry of raw) {
    // Marked-content markers have no `str`.
    if (!isTextItem(entry) || entry.str === '') continue;
    items.push({
      str: entry.str,
      x: entry.transform[4] ?? 0,
      y: entry.transform[5] ?? 0,
      w: entry.width,
      h: entry.height,
    });
  }
  return items;
}

/** One entry per page, with the size of the page at scale 1 and the text items on it. */
export async function textSourceFromDocument(doc: PdfDocumentLike): Promise<PdfTextSource> {
  const pages: PdfTextSource['pages'] = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    try {
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      pages.push({ width, height, items: toItems(content.items) });
    } finally {
      page.cleanup?.();
    }
  }
  return { kind: 'pdf-text', pages };
}

/**
 * Reads the text layer of a PDF with pdf.js, in the shape the parsers expect. pdf.js and its worker
 * are bundled with the app (no CDN) and loaded on first use, so they stay out of the app shell.
 * Rejects when the file is not a readable PDF (corrupt, password-protected). A scanned PDF has no
 * text layer: it resolves with pages that have no items, and the caller can fall back to OCR.
 *
 * The caller's buffer is left intact (pdf.js would take ownership of the one it is handed).
 * `load` is a test seam; the default loads the bundled pdf.js.
 */
export async function extractPdfText(
  data: ArrayBuffer,
  load: () => Promise<PdfJs> = loadPdfJs,
): Promise<PdfTextSource> {
  const pdfjs = await load();
  const task = pdfjs.getDocument({
    data: new Uint8Array(data.slice(0)),
    // Text only: no images (no WASM decoders to fetch), no font loading on the page, no logging.
    useWasm: false,
    disableFontFace: true,
    verbosity: 0,
  });
  try {
    return await textSourceFromDocument(await task.promise);
  } finally {
    await task.destroy();
  }
}
