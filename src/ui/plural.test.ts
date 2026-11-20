import { describe, expect, it } from 'vitest';
import { plural } from './plural';

describe('plural', () => {
  it.each([
    [0, '0 produse'],
    [1, '1 produs'],
    [2, '2 produse'],
    [19, '19 produse'],
    [20, '20 de produse'],
    [100, '100 de produse'],
    [101, '101 produse'],
    [119, '119 produse'],
    [120, '120 de produse'],
    [1234, '1.234 de produse'],
  ])('writes %i as "%s"', (count, text) => {
    expect(plural(count, 'produs', 'produse')).toBe(text);
  });
});
