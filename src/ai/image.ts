import { AiError, isAiError } from './errors';
import type { PreparedImage } from './types';

/**
 * What a photo is cut down to before it leaves the device. 3.5 megapixels is more than a model
 * uses (from Gemini 3 on an image costs 1120 tokens at the default resolution), keeps small
 * print legible on a long receipt, and bounds the request far below Google's 20 MB.
 */
export const IMAGE_LIMITS = {
  maxPixels: 3_500_000,
  maxSide: 4096,
  /** JPEG quality, 0..1. */
  quality: 0.85,
  /** What an encoded image may weigh: a safety net for noise that does not compress. */
  maxBytes: 12 * 1024 * 1024,
} as const;

export type ImageLimits = typeof IMAGE_LIMITS;

/**
 * The size an image of `width` x `height` is scaled to: never larger than it is, at most
 * `maxPixels` pixels and `maxSide` on a side, whole pixels, same proportions.
 */
export function fitWithin(
  width: number,
  height: number,
  limits: Pick<ImageLimits, 'maxPixels' | 'maxSide'> = IMAGE_LIMITS,
): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) throw new RangeError('An image has a positive size');
  const scale = Math.min(
    1,
    Math.sqrt(limits.maxPixels / (width * height)),
    limits.maxSide / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function contextOf(canvas: AnyCanvas): AnyContext {
  const context =
    canvas instanceof HTMLCanvasElement ? canvas.getContext('2d') : canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is not available');
  return context;
}

function encodeJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error('The canvas could not be encoded'));
        },
        'image/jpeg',
        quality,
      );
    });
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality });
}

const unreadable = (cause?: unknown) =>
  new AiError('IMAGE_UNREADABLE', 'The photo cannot be prepared for sending', {
    ...(cause === undefined ? {} : { cause }),
  });

/**
 * Decodes a photo (EXIF rotation applied), scales it down (`fitWithin`) and encodes it again as
 * JPEG on a white background. Drawing it anew is what drops everything the file carried besides
 * its pixels: EXIF (location, camera, time), embedded thumbnails and colour profiles. Browser
 * only (canvas). Fails with `IMAGE_UNREADABLE` rather than ever returning the original file: a
 * format this browser cannot decode is not sent as it is.
 */
export async function prepareImage(
  image: Blob,
  limits: ImageLimits = IMAGE_LIMITS,
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(image, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(image);
    } catch (cause) {
      throw unreadable(cause);
    }
  }

  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, limits);
    const canvas = createCanvas(width, height);
    const context = contextOf(canvas);
    // Transparent screenshots are composited on white, like a printed receipt.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, width, height);

    const jpeg = await encodeJpeg(canvas, limits.quality);
    if (jpeg.type !== 'image/jpeg' || jpeg.size === 0 || jpeg.size > limits.maxBytes) {
      throw new Error('The re-encoded photo is not a usable JPEG');
    }
    const bytes = new Uint8Array(await jpeg.arrayBuffer());
    return { mimeType: 'image/jpeg', base64: base64Of(bytes), width, height, bytes: bytes.length };
  } catch (error) {
    throw isAiError(error) ? error : unreadable(error);
  } finally {
    bitmap.close();
  }
}
