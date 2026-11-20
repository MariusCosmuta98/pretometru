import { describe, expect, it } from 'vitest';
import { directionOf, percentChange, priceChange } from './trend';
import { paid } from './testing';

describe('percentChange', () => {
  it('gives the relative change with one decimal, rounded half away from zero', () => {
    expect(percentChange(200, 215)).toBe(7.5);
    expect(percentChange(200, 185)).toBe(-7.5);
    expect(percentChange(3, 4)).toBe(33.3);
    expect(percentChange(145_000, 130_000)).toBe(-10.3);
  });

  it('returns a plain 0, never -0', () => {
    expect(Object.is(percentChange(1000, 1000), 0)).toBe(true);
    expect(Object.is(percentChange(100_000, 99_999), 0)).toBe(true);
  });
});

describe('directionOf', () => {
  it('treats changes under half a percent as flat', () => {
    expect(directionOf(0.4)).toBe('flat');
    expect(directionOf(-0.4)).toBe('flat');
    expect(directionOf(0.5)).toBe('up');
    expect(directionOf(-0.5)).toBe('down');
  });
});

describe('priceChange', () => {
  it('compares the latest purchase with the previous one at the same store', () => {
    const change = priceChange([
      paid('kaufland', '2026-10-01', 200_000),
      paid('kaufland', '2026-11-07', 215_000),
    ]);
    expect(change).toMatchObject({
      deltaMilliBani: 15_000,
      pct: 7.5,
      direction: 'up',
      from: { date: '2026-10-01' },
      to: { date: '2026-11-07' },
    });
  });

  it('is not fooled by buying at another store in between', () => {
    const change = priceChange([
      paid('kaufland', '2026-10-01', 200_000),
      paid('metro', '2026-10-20', 130_000), // cheaper elsewhere: not a price drop
      paid('kaufland', '2026-11-07', 190_000),
    ]);
    expect(change).toMatchObject({ pct: -5, direction: 'down', from: { date: '2026-10-01' } });
  });

  it('has no trend when the latest store has no earlier purchase', () => {
    expect(
      priceChange([paid('kaufland', '2026-10-01', 200_000), paid('metro', '2026-11-07', 130_000)]),
    ).toBeUndefined();
    expect(priceChange([paid('kaufland', '2026-10-01', 200_000)])).toBeUndefined();
    expect(priceChange([])).toBeUndefined();
  });

  it('does not compare two lines of the same receipt', () => {
    const first = paid('kaufland', '2026-11-07', 200_000, { receiptId: 'r1' });
    const second = paid('kaufland', '2026-11-07', 150_000, { receiptId: 'r1' });
    expect(priceChange([first, second])).toBeUndefined();
  });

  it('reports an unchanged price as flat', () => {
    const change = priceChange([
      paid('kaufland', '2026-10-01', 200_000),
      paid('kaufland', '2026-11-07', 200_000),
    ]);
    expect(change).toMatchObject({ deltaMilliBani: 0, pct: 0, direction: 'flat' });
  });

  it('does not depend on the order it is given', () => {
    const a = paid('kaufland', '2026-10-01', 200_000);
    const b = paid('kaufland', '2026-11-07', 215_000);
    expect(priceChange([b, a])).toEqual(priceChange([a, b]));
  });
});
