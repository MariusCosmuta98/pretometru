import type { CacheStorageLike } from './cache-store';
import {
  ENGINE_CACHE_PREFIX,
  ENGINE_RULES,
  engineCacheName,
  engineOf,
  relativeToScope,
  type EngineEntry,
  type EngineId,
} from './offline-rules';

export interface EngineStatus {
  id: EngineId;
  /** Files the build ships for this engine, and how many of them are stored. */
  files: number;
  cached: number;
  bytes: number;
  cachedBytes: number;
}

export interface PrepareProgress {
  doneFiles: number;
  totalFiles: number;
  doneBytes: number;
  totalBytes: number;
}

export interface EngineCacheDeps {
  caches: CacheStorageLike;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** The service worker's scope, for example `https://host/pretometru/`. */
  scope: string;
  /** The engine files of the manifest (see `splitManifest`). */
  entries: readonly EngineEntry[];
}

export interface EngineCache {
  /** Cache-first. `waitUntil` keeps the worker alive while a fresh response is being stored. */
  handle(request: Request, waitUntil: (work: Promise<unknown>) => void): Promise<Response>;
  status(): Promise<EngineStatus[]>;
  /** Downloads every engine file that is not stored yet, one after the other. */
  prepare(onProgress?: (progress: PrepareProgress) => void): Promise<EngineStatus[]>;
  /** Deletes the caches of engine versions that the manifest no longer lists. */
  deleteStale(): Promise<void>;
}

const sum = (entries: readonly EngineEntry[]) =>
  entries.reduce((total, entry) => total + (entry.bytes ?? 0), 0);

/**
 * Stores each engine file the first time it is requested and serves it from there afterwards, so
 * importing a PDF or a photo works offline once the engine has been used (or prepared) online.
 * The files are not precached: they weigh about 18 MB, which no install step should download.
 */
export function createEngineCache({ caches, fetch, scope, entries }: EngineCacheDeps): EngineCache {
  const nameOf = (engine: EngineId) => engineCacheName(engine, entries);
  const urlOf = (entry: EngineEntry) => new URL(entry.url, scope).href;
  let preparing: Promise<EngineStatus[]> | undefined;
  const listeners = new Set<(progress: PrepareProgress) => void>();

  async function status(): Promise<EngineStatus[]> {
    return Promise.all(
      ENGINE_RULES.map(async ({ id }) => {
        const own = entries.filter((entry) => entry.engine === id);
        const stored = new Set<string>();
        const name = nameOf(id);
        if (await caches.has(name)) {
          for (const key of await (await caches.open(name)).keys()) stored.add(key.url);
        }
        const cached = own.filter((entry) => stored.has(urlOf(entry)));
        return {
          id,
          files: own.length,
          cached: cached.length,
          bytes: sum(own),
          cachedBytes: sum(cached),
        };
      }),
    );
  }

  async function download(): Promise<EngineStatus[]> {
    const totalBytes = sum(entries);
    let doneBytes = 0;
    let doneFiles = 0;
    for (const entry of entries) {
      const cache = await caches.open(nameOf(entry.engine));
      const url = urlOf(entry);
      if (!(await cache.match(url))) {
        const response = await fetch(url, { cache: 'reload' });
        if (response.status !== 200) throw new Error(`${entry.url}: HTTP ${response.status}`);
        await cache.put(url, response);
      }
      doneBytes += entry.bytes ?? 0;
      doneFiles += 1;
      const progress = { doneFiles, totalFiles: entries.length, doneBytes, totalBytes };
      for (const listener of listeners) listener(progress);
    }
    return status();
  }

  return {
    async handle(request, waitUntil) {
      const path = relativeToScope(request.url, scope);
      const engine = path === undefined ? undefined : engineOf(path);
      if (!engine) return fetch(request.url);

      const cache = await caches.open(nameOf(engine));
      const stored = await cache.match(request.url);
      if (stored) return stored;
      // The names are stable, so `reload` keeps a copy from before an engine update (the HTTP cache
      // may still hold it) from being stored under the new version.
      const response = await fetch(request.url, { cache: 'reload' });
      // A full response only; a failed copy (no space left) must not fail the page that asked.
      if (response.status === 200) {
        waitUntil(cache.put(request.url, response.clone()).catch(() => undefined));
      }
      return response;
    },

    status,

    prepare(onProgress) {
      if (onProgress) listeners.add(onProgress);
      preparing ??= download().finally(() => {
        preparing = undefined;
        listeners.clear();
      });
      return preparing;
    },

    async deleteStale() {
      const current = new Set(ENGINE_RULES.map(({ id }) => nameOf(id)));
      for (const name of await caches.keys()) {
        if (name.startsWith(ENGINE_CACHE_PREFIX) && !current.has(name)) await caches.delete(name);
      }
    },
  };
}
