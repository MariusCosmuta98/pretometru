import type { CacheStorageLike } from './cache-store';

/*
 * Web Share Target (Android Chrome, installed PWA). The manifest sends a POST with the shared files to
 * `<base>share-target`; the service worker answers it (no server is involved) by keeping the files in a
 * small cache and redirecting to the add-receipt screen with the id of the batch. The screen reads the
 * files, imports them and discards the batch. The router is a hash router, so the redirect target is
 * `<base>#/adauga?shared=<id>`. Everything here is pure (the cache and the clock are injected) and free
 * of `@/` imports: `vite.config.ts` reads the constants for the manifest.
 */

/** Relative to the scope; also the manifest's `share_target.action`. */
export const SHARE_TARGET_PATH = 'share-target';
/** The multipart field the manifest names in `share_target.params.files`. */
export const SHARE_FIELD = 'files';
/** What a receipt can be shared as; PDFs and images (photos and screenshots). */
export const SHARE_ACCEPT = ['application/pdf', 'image/*'] as const;
/** The add-receipt route of the hash router. */
export const ADD_RECEIPT_ROUTE = '/adauga';
/** Query parameter (inside the hash route) that carries the batch id. */
export const SHARE_PARAM = 'shared';

export const SHARE_CACHE = 'pretometru-share-v1';
/** A batch nobody picked up (the app was closed in between) is dropped after this long. */
export const SHARE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILES = 10;
const NAME_HEADER = 'x-file-name';
const SHARE_ID = /^[0-9a-z]+-[0-9a-z]+$/;

export interface ShareDeps {
  caches: CacheStorageLike;
  /** The service worker's scope, for example `https://host/pretometru/`. */
  scope: string;
  now: () => number;
  newId?: () => string;
}

const batchPrefix = (scope: string, id: string) => new URL(`shared/${id}/`, scope).href;

function defaultId(now: number): string {
  return `${now.toString(36)}-${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
}

/** Removes batches that were never picked up (called when a share arrives and when a worker activates). */
export async function purgeStaleShares({ caches, scope, now }: ShareDeps): Promise<void> {
  if (!(await caches.has(SHARE_CACHE))) return;
  const cache = await caches.open(SHARE_CACHE);
  const root = new URL('shared/', scope).href;
  for (const { url } of await cache.keys()) {
    const id = url.startsWith(root) ? url.slice(root.length).split('/')[0] : undefined;
    const createdAt = id === undefined ? undefined : Number.parseInt(id.split('-')[0] ?? '', 36);
    if (
      createdAt === undefined ||
      Number.isNaN(createdAt) ||
      now() - createdAt > SHARE_MAX_AGE_MS
    ) {
      await cache.delete(url);
    }
  }
}

/**
 * Keeps the files for the add-receipt screen and returns the id of their batch. The bytes are copied
 * (not the Blob) so that the stored files do not depend on where the `File` objects came from.
 */
export async function stashSharedFiles(files: readonly File[], deps: ShareDeps): Promise<string> {
  await purgeStaleShares(deps).catch(() => undefined);
  const id = (deps.newId ?? (() => defaultId(deps.now())))();
  const cache = await deps.caches.open(SHARE_CACHE);
  await Promise.all(
    files.map(async (file, index) =>
      cache.put(
        `${batchPrefix(deps.scope, id)}${index}`,
        new Response(await file.arrayBuffer(), {
          headers: {
            'content-type': file.type || 'application/octet-stream',
            [NAME_HEADER]: encodeURIComponent(file.name),
          },
        }),
      ),
    ),
  );
  return id;
}

/**
 * Answers the share-target POST. Never fails: whatever goes wrong, the user lands on the add-receipt
 * screen and can pick the file there.
 */
export async function handleShareTarget(request: Request, deps: ShareDeps): Promise<Response> {
  const redirect = (query = '') =>
    Response.redirect(new URL(`#${ADD_RECEIPT_ROUTE}${query}`, deps.scope).href, 303);

  try {
    const form = await request.formData();
    const files = form
      .getAll(SHARE_FIELD)
      .filter((entry): entry is File => typeof entry !== 'string')
      .slice(0, MAX_FILES);
    if (files.length === 0) return redirect();
    return redirect(`?${SHARE_PARAM}=${await stashSharedFiles(files, deps)}`);
  } catch {
    return redirect();
  }
}

/** The files of a batch in the order they were shared; empty for an unknown, expired or malformed id. */
export async function readSharedFiles(
  id: string,
  caches: CacheStorageLike,
  scope: string,
): Promise<File[]> {
  if (!SHARE_ID.test(id) || !(await caches.has(SHARE_CACHE))) return [];
  const cache = await caches.open(SHARE_CACHE);
  const prefix = batchPrefix(scope, id);
  const indexOf = (url: string) => Number(url.slice(prefix.length));
  const urls = (await cache.keys())
    .map((key) => key.url)
    .filter((url) => url.startsWith(prefix))
    .sort((a, b) => indexOf(a) - indexOf(b));

  const files: File[] = [];
  for (const url of urls) {
    const response = await cache.match(url);
    if (!response) continue;
    files.push(
      new File(
        [await response.arrayBuffer()],
        decodeURIComponent(response.headers.get(NAME_HEADER) ?? ''),
        {
          type: response.headers.get('content-type') ?? '',
        },
      ),
    );
  }
  return files;
}

export async function discardSharedFiles(
  id: string,
  caches: CacheStorageLike,
  scope: string,
): Promise<void> {
  if (!SHARE_ID.test(id) || !(await caches.has(SHARE_CACHE))) return;
  const cache = await caches.open(SHARE_CACHE);
  const prefix = batchPrefix(scope, id);
  for (const { url } of await cache.keys()) {
    if (url.startsWith(prefix)) await cache.delete(url);
  }
}
