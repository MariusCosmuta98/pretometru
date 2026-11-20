import { z } from 'zod';

// Crockford base 32 (no I, L, O, U), as used by ULIDs: 48-bit millisecond clock + 80 random bits.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;
const RANDOM_BYTES = 10;
const RANDOM_LIMIT = 1n << 80n;

export const ULID_PATTERN = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Record id: a ULID. Sortable by creation time and generated offline on any device. */
export const IdSchema = z.string().regex(ULID_PATTERN, 'Invalid id (expected a 26-character ULID)');
export type Id = z.infer<typeof IdSchema>;

function encode(value: bigint, length: number): string {
  let out = '';
  let rest = value;
  for (let i = 0; i < length; i++) {
    out = ALPHABET.charAt(Number(rest & 31n)) + out;
    rest >>= 5n;
  }
  return out;
}

function defaultRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

export interface IdGeneratorOptions {
  now?: () => number;
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Monotonic ULID generator: ids stay strictly increasing within a millisecond and when the clock
 * steps backwards, so creation order is always recoverable by sorting ids.
 */
export function createIdGenerator({
  now = Date.now,
  randomBytes = defaultRandomBytes,
}: IdGeneratorOptions = {}): () => Id {
  let lastTime = -1;
  let lastRandom = 0n;

  return () => {
    const time = Math.max(now(), lastTime);
    let random: bigint;
    if (time === lastTime) {
      random = lastRandom + 1n;
      if (random >= RANDOM_LIMIT) {
        throw new Error('ULID random part exhausted within one millisecond');
      }
    } else {
      random = randomBytes(RANDOM_BYTES).reduce((acc, byte) => (acc << 8n) | BigInt(byte), 0n);
    }
    lastTime = time;
    lastRandom = random;
    return encode(BigInt(time), TIME_CHARS) + encode(random, RANDOM_CHARS);
  };
}

/** Default generator used for all new records. */
export const newId = createIdGenerator();

/** Creation time (epoch ms) encoded in an id. Well-known seed ids decode to 0. */
export function idTimestamp(id: Id): number {
  return [...IdSchema.parse(id).slice(0, TIME_CHARS)].reduce(
    (acc, char) => acc * 32 + ALPHABET.indexOf(char),
    0,
  );
}
