import { getDb, type PretometruDB } from '@/storage';
import { DEFAULT_PASSPHRASE_ITERATIONS } from './vault';

/** Everything the sync and its screen depend on, injectable for tests. */
export interface SyncServices {
  getDb: () => Promise<PretometruDB>;
  /** The only network door: tests answer with an in-memory GitHub. */
  fetch: typeof fetch;
  now: () => Date;
  isOnline: () => boolean;
  sleep: (ms: number) => Promise<void>;
  /** A short id that tells this device's commits apart in the repository history. */
  newDeviceId: () => string;
  /** PBKDF2 rounds for a new passphrase (tests lower it). */
  passphraseIterations: number;
}

// Crockford's alphabet, as in ULIDs.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomDeviceId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) =>
    ALPHABET.charAt(byte % ALPHABET.length),
  ).join('');
}

const defaults: SyncServices = {
  getDb,
  // Called through an arrow: `fetch` throws "Illegal invocation" when it is a method of another object.
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
  isOnline: () => globalThis.navigator?.onLine !== false,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newDeviceId: randomDeviceId,
  passphraseIterations: DEFAULT_PASSPHRASE_ITERATIONS,
};

let current: SyncServices = defaults;

/** The services the sync uses: the real ones unless `setSyncServices` replaced some. */
export function getSyncServices(): SyncServices {
  return current;
}

/** Replaces some services (tests). `resetSyncServices` undoes it. */
export function setSyncServices(overrides: Partial<SyncServices>): void {
  current = { ...defaults, ...overrides };
}

export function resetSyncServices(): void {
  current = defaults;
}
