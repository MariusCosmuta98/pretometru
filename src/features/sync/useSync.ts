import { liveQuery } from 'dexie';
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getSyncRuntime,
  getSyncServices,
  loadSyncView,
  subscribeSyncRuntime,
  type SyncRuntime,
  type SyncView,
} from '@/sync';

export type Live<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

/**
 * The connection, its last result and whether anything waits to be synced, kept live: the section
 * follows a sync that an automatic run starts and a token that another tab replaces.
 */
export function useSyncView(): Live<SyncView> {
  const [state, setState] = useState<Live<SyncView>>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    getSyncServices()
      .getDb()
      .then(
        (db) => {
          if (cancelled) return;
          // An `async` querier: Dexie only keeps tracking the tables it reads across `await`s then.
          const subscription = liveQuery(async () => await loadSyncView(db)).subscribe({
            next: (value) => setState({ status: 'ready', value }),
            error: (error: unknown) => setState({ status: 'error', error }),
          });
          unsubscribe = () => subscription.unsubscribe();
        },
        (error: unknown) => {
          if (!cancelled) setState({ status: 'error', error });
        },
      );

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return state;
}

/** Whether a sync is running right now, in which phase, and whether the token is unlocked. */
export function useSyncRuntime(): SyncRuntime {
  return useSyncExternalStore(subscribeSyncRuntime, getSyncRuntime);
}
