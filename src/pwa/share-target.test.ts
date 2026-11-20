import { describe, expect, it } from 'vitest';
import {
  discardSharedFiles,
  handleShareTarget,
  purgeStaleShares,
  readSharedFiles,
  SHARE_CACHE,
  SHARE_MAX_AGE_MS,
  SHARE_PARAM,
  type ShareDeps,
} from './share-target';
import { fakeCacheStorage } from './testing';

const SCOPE = 'https://example.test/pretometru/';
const ACTION = `${SCOPE}share-target`;

function setup(now = 1_700_000_000_000) {
  const deps: ShareDeps = {
    caches: fakeCacheStorage(),
    scope: SCOPE,
    now: () => now,
    newId: () => 'abc123-0a1b2c3d4e',
  };
  return deps;
}

/** What Android's share sheet sends to the manifest's action: a multipart POST. */
function shareRequest(files: File[]): Request {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return new Request(ACTION, { method: 'POST', body: form });
}

const pdf = (name = 'bon.pdf') => new File(['%PDF-1.7 fake'], name, { type: 'application/pdf' });
const photo = (name = 'poza.jpg') => new File(['jpeg bytes'], name, { type: 'image/jpeg' });

describe('handleShareTarget', () => {
  it('keeps the shared files and sends the user to the add-receipt screen with the batch id', async () => {
    const deps = setup();

    const response = await handleShareTarget(shareRequest([pdf(), photo()]), deps);

    expect(response.status).toBe(303);
    // The router is a hash router: the route and its query live after the #.
    expect(response.headers.get('location')).toBe(
      `${SCOPE}#/adauga?${SHARE_PARAM}=abc123-0a1b2c3d4e`,
    );

    const files = await readSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE);
    expect(files.map((file) => [file.name, file.type])).toEqual([
      ['bon.pdf', 'application/pdf'],
      ['poza.jpg', 'image/jpeg'],
    ]);
    expect(await files[0]?.text()).toBe('%PDF-1.7 fake');
  });

  it('keeps names with spaces and Romanian letters, and files without a type', async () => {
    const deps = setup();
    await handleShareTarget(
      shareRequest([new File(['x'], 'Bon Mega Image ședință.pdf'), new File(['y'], 'bon')]),
      deps,
    );

    const files = await readSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE);
    expect(files.map((file) => file.name)).toEqual(['Bon Mega Image ședință.pdf', 'bon']);
    expect(files[1]?.type).toBe('application/octet-stream');
  });

  it('lands on the plain add-receipt screen when nothing usable arrived', async () => {
    const deps = setup();
    const textOnly = new FormData();
    textOnly.append('text', 'a shared link');

    for (const request of [
      shareRequest([]),
      new Request(ACTION, { method: 'POST', body: textOnly }),
      new Request(ACTION, {
        method: 'POST',
        body: 'not multipart',
        headers: { 'content-type': 'multipart/form-data; boundary=x' },
      }),
    ]) {
      const response = await handleShareTarget(request, deps);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${SCOPE}#/adauga`);
    }
  });

  it('never fails: a cache that cannot store (no space) still ends on the add-receipt screen', async () => {
    const deps: ShareDeps = {
      ...setup(),
      caches: {
        ...fakeCacheStorage(),
        has: () => Promise.resolve(false),
        open: () => Promise.reject(new Error('QuotaExceededError')),
      },
    };

    const response = await handleShareTarget(shareRequest([pdf()]), deps);

    expect(response.headers.get('location')).toBe(`${SCOPE}#/adauga`);
  });

  it('takes at most ten files', async () => {
    const deps = setup();
    const many = Array.from({ length: 12 }, (_, index) => pdf(`bon-${index}.pdf`));

    await handleShareTarget(shareRequest(many), deps);

    const files = await readSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE);
    expect(files.map((file) => file.name)).toEqual(many.slice(0, 10).map((file) => file.name));
  });

  it('puts the files back in the order they were shared, also past nine', async () => {
    const deps = setup();
    const names = Array.from({ length: 10 }, (_, index) => `bon-${index}.pdf`);

    await handleShareTarget(shareRequest(names.map((name) => pdf(name))), deps);

    const files = await readSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE);
    expect(files.map((file) => file.name)).toEqual(names);
  });
});

describe('readSharedFiles and discardSharedFiles', () => {
  it('hands over nothing for an unknown, malformed or already discarded id', async () => {
    const deps = setup();
    await handleShareTarget(shareRequest([pdf()]), deps);

    expect(await readSharedFiles('zzz-unknown', deps.caches, SCOPE)).toEqual([]);
    expect(await readSharedFiles('../../escape', deps.caches, SCOPE)).toEqual([]);
    expect(await readSharedFiles('', deps.caches, SCOPE)).toEqual([]);

    await discardSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE);
    expect(await readSharedFiles('abc123-0a1b2c3d4e', deps.caches, SCOPE)).toEqual([]);
    const cache = await deps.caches.open(SHARE_CACHE);
    expect(await cache.keys()).toEqual([]);
  });

  it('reads nothing, and creates nothing, when no share ever happened', async () => {
    const caches = fakeCacheStorage();
    expect(await readSharedFiles('abc123-0a1b2c3d4e', caches, SCOPE)).toEqual([]);
    expect(await caches.keys()).toEqual([]);
  });

  it('discards only the batch it is asked for', async () => {
    const caches = fakeCacheStorage();
    const first = { ...setup(), caches, newId: () => 'a1-aaaa' };
    const second = { ...first, newId: () => 'a2-bbbb' };
    await handleShareTarget(shareRequest([pdf('one.pdf')]), first);
    await handleShareTarget(shareRequest([pdf('two.pdf')]), second);

    await discardSharedFiles('a1-aaaa', caches, SCOPE);

    expect(await readSharedFiles('a1-aaaa', caches, SCOPE)).toEqual([]);
    expect((await readSharedFiles('a2-bbbb', caches, SCOPE)).map((file) => file.name)).toEqual([
      'two.pdf',
    ]);
  });
});

describe('purgeStaleShares', () => {
  it('drops batches that nobody picked up for a day, when a worker activates and when a share arrives', async () => {
    const caches = fakeCacheStorage();
    const start = 1_700_000_000_000;
    const old = {
      scope: SCOPE,
      caches,
      now: () => start,
      newId: () => `${start.toString(36)}-old`,
    };
    await handleShareTarget(shareRequest([pdf('old.pdf')]), old);

    const later = { ...old, now: () => start + SHARE_MAX_AGE_MS - 1 };
    await purgeStaleShares(later);
    expect(await readSharedFiles(`${start.toString(36)}-old`, caches, SCOPE)).toHaveLength(1);

    const muchLater = { ...old, now: () => start + SHARE_MAX_AGE_MS + 1 };
    await purgeStaleShares(muchLater);
    expect(await readSharedFiles(`${start.toString(36)}-old`, caches, SCOPE)).toEqual([]);

    // A new share also cleans up behind itself.
    await handleShareTarget(shareRequest([pdf('old2.pdf')]), old);
    const fresh = {
      ...muchLater,
      newId: () => `${(start + SHARE_MAX_AGE_MS + 1).toString(36)}-new`,
    };
    await handleShareTarget(shareRequest([pdf('new.pdf')]), fresh);
    expect(await readSharedFiles(`${start.toString(36)}-old`, caches, SCOPE)).toEqual([]);
    expect(await readSharedFiles(fresh.newId(), caches, SCOPE)).toHaveLength(1);
  });
});
