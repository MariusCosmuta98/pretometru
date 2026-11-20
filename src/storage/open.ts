import type { DexieOptions } from 'dexie';
import { PretometruDB } from './db';
import type { Migration } from './migrations';
import { ensureSeed } from './seed';

export interface OpenDbOptions {
  name?: string;
  migrations?: readonly Migration[];
  /** Dexie options, e.g. a different IndexedDB implementation for tests. */
  dexie?: DexieOptions;
}

/** Opens the database (running pending migrations) and makes sure the seed data exists. */
export async function openDb({
  name,
  migrations,
  dexie,
}: OpenDbOptions = {}): Promise<PretometruDB> {
  const db = new PretometruDB(name, migrations, dexie);
  await db.open();
  await ensureSeed(db);
  return db;
}

/** Wraps an async opener so it runs once and shares its result; a failed attempt is not cached. */
export function memoizeUntilFailure<T>(open: () => Promise<T>): () => Promise<T> {
  let shared: Promise<T> | undefined;
  return () => {
    shared ??= open().catch((error: unknown) => {
      shared = undefined;
      throw error;
    });
    return shared;
  };
}

/** The app's database: opened and seeded once, then shared. A failed open is retried on the next call. */
export const getDb = memoizeUntilFailure(() => openDb());
