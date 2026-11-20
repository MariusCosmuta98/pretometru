import { describe, expect, it } from 'vitest';
import {
  binarize,
  DEFAULT_PREPROCESS,
  effectiveScale,
  histogram,
  otsuLevel,
  preprocess,
  resizeBilinear,
  stretchContrast,
  toGray,
  type GrayImage,
  type RgbaImage,
} from './preprocess';

const gray = (width: number, height: number, values: number[]): GrayImage => ({
  width,
  height,
  data: Uint8Array.from(values),
});

const repeat = (value: number, times: number) => Array.from({ length: times }, () => value);

const rgba = (width: number, height: number, pixels: Array<[number, number, number, number?]>) =>
  ({
    width,
    height,
    data: Uint8ClampedArray.from(pixels.flatMap(([r, g, b, a = 255]) => [r, g, b, a])),
  }) satisfies RgbaImage;

describe('toGray', () => {
  const image = rgba(1, 1, [[200, 100, 50]]);

  it('picks the requested channel', () => {
    expect(toGray(image, 'red').data[0]).toBe(200);
    expect(toGray(image, 'green').data[0]).toBe(100);
    expect(toGray(image, 'blue').data[0]).toBe(50);
    expect(toGray(image, 'min').data[0]).toBe(50);
    expect(toGray(image, 'luma').data[0]).toBe(Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50));
  });

  it('composites transparent pixels on white', () => {
    const out = toGray(
      rgba(2, 1, [
        [0, 0, 0, 0],
        [0, 0, 0, 128],
      ]),
      'green',
    );
    expect([...out.data]).toEqual([255, 127]);
  });
});

describe('resizeBilinear', () => {
  it('returns the same image for the same size', () => {
    const image = gray(2, 2, [1, 2, 3, 4]);
    expect(resizeBilinear(image, 2, 2)).toBe(image);
  });

  it('keeps a flat image flat and gives the requested size', () => {
    const out = resizeBilinear(gray(2, 2, [90, 90, 90, 90]), 6, 6);
    expect([out.width, out.height, out.data.length]).toEqual([6, 6, 36]);
    expect(new Set(out.data)).toEqual(new Set([90]));
  });

  it('interpolates a ramp monotonically and keeps its end points', () => {
    const out = resizeBilinear(gray(2, 1, [0, 200]), 6, 1);
    expect([...out.data]).toEqual([...out.data].sort((a, b) => a - b));
    expect(out.data[0]).toBe(0);
    expect(out.data[5]).toBe(200);
  });
});

describe('thresholding', () => {
  it('finds the level between two clusters of grey', () => {
    const image = gray(10, 2, [...repeat(30, 10), ...repeat(200, 10)]);
    const level = otsuLevel(histogram(image));
    expect(level).toBeGreaterThanOrEqual(30);
    expect(level).toBeLessThan(200);
    expect([...binarize(image, level).data]).toEqual([...repeat(0, 10), ...repeat(255, 10)]);
  });

  it('does not fail on an image with one grey level', () => {
    expect(otsuLevel(histogram(gray(2, 2, [77, 77, 77, 77])))).toBe(127);
  });

  it('stretches a flat-ish image to the full range but leaves a flat one alone', () => {
    const low = gray(10, 1, [100, 100, 100, 100, 100, 140, 140, 140, 140, 140]);
    const stretched = stretchContrast(low);
    expect(Math.min(...stretched.data)).toBe(0);
    expect(Math.max(...stretched.data)).toBe(255);

    const flat = gray(2, 1, [120, 121]);
    expect([...stretchContrast(flat).data]).toEqual([120, 121]);
  });
});

describe('effectiveScale', () => {
  it('limits the output area and never goes below 1', () => {
    expect(effectiveScale(100, 100, 3, 1_000_000)).toBe(3);
    expect(effectiveScale(1000, 1000, 3, 4_000_000)).toBe(2);
    expect(effectiveScale(5000, 5000, 3, 4_000_000)).toBe(1);
  });
});

describe('preprocess', () => {
  // dark "ink" cross on white paper, with a red stamp that only the red channel can ignore
  const ink: [number, number, number] = [10, 10, 10];
  const paper: [number, number, number] = [250, 250, 250];
  const stamp: [number, number, number] = [255, 90, 90];
  const source = rgba(4, 1, [ink, paper, stamp, paper]);

  it('returns an upscaled black-and-white image and reports the scale', () => {
    const { image, scale } = preprocess(source, { scale: 3 });
    expect([image.width, image.height, scale]).toEqual([12, 3, 3]);
    expect(new Set(image.data)).toEqual(new Set([0, 255]));
  });

  it('can ignore a red stamp by reading the red channel', () => {
    const { image } = preprocess(source, { channel: 'red', scale: 1 });
    expect([...image.data]).toEqual([0, 255, 255, 255]);
  });

  it('keeps grey levels when the threshold is "none" and honours a fixed level', () => {
    const smooth = preprocess(source, { scale: 1, threshold: 'none', stretch: false });
    expect([...smooth.image.data]).toEqual([10, 250, 90, 250]);
    const fixed = preprocess(source, { scale: 1, threshold: 100, stretch: false });
    expect([...fixed.image.data]).toEqual([0, 255, 0, 255]);
  });

  it('shrinks the upscale to respect maxPixels and reports what was applied', () => {
    const big = rgba(
      100,
      100,
      Array.from({ length: 10_000 }, () => paper),
    );
    const { image, scale } = preprocess(big, { scale: 3, maxPixels: 40_000 });
    expect(scale).toBe(2);
    expect(image.width * image.height).toBeLessThanOrEqual(40_000);
    expect(DEFAULT_PREPROCESS.maxPixels).toBeLessThan(16_777_216);
  });
});
