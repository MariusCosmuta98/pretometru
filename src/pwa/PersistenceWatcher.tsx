import { useEffect } from 'react';
import { browserStorageEnv, hasAskedForPersistence } from './persistence';

// Long enough for the first screen to settle; the database code is not needed before that.
const START_DELAY_MS = 3_000;

/**
 * Mounted once next to the router: asks for persistent storage after the first confirmed receipt.
 * The watcher (Dexie, the storage layer) loads after a delay, and not at all once the browser has
 * been asked, so the entry chunk stays free of it.
 */
export function PersistenceWatcher() {
  useEffect(() => {
    const env = browserStorageEnv();
    if (typeof env.storage?.persist !== 'function' || hasAskedForPersistence(env)) return undefined;

    let stop: (() => void) | undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      void import('./persistence-watcher').then((watcher) => {
        if (!cancelled) stop = watcher.startPersistenceWatcher({ env });
      });
    }, START_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, []);
  return null;
}
