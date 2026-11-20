/**
 * Pure pixel pipeline that makes a receipt photo or screenshot easier for Tesseract: pick one colour
 * channel, upscale, stretch the contrast and binarise. It works on plain typed arrays so it runs
 * the same in the browser, in a worker and under Node (the local benchmark).
 *
 * Plan §3: green channel + threshold + 3x upscale raised the OCR confidence of the low-resolution
 * Mega Image photo from 21 to 67. Every step is tunable through `PreprocessOptions`.
 */

/** 4 bytes per pixel (R, G, B, A), the layout of canvas `ImageData`. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** 1 byte per pixel, 0 = black, 255 = white. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

export type Channel = 'green' | 'red' | 'blue' | 'luma' | 'min';
/** `'otsu'` picks the level automatically, a number is a fixed level 0..255, `'none'` keeps the grey levels. */
export type Threshold = 'otsu' | 'none' | number;

export interface PreprocessOptions {
  /** Which colour information becomes the grey image. Green suppresses most coloured watermarks and stamps. */
  channel: Channel;
  /** Upscale factor (>= 1). Reduced when the result would exceed `maxPixels`. */
  scale: number;
  /** Largest output area; iOS Safari limits canvases to about 16.7 megapixels, so stay below it. */
  maxPixels: number;
  /** Stretch the 1st..99th percentile of the grey levels to the full range before thresholding. */
  stretch: boolean;
  threshold: Threshold;
}

export const DEFAULT_PREPROCESS: PreprocessOptions = {
  channel: 'green',
  scale: 3,
  maxPixels: 12_000_000,
  stretch: true,
  threshold: 'otsu',
};

export interface PreprocessResult {
  image: GrayImage;
  /** The upscale actually applied (`options.scale` reduced to respect `maxPixels`); 1 or more. */
  scale: number;
}

/** Transparent pixels are composited on white, as a screenshot with an alpha channel would show. */
export function toGray(source: RgbaImage, channel: Channel): GrayImage {
  const { width, height, data } = source;
  const out = new Uint8Array(width * height);
  const pick = (r: number, g: number, b: number): number => {
    switch (channel) {
      case 'red':
        return r;
      case 'green':
        return g;
      case 'blue':
        return b;
      case 'min':
        return Math.min(r, g, b);
      case 'luma':
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }
  };
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const value = pick(data[p] ?? 0, data[p + 1] ?? 0, data[p + 2] ?? 0);
    const alpha = data[p + 3] ?? 255;
    out[i] = alpha === 255 ? value : Math.round((value * alpha + 255 * (255 - alpha)) / 255);
  }
  return { width, height, data: out };
}

/** Bilinear resampling with pixel-centre alignment, so the edges of the image stay put. */
export function resizeBilinear(source: GrayImage, outWidth: number, outHeight: number): GrayImage {
  const { width, height, data } = source;
  if (outWidth === width && outHeight === height) return source;

  const out = new Uint8Array(outWidth * outHeight);
  const ratioX = width / outWidth;
  const ratioY = height / outHeight;

  const x0 = new Int32Array(outWidth);
  const x1 = new Int32Array(outWidth);
  const fx = new Float32Array(outWidth);
  for (let x = 0; x < outWidth; x++) {
    const sx = Math.min(Math.max((x + 0.5) * ratioX - 0.5, 0), width - 1);
    x0[x] = Math.floor(sx);
    x1[x] = Math.min(x0[x]! + 1, width - 1);
    fx[x] = sx - x0[x]!;
  }

  for (let y = 0; y < outHeight; y++) {
    const sy = Math.min(Math.max((y + 0.5) * ratioY - 0.5, 0), height - 1);
    const y0 = Math.floor(sy);
    const row0 = y0 * width;
    const row1 = Math.min(y0 + 1, height - 1) * width;
    const wy = sy - y0;
    const outRow = y * outWidth;
    for (let x = 0; x < outWidth; x++) {
      const a = x0[x]!;
      const b = x1[x]!;
      const wx = fx[x]!;
      const top = data[row0 + a]! * (1 - wx) + data[row0 + b]! * wx;
      const bottom = data[row1 + a]! * (1 - wx) + data[row1 + b]! * wx;
      out[outRow + x] = Math.round(top * (1 - wy) + bottom * wy);
    }
  }
  return { width: outWidth, height: outHeight, data: out };
}

