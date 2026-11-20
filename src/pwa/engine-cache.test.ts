import { describe, expect, it } from 'vitest';
import { createEngineCache } from './engine-cache';
import { ENGINE_CACHE_PREFIX, engineCacheName, type EngineEntry } from './offline-rules';
import { fakeCacheStorage, fakeNetwork } from './testing';

const SCOPE = 'https://example.test/pretometru/';
const url = (path: string) => `${SCOPE}${path}`;

const ENTRIES: EngineEntry[] = [
  { url: 'assets/pdf.worker.min-AAA.mjs', revision: null, bytes: 100, engine: 'pdf' },
  { url: 'ocr/worker.min.js', revision: 'w1', bytes: 10, engine: 'ocr' },
  { url: 'ocr/core/tesseract-core-lstm.wasm.js', revision: 'c1', bytes: 400, engine: 'ocr' },
  { url: 'ocr/lang/ron.traineddata.gz', revision: 'l1', bytes: 200, engine: 'ocr' },
];

function setup(entries: readonly EngineEntry[] = ENTRIES) {
  const caches = fakeCacheStorage();
  const network = fakeNetwork();
  const background: Promise<unknown>[] = [];
  const cache = createEngineCache({ caches, fetch: network.fetch, scope: SCOPE, entries });
  return {
    caches,
    network,
    cache,
    request: (path: string) => new Request(url(path)),
    handle: (path: string) => cache.handle(new Request(url(path)), (work) => background.push(work)),
    settle: () => Promise.all(background),
  };
}

describe('handle (cache-first)', () => {
  it('fetches an engine file the first time, bypassing the HTTP cache, and keeps a copy', async () => {
    const { handle, settle, network, caches } = setup();

    const response = await handle('ocr/worker.min.js');
    expect(await response.text()).toBe(`body of ${url('ocr/worker.min.js')}`);
    await settle();

    expect(network.requests).toEqual([{ url: url('ocr/worker.min.js'), cache: 'reload' }]);
    const stored = await caches.open(engineCacheName('ocr', ENTRIES));
    expect((await stored.keys()).map((key) => key.url)).toEqual([url('ocr/worker.min.js')]);
  });

  it('serves the copy afterwards without touching the network: this is what makes it work offline', async () => {
    const { handle, settle, network } = setup();
    await handle('ocr/lang/ron.traineddata.gz');
    await settle();
    network.requests.length = 0;
    network.failing.set(url('ocr/lang/ron.traineddata.gz'), 0);

    const response = await handle('ocr/lang/ron.traineddata.gz');

    expect(await response.text()).toBe(`body of ${url('ocr/lang/ron.traineddata.gz')}`);
    expect(network.requests).toEqual([]);
  });

  it('keeps each engine in its own cache', async () => {
    const { handle, settle, caches } = setup();
    await handle('assets/pdf.worker.min-AAA.mjs');
    await handle('ocr/worker.min.js');
    await settle();

    expect((await caches.keys()).sort()).toEqual(
      [engineCacheName('ocr', ENTRIES), engineCacheName('pdf', ENTRIES)].sort(),
    );
  });

  it('does not store an error, and fails like the network when offline with nothing stored', async () => {
    const { handle, settle, network, caches } = setup();
    network.failing.set(url('ocr/worker.min.js'), 404);
    network.failing.set(url('ocr/lang/ron.traineddata.gz'), 0);

    expect((await handle('ocr/worker.min.js')).status).toBe(404);
    await expect(handle('ocr/lang/ron.traineddata.gz')).rejects.toThrow('Failed to fetch');
    await settle();

    // Nothing stored, and no empty cache left behind by the attempts.
    expect(await caches.keys()).toEqual([]);
  });

  it('still answers when the copy cannot be stored (no space left)', async () => {
    const { network, caches } = setup();
    const full = {
      ...caches,
      open: () =>
        Promise.resolve({
          match: () => Promise.resolve(undefined),
          put: () => Promise.reject(new Error('QuotaExceededError')),
          keys: () => Promise.resolve([]),
          delete: () => Promise.resolve(false),
        }),
    };
    const background: Promise<unknown>[] = [];
    const cache = createEngineCache({
      caches: full,
      fetch: network.fetch,
      scope: SCOPE,
      entries: ENTRIES,
    });

    const response = await cache.handle(new Request(url('ocr/worker.min.js')), (work) =>
      background.push(work),
    );

    expect(response.status).toBe(200);
    await expect(Promise.all(background)).resolves.toBeDefined();
  });
});

