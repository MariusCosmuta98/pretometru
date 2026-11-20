/*
 * The service worker (vite-plugin-pwa `injectManifest`). It is bundled on its own, so it only imports
 * modules that run in a worker; the rules and the logic live in the files next to it, where Vitest
 * can reach them.
 *
 * - The app shell and every lazy route chunk are precached at install, so the whole app starts and
 *   renders offline.
 * - The engines (pdf.js worker, OCR) are cached the first time they are requested, or all at once from
 *   Settings (`engine-cache.ts`): they are too heavy for the install step.
 * - The Web Share Target POST is answered here (`share-target.ts`).
 * - An update waits for the user's go-ahead (`SKIP_WAITING`, sent by `UpdatePrompt`), so it never
 *   interrupts data entry.
 */
import { clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { createEngineCache } from './engine-cache';
import {
  isSkipWaiting,
  isWorkerRequest,
  MESSAGE_ENGINES_PREPARE,
  type WorkerReply,
} from './messages';
import { engineOf, relativeToScope, splitManifest, type ManifestEntry } from './offline-rules';
import { handleShareTarget, purgeStaleShares, SHARE_TARGET_PATH } from './share-target';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: ManifestEntry[] };

const scope = self.registration.scope;
const { precache, engines } = splitManifest(self.__WB_MANIFEST);
const engineCache = createEngineCache({
  caches: self.caches,
  fetch: (url, init) => self.fetch(url, init),
  scope,
  entries: engines,
});
const shareDeps = { caches: self.caches, scope, now: () => Date.now() };

precacheAndRoute(precache);
cleanupOutdatedCaches();
// Hash router: every navigation below the scope is the one `index.html`.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

registerRoute(
  ({ url }) => {
    const path = relativeToScope(url, scope);
    return path !== undefined && engineOf(path) !== undefined;
  },
  ({ request, event }) => engineCache.handle(request, (work) => event.waitUntil(work)),
);

registerRoute(
  ({ url }) => relativeToScope(url, scope) === SHARE_TARGET_PATH,
  ({ request }) => handleShareTarget(request, shareDeps),
  'POST',
);

self.addEventListener('message', (event) => {
  if (isSkipWaiting(event.data)) {
    void self.skipWaiting();
    return;
  }
  const port = event.ports[0];
  if (!port || !isWorkerRequest(event.data)) return;

  const reply = (message: WorkerReply) => port.postMessage(message);
  const work =
    event.data.type === MESSAGE_ENGINES_PREPARE
      ? engineCache.prepare((progress) => reply({ type: 'progress', progress }))
      : engineCache.status();
  // `waitUntil` keeps the worker running for the whole download.
  event.waitUntil(
    work.then(
      (status) => reply({ type: 'status', engines: status }),
      (error: unknown) =>
        reply({ type: 'error', message: error instanceof Error ? error.message : String(error) }),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([engineCache.deleteStale(), purgeStaleShares(shareDeps)]).catch(() => undefined),
  );
});

// Without this, a first-time visitor's own tab would only be controlled after a reload, and the
// engines it uses in that first session would not be stored. An update never reaches this tab
// before the user accepts it, because the new worker waits for `SKIP_WAITING`.
clientsClaim();
