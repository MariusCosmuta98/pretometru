import { liveQuery } from 'dexie';
import { useEffect, useState } from 'react';
import { getDb, type PretometruDB } from '@/storage';

export type Live<T> =
  { status: 'loading' } | { status: 'ready'; value: T } | { status: 'error'; error: unknown };

const LOADING = { status: 'loading' } as const;

/** The app database once it is open; an unavailable IndexedDB (private mode, blocked) is an `error`. */
export function useDb(): Live<PretometruDB> {
  const [state, setState] = useState<Live<PretometruDB>>(LOADING);
  useEffect(() => {
    let cancelled = false;
    getDb().then(
      (db) => {
        if (!cancelled) setState({ status: 'ready', value: db });
      },
      (error: unknown) => {
        if (!cancelled) setState({ status: 'error', error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * Runs `query` and runs it again whenever the data it read changes (Dexie live query), so a screen
 * follows imports, merges and setting changes. `query` must keep its identity between renders
 * (a module-level function, or `useCallback`); a new function starts a new query.
 */
export function useLiveQuery<T>(
  db: PretometruDB | undefined,
  query: (db: PretometruDB) => Promise<T>,
): Live<T> {
  const [result, setResult] = useState<{
    db: PretometruDB;
    query: typeof query;
    live: Live<T>;
  }>();

  useEffect(() => {
    if (!db) return undefined;
    // An `async` querier on purpose: Dexie keeps tracking the tables a query reads across native
    // `await`s only for async functions, otherwise the query would never re-run.
    const subscription = liveQuery(async () => await query(db)).subscribe({
      next: (value) => setResult({ db, query, live: { status: 'ready', value } }),
      error: (error: unknown) => setResult({ db, query, live: { status: 'error', error } }),
    });
    return () => subscription.unsubscribe();
  }, [db, query]);

  return result !== undefined && result.db === db && result.query === query ? result.live : LOADING;
}

/** Opens the database and keeps `query` live: the one hook a screen needs. */
export function useDbQuery<T>(query: (db: PretometruDB) => Promise<T>): Live<T> {
  const database = useDb();
  const live = useLiveQuery(database.status === 'ready' ? database.value : undefined, query);
  return database.status === 'error' ? database : live;
}
