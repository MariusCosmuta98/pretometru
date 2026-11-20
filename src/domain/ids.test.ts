import { describe, expect, it } from 'vitest';
import { createIdGenerator, IdSchema, idTimestamp, newId } from './ids';

// 2023-11-14T22:13:20Z; "01HF7YAT00" is its Crockford base-32 form (computed independently of ids.ts).
const T = 1_700_000_000_000;
const TIME = '01HF7YAT00';
const zeros = (length: number) => new Uint8Array(length);

describe('createIdGenerator', () => {
  it('puts the clock in the first 10 characters and the 80 random bits in the last 16', () => {
    const next = createIdGenerator({
      now: () => T,
      randomBytes: (length) => new Uint8Array(length).fill(0xff),
    });
    expect(next()).toBe(`${TIME}ZZZZZZZZZZZZZZZZ`);
  });

  it('keeps ids strictly increasing within one millisecond', () => {
    const next = createIdGenerator({ now: () => T, randomBytes: zeros });
    expect([next(), next(), next()]).toEqual([
      `${TIME}0000000000000000`,
      `${TIME}0000000000000001`,
      `${TIME}0000000000000002`,
    ]);
  });

  it('carries into the next base-32 digit when incrementing', () => {
    const endsWithZ = (length: number) => {
      const bytes = new Uint8Array(length);
      bytes[length - 1] = 31;
      return bytes;
    };
    const next = createIdGenerator({ now: () => T, randomBytes: endsWithZ });
    expect(next()).toBe(`${TIME}000000000000000Z`);
    expect(next()).toBe(`${TIME}0000000000000010`);
  });

  it('never sorts an id before an earlier one, even if the clock steps back', () => {
    const clock = [T + 5, T, T - 1000];
    const next = createIdGenerator({ now: () => clock.shift() ?? T, randomBytes: zeros });
    const ids = [next(), next(), next()];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(3);
  });

  it('fails loudly instead of wrapping when the random part is exhausted in one millisecond', () => {
    const next = createIdGenerator({
      now: () => T,
      randomBytes: (length) => new Uint8Array(length).fill(0xff),
    });
    next();
    expect(() => next()).toThrow(/exhausted/);
  });
});

describe('idTimestamp', () => {
  it('reads the creation time back from an id', () => {
    expect(idTimestamp(`${TIME}0000000000000000`)).toBe(T);
  });
});

describe('IdSchema', () => {
  it('accepts generated ids and well-known (time = 0) ids', () => {
    expect(IdSchema.safeParse(newId()).success).toBe(true);
    expect(IdSchema.safeParse('0000000000SEEDCATEG0000001').success).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['lowercase', '01hf7yat000000000000000000'],
    ['too short', '01HF7YAT0000000000000000'],
    ['too long', '01HF7YAT0000000000000000000'],
    ['letter I (not in the alphabet)', '01HF7YAT00000000000000000I'],
    ['letter U (not in the alphabet)', '01HF7YAT00000000000000000U'],
    ['timestamp overflow (first char above 7)', '81HF7YAT000000000000000000'],
  ])('rejects %s', (_label, value) => {
    expect(IdSchema.safeParse(value).success).toBe(false);
  });
});
