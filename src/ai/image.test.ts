import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fitWithin, IMAGE_LIMITS } from './image';

describe('fitWithin', () => {
  it('never enlarges an image that is small enough', () => {
    expect(fitWithin(800, 1200)).toEqual({ width: 800, height: 1200 });
    expect(fitWithin(1170, 2532)).toEqual({ width: 1170, height: 2532 });
  });

  it('shrinks a phone photo to the pixel budget, keeping its proportions', () => {
    const { width, height } = fitWithin(3024, 4032);
    expect(width * height).toBeLessThanOrEqual(IMAGE_LIMITS.maxPixels);
    expect(width * height).toBeGreaterThan(IMAGE_LIMITS.maxPixels * 0.99);
    expect(width / height).toBeCloseTo(3024 / 4032, 2);
  });

  it('limits a long screenshot on its side as well', () => {
    const { width, height } = fitWithin(1170, 9000);
    expect(height).toBeLessThanOrEqual(IMAGE_LIMITS.maxSide);
    expect(width * height).toBeLessThanOrEqual(IMAGE_LIMITS.maxPixels);
  });

  it('refuses a size that is not one', () => {
    for (const [w, h] of [
      [0, 10],
      [10, 0],
      [-1, 5],
      [Number.NaN, 5],
    ] as const) {
      expect(() => fitWithin(w, h)).toThrow(RangeError);
    }
  });

  it('always stays inside the limits, never grows, never collapses, and is stable', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30_000 }),
        fc.integer({ min: 1, max: 30_000 }),
        (w, h) => {
          const fitted = fitWithin(w, h);
          expect(fitted.width * fitted.height).toBeLessThanOrEqual(IMAGE_LIMITS.maxPixels);
          expect(Math.max(fitted.width, fitted.height)).toBeLessThanOrEqual(IMAGE_LIMITS.maxSide);
          expect(fitted.width).toBeGreaterThanOrEqual(1);
          expect(fitted.height).toBeGreaterThanOrEqual(1);
          expect(fitted.width).toBeLessThanOrEqual(w);
          expect(fitted.height).toBeLessThanOrEqual(h);
          expect(fitWithin(fitted.width, fitted.height)).toEqual(fitted);
        },
      ),
    );
  });
});
