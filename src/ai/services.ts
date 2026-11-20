import { getDb, type PretometruDB } from '@/storage';
import type { PreparedImage } from './types';

/** Everything the AI reading and its settings depend on, injectable for tests. */
export interface AiServices {
  getDb: () => Promise<PretometruDB>;
  /** The only network door of the module: tests answer with an in-memory Gemini. */
  fetch: typeof fetch;
  now: () => Date;
  isOnline: () => boolean;
  /** Resizes and re-encodes a photo before it is sent. The default uses the browser's canvas; tests replace it. */
  prepareImage?: (image: Blob) => Promise<PreparedImage>;
}

const defaults: AiServices = {
  getDb,
  // Called through an arrow: `fetch` throws "Illegal invocation" when it is a method of another object.
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => new Date(),
  isOnline: () => globalThis.navigator?.onLine !== false,
};

let current: AiServices = defaults;

/** The services the module uses: the real ones unless `setAiServices` replaced some. */
export function getAiServices(): AiServices {
  return current;
}

/** Replaces some services (tests). `resetAiServices` undoes it. */
export function setAiServices(overrides: Partial<AiServices>): void {
  current = { ...defaults, ...overrides };
}

export function resetAiServices(): void {
  current = defaults;
}
