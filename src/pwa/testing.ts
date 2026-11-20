/**
 * Test-only: an in-memory Cache API (`caches`) and a recording `fetch`. Never import this from
 * application code.
 */
import type { CacheLike, CacheStorageLike } from './cache-store';

interface Stored {
  body: Blob;
  status: number;
  headers: [string, string][];
}

const respond = ({ body, status, headers }: Stored) => new Response(body, { status, headers });

export function fakeCacheStorage(): CacheStorageLike {
  const stores = new Map<string, Map<string, Stored>>();

  const cacheOf = (store: Map<string, Stored>): CacheLike => ({
    match: (url) => {
      const stored = store.get(url);
      return Promise.resolve(stored && respond(stored));
    },
    put: async (url, response) => {
      store.set(url, {
        body: await response.blob(),
        status: response.status,
        headers: [...response.headers.entries()],
      });
    },
    keys: () => Promise.resolve([...store.keys()].map((url) => ({ url }))),
    delete: (url) => Promise.resolve(store.delete(url)),
  });

  return {
    open: (name) => {
      let store = stores.get(name);
      if (!store) {
        store = new Map();
        stores.set(name, store);
      }
      return Promise.resolve(cacheOf(store));
    },
    has: (name) => Promise.resolve(stores.has(name)),
    keys: () => Promise.resolve([...stores.keys()]),
    delete: (name) => Promise.resolve(stores.delete(name)),
  };
}

export interface FakeNetwork {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** Every request made, in order. */
  requests: Array<{ url: string; cache: RequestCache | undefined }>;
  /** URLs that answer with this status instead of 200; `0` makes the request fail like a lost connection. */
  failing: Map<string, number>;
}

/** A network whose every URL answers 200 with its own URL as the body, unless listed in `failing`. */
export function fakeNetwork(): FakeNetwork {
  const requests: FakeNetwork['requests'] = [];
  const failing = new Map<string, number>();
  return {
    requests,
    failing,
    fetch: (url, init) => {
      requests.push({ url, cache: init?.cache });
      const status = failing.get(url) ?? 200;
      if (status === 0) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(`body of ${url}`, { status }));
    },
  };
}
