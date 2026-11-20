import type { ReceiptSource } from '@/domain';
import { defaultEngineConfig, sharedEngine, type EngineStatus } from './engine';
import { OcrError } from './errors';
import { decodeBitmap, readPixels } from './image-io';
import { toOcrText } from './lines';
import { encodePng } from './png';
import { preprocess, type PreprocessOptions } from './preprocess';

export type OcrTextSource = Extract<ReceiptSource, { kind: 'ocr-text' }>;

export interface RecognizeOptions {
  /** Aborting terminates the OCR worker and rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Overall progress, 0..1 and never decreasing (engine start, then recognition). */
  onProgress?: (fraction: number) => void;
  /** Changes to the image preprocessing (see `DEFAULT_PREPROCESS`). */
  preprocessing?: Partial<PreprocessOptions>;
}

// Photos above this size are shrunk before the pixels are read (RGBA needs 4 bytes per pixel).
const MAX_INPUT_PIXELS = 16_000_000;

// Share of the overall progress: decoding and preprocessing, engine start, recognition.
const PREPARED = 0.1;
const STARTED = 0.35;

const STARTUP_STATUSES = [
  'loading tesseract core',
  'initializing tesseract',
  'loading language traineddata',
  'initializing api',
];

function progressOf(event: EngineStatus): number | undefined {
  const phase = STARTUP_STATUSES.indexOf(event.status);
  if (phase >= 0) {
    return PREPARED + ((STARTED - PREPARED) * (phase + event.progress)) / STARTUP_STATUSES.length;
  }
  if (event.status === 'recognizing text') return STARTED + (1 - STARTED) * event.progress;
  return undefined;
}

/**
 * Reads a receipt photo or screenshot with Tesseract.js (WASM, in a worker, files from our own
 * origin). The image is preprocessed first (green channel, upscale, threshold; see
 * `src/ocr/preprocess.ts`). The result is the parsers' `ocr-text` source: `text` has one printed
 * row per line, `lines[i]` is row `i` with its Tesseract confidence (0-100) and its box in pixels
 * of the ORIGINAL image (feed it to `cropRegion`), `confidence` is the page mean.
 */
export async function recognizeImage(
  image: Blob,
  options: RecognizeOptions = {},
): Promise<OcrTextSource> {
  const { signal, onProgress } = options;
  let reported = 0;
  const report = (fraction: number) => {
    reported = Math.max(reported, Math.min(1, fraction));
    onProgress?.(reported);
  };

  signal?.throwIfAborted();
  report(0);
  const decoded = await decodeBitmap(image);
  let png: Uint8Array;
  let scale: number;
  try {
    const pixels = readPixels(decoded, MAX_INPUT_PIXELS);
    const prepared = preprocess(pixels.image, options.preprocessing);
    png = encodePng(prepared.image);
    scale = prepared.scale * pixels.inputScale;
  } finally {
    decoded.bitmap.close();
  }
  const imageSize = { w: decoded.width, h: decoded.height };
  report(PREPARED);

  let page;
  try {
    page = await sharedEngine.run(defaultEngineConfig(), png, {
      signal,
      onStatus: (event) => {
        const fraction = progressOf(event);
        if (fraction !== undefined) report(fraction);
      },
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new OcrError('ENGINE_FAILED', 'The OCR engine failed', { cause: error });
  }

  const { text, lines, confidence } = toOcrText(page, { scale, imageSize });
  report(1);
  return { kind: 'ocr-text', text, lines, confidence, imageSize };
}
