import { describe, expect, it } from 'vitest';
import { clampRegion } from './crop';

const size = { w: 100, h: 50 };

describe('clampRegion', () => {
  it('rounds the box outwards to whole pixels', () => {
    expect(clampRegion({ x: 10.4, y: 5.6, w: 20.2, h: 4 }, size)).toEqual({
      x: 10,
      y: 5,
      w: 21,
      h: 5,
    });
  });

  it('adds padding and clips to the image', () => {
    expect(clampRegion({ x: 2, y: 2, w: 96, h: 46 }, size, 5)).toEqual({
      x: 0,
      y: 0,
      w: 100,
      h: 50,
    });
  });

  it('clips a box that sticks out of the image', () => {
    expect(clampRegion({ x: 90, y: 40, w: 30, h: 30 }, size)).toEqual({
      x: 90,
      y: 40,
      w: 10,
      h: 10,
    });
  });

  it('returns undefined when no pixel is left', () => {
    expect(clampRegion({ x: 100, y: 0, w: 10, h: 10 }, size)).toBeUndefined();
    expect(clampRegion({ x: -20, y: 0, w: 10, h: 10 }, size)).toBeUndefined();
    expect(clampRegion({ x: 5, y: 5, w: 0, h: 10 }, size)).toBeUndefined();
    expect(clampRegion({ x: Number.NaN, y: 0, w: 10, h: 10 }, size)).toBeUndefined();
  });
});