describe('status', () => {
  it('counts what is stored per engine, with sizes', async () => {
    const { cache, handle, settle } = setup();
    expect(await cache.status()).toEqual([
      { id: 'pdf', files: 1, cached: 0, bytes: 100, cachedBytes: 0 },
      { id: 'ocr', files: 3, cached: 0, bytes: 610, cachedBytes: 0 },
    ]);

    await handle('ocr/worker.min.js');
    await handle('ocr/lang/ron.traineddata.gz');
    await settle();

    expect(await cache.status()).toEqual([
      { id: 'pdf', files: 1, cached: 0, bytes: 100, cachedBytes: 0 },
      { id: 'ocr', files: 3, cached: 2, bytes: 610, cachedBytes: 210 },
    ]);
  });

  it('does not create empty caches just by looking', async () => {
    const { cache, caches } = setup();
    await cache.status();
    expect(await caches.keys()).toEqual([]);
  });
});

describe('prepare', () => {
  it('downloads every missing file, all variants, and reports progress', async () => {
    const { cache, network } = setup();
    const progress: Array<[number, number]> = [];

    const status = await cache.prepare((p) => progress.push([p.doneFiles, p.doneBytes]));

    expect(network.requests.map((request) => request.url)).toEqual(
      ENTRIES.map((entry) => url(entry.url)),
    );
    expect(network.requests.every((request) => request.cache === 'reload')).toBe(true);
    expect(progress).toEqual([
      [1, 100],
      [2, 110],
      [3, 510],
      [4, 710],
    ]);
    expect(status.map((engine) => [engine.id, engine.cached, engine.files])).toEqual([
      ['pdf', 1, 1],
      ['ocr', 3, 3],
    ]);
  });

  it('skips what is already stored', async () => {
    const { cache, handle, settle, network } = setup();
    await handle('ocr/worker.min.js');
    await settle();
    network.requests.length = 0;

    await cache.prepare();

    expect(network.requests.map((request) => request.url)).not.toContain(url('ocr/worker.min.js'));
    expect(network.requests).toHaveLength(3);
  });

  it('stops with the reason when a file fails, and keeps what it had stored', async () => {
    const { cache, network } = setup();
    network.failing.set(url('ocr/core/tesseract-core-lstm.wasm.js'), 503);

    await expect(cache.prepare()).rejects.toThrow('ocr/core/tesseract-core-lstm.wasm.js: HTTP 503');
    const [pdf, ocr] = await cache.status();
    expect([pdf?.cached, ocr?.cached]).toEqual([1, 1]);

    // The next try continues where the last one stopped.
    network.failing.clear();
    network.requests.length = 0;
    await cache.prepare();
    expect(network.requests).toHaveLength(2);
  });

  it('shares one download between two callers', async () => {
    const { cache, network } = setup();
    const first: number[] = [];
    const second: number[] = [];

    await Promise.all([
      cache.prepare((p) => first.push(p.doneFiles)),
      cache.prepare((p) => second.push(p.doneFiles)),
    ]);

    expect(network.requests).toHaveLength(ENTRIES.length);
    expect(first).toEqual([1, 2, 3, 4]);
    expect(second).toEqual([1, 2, 3, 4]);
  });
});

describe('deleteStale', () => {
  it('drops the caches of engine versions the manifest no longer lists, nothing else', async () => {
    const { cache, caches } = setup();
    await cache.prepare();
    const oldOcr = `${ENGINE_CACHE_PREFIX}ocr-00000000`;
    await (await caches.open(oldOcr)).put(url('ocr/worker.min.js'), new Response('old'));
    await caches.open('workbox-precache-v2-https://example.test/pretometru/');
    await caches.open('pretometru-share-v1');

    await cache.deleteStale();

    expect((await caches.keys()).sort()).toEqual(
      [
        engineCacheName('ocr', ENTRIES),
        engineCacheName('pdf', ENTRIES),
        'pretometru-share-v1',
        'workbox-precache-v2-https://example.test/pretometru/',
      ].sort(),
    );
  });

  it('keeps an engine that did not change when another one did (an app update does not repeat a 16 MB download)', async () => {
    const before = setup();
    await before.cache.prepare();

    const updated: EngineEntry[] = ENTRIES.map((entry) =>
      entry.engine === 'pdf' ? { ...entry, url: 'assets/pdf.worker.min-BBB.mjs' } : entry,
    );
    const after = createEngineCache({
      caches: before.caches,
      fetch: before.network.fetch,
      scope: SCOPE,
      entries: updated,
    });
    await after.deleteStale();

    const names = await before.caches.keys();
    expect(names).toContain(engineCacheName('ocr', ENTRIES));
    expect(names).not.toContain(engineCacheName('pdf', ENTRIES));
    expect((await after.status()).map((engine) => engine.cached)).toEqual([0, 3]);
  });
});
