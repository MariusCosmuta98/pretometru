import { OcrError } from './errors';
import { cropBitmap, decodeBitmap } from './image-io';

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The box rounded outwards to whole pixels, grown by `padding` and clipped to the image;
 * `undefined` when no pixel is left (outside the image, empty or NaN).
 */
export function clampRegion(
  box: Region,
  size: { w: number; h: number },
  padding = 0,
): Region | undefined {
  const x0 = Math.max(0, Math.floor(box.x - padding));
  const y0 = Math.max(0, Math.floor(box.y - padding));
  const x1 = Math.min(size.w, Math.ceil(box.x + box.w + padding));
  const y1 = Math.min(size.h, Math.ceil(box.y + box.h + padding));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}

/**
 * Cuts a region out of the original image (a line crop for the review screen). `bbox` is in
 * pixels of the original image, exactly as `recognizeImage` reports line boxes; it is clipped to
 * the image. `padding` (pixels, default 0) adds a margin so glyphs are not cut at the edge.
 * Resolves to a PNG; rejects with `OcrError('EMPTY_REGION')` when the region has no pixels.
 */
export async function cropRegion(
  image: Blob,
  bbox: Region,
  options: { padding?: number } = {},
): Promise<Blob> {
  const decoded = await decodeBitmap(image);
  try {
    const region = clampRegion(bbox, { w: decoded.width, h: decoded.height }, options.padding);
    if (!region) throw new OcrError('EMPTY_REGION', 'The region is outside the image');
    return await cropBitmap(decoded.bitmap, region);
  } finally {
    decoded.bitmap.close();
  }
}
