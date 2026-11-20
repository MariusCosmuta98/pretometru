/**
 * Where the OCR engine files are served from: our own origin, below `<base>ocr/` (plan §11: no CDN
 * at runtime). `config/ocr-assets.ts` copies the files there at build time and serves them in the
 * dev server; the names must stay in sync (`config/ocr-assets.test.ts` checks it).
 */

/** Tesseract language codes whose data is shipped: Romanian receipts with some English brand names. */
export const OCR_LANGUAGES = ['ron', 'eng'] as const;

export interface OcrAssetUrls {
  /** The Tesseract.js worker script. */
  workerPath: string;
  /** Directory of the WASM core variants; Tesseract.js picks one by SIMD support. */
  corePath: string;
  /** Directory of the `<code>.traineddata.gz` files. */
  langPath: string;
}

/** `base` is Vite's `import.meta.env.BASE_URL`. */
export function ocrAssetUrls(base: string): OcrAssetUrls {
  const root = `${base.endsWith('/') ? base : `${base}/`}ocr`;
  return {
    workerPath: `${root}/worker.min.js`,
    corePath: `${root}/core`,
    langPath: `${root}/lang`,
  };
}
