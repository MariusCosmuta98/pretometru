import { OcrError } from './errors';
import type { RgbaImage } from './preprocess';

/** Browser-only image decoding and encoding (canvas). Everything else in `src/ocr` is pure. */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface Decoded {
  /** The decoded bitmap at full resolution, EXIF orientation applied. Close it when done. */
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export async function decodeBitmap(blob: Blob): Promise<Decoded> {
  let bitmap: ImageBitmap;
  try {
    // Photos carry their rotation in EXIF; the boxes and the crops must use the same upright pixels.
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(blob);
    } catch (error) {
      throw new OcrError('DECODE_FAILED', 'The file is not an image this browser can read', {
        cause: error,
      });
    }
  }
  return { bitmap, width: bitmap.width, height: bitmap.height };
}

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: AnyCanvas): AnyContext {
  const context =
    canvas instanceof HTMLCanvasElement
      ? canvas.getContext('2d', { willReadFrequently: true })
      : canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new OcrError('DECODE_FAILED', 'Canvas 2D is not available');
  return context;
}

export function canvasToBlob(canvas: AnyCanvas, type: string): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new OcrError('DECODE_FAILED', 'Cannot encode image')),
        type,
      ),
    );
  }
  return canvas.convertToBlob({ type });
}

/**
 * RGBA pixels of the image, shrunk first when it has more than `maxPixels` (a 48 MP photo would
 * need 190 MB as RGBA). `inputScale` (<= 1) is the factor between the returned and the original size.
 */
export function readPixels(
  decoded: Decoded,
  maxPixels: number,
): { image: RgbaImage; inputScale: number } {
  const { bitmap, width, height } = decoded;
  const inputScale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const outWidth = Math.max(1, Math.round(width * inputScale));
  const outHeight = Math.max(1, Math.round(height * inputScale));

  const canvas = createCanvas(outWidth, outHeight);
  const context = contextOf(canvas);
  // Transparent screenshots are composited on white, like a printed receipt.
  context.fillStyle = '#fff';
  context.fillRect(0, 0, outWidth, outHeight);
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, outWidth, outHeight);
  const { data } = context.getImageData(0, 0, outWidth, outHeight);
  return { image: { width: outWidth, height: outHeight, data }, inputScale: outWidth / width };
}

/** Copies a region of the full-resolution bitmap to a new PNG. */
export async function cropBitmap(
  bitmap: ImageBitmap,
  region: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  const canvas = createCanvas(region.w, region.h);
  const context = contextOf(canvas);
  context.drawImage(bitmap, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
  return canvasToBlob(canvas, 'image/png');
}