export function histogram(image: GrayImage): Uint32Array {
  const bins = new Uint32Array(256);
  for (const value of image.data) bins[value]!++;
  return bins;
}

/** Otsu's level: pixels `<=` it are ink. Returns 127 for an image with a single grey level. */
export function otsuLevel(bins: Uint32Array): number {
  let total = 0;
  let weighted = 0;
  for (let level = 0; level < 256; level++) {
    total += bins[level]!;
    weighted += level * bins[level]!;
  }
  let backgroundCount = 0;
  let backgroundSum = 0;
  let best = -1;
  let bestLevel = 127;
  for (let level = 0; level < 255; level++) {
    backgroundCount += bins[level]!;
    if (backgroundCount === 0) continue;
    const foregroundCount = total - backgroundCount;
    if (foregroundCount === 0) break;
    backgroundSum += level * bins[level]!;
    const backgroundMean = backgroundSum / backgroundCount;
    const foregroundMean = (weighted - backgroundSum) / foregroundCount;
    const variance = backgroundCount * foregroundCount * (backgroundMean - foregroundMean) ** 2;
    if (variance > best) {
      best = variance;
      bestLevel = level;
    }
  }
  return bestLevel;
}

/** Levels at the given cumulative fractions (0..1) of the pixels. */
export function percentileLevels(bins: Uint32Array, fractions: readonly number[]): number[] {
  let total = 0;
  for (const count of bins) total += count;
  return fractions.map((fraction) => {
    const target = fraction * total;
    let seen = 0;
    for (let level = 0; level < 256; level++) {
      seen += bins[level]!;
      if (seen >= target) return level;
    }
    return 255;
  });
}

/** Maps the 1st..99th percentile to 0..255 (in place). A flat image is left alone. */
export function stretchContrast(image: GrayImage): GrayImage {
  const [low = 0, high = 255] = percentileLevels(histogram(image), [0.01, 0.99]);
  if (high - low < 8) return image;
  const lut = new Uint8Array(256);
  for (let level = 0; level < 256; level++) {
    lut[level] = Math.min(255, Math.max(0, Math.round(((level - low) * 255) / (high - low))));
  }
  const { data } = image;
  for (let i = 0; i < data.length; i++) data[i] = lut[data[i]!]!;
  return image;
}

/** Pixels `<=` `level` become black (0), the others white (255), in place. */
export function binarize(image: GrayImage, level: number): GrayImage {
  const { data } = image;
  for (let i = 0; i < data.length; i++) data[i] = data[i]! <= level ? 0 : 255;
  return image;
}

/** The scale that keeps `width * height * scale^2` within `maxPixels`, never below 1. */
export function effectiveScale(
  width: number,
  height: number,
  scale: number,
  maxPixels: number,
): number {
  const fit = Math.sqrt(maxPixels / (width * height));
  return Math.max(1, Math.min(scale, fit));
}

export function preprocess(
  source: RgbaImage,
  overrides: Partial<PreprocessOptions> = {},
): PreprocessResult {
  const options = { ...DEFAULT_PREPROCESS, ...overrides };
  const gray = toGray(source, options.channel);

  const factor = effectiveScale(gray.width, gray.height, options.scale, options.maxPixels);
  const outWidth = Math.max(1, Math.round(gray.width * factor));
  const outHeight = Math.max(1, Math.round(gray.height * factor));
  let image = resizeBilinear(gray, outWidth, outHeight);

  if (options.stretch) image = stretchContrast(image);
  if (options.threshold !== 'none') {
    const level =
      options.threshold === 'otsu' ? otsuLevel(histogram(image)) : Math.round(options.threshold);
    image = binarize(image, level);
  }
  return { image, scale: outWidth / gray.width };
}
