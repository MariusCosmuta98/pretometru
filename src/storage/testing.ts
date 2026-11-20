/**
 * Test-only helpers: an in-memory IndexedDB (fake-indexeddb) and throwaway databases.
 * Never import this from application code.
 *
 * fake-indexeddb is passed to Dexie explicitly instead of patching globals, so import order
 * between test files, Dexie and this module never matters.
 */
import { IDBKeyRange, indexedDB } from 'fake-indexeddb';
import { PretometruDB } from './db';
import type { Migration } from './migrations';

let counter = 0;

export function uniqueTestDbName(): string {
  counter += 1;
  return `pretometru-test-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A database on the in-memory IndexedDB; not opened yet (reuse `name` to reopen the same data). */
export function testDb(
  name: string = uniqueTestDbName(),
  migrations?: readonly Migration[],
): PretometruDB {
  return new PretometruDB(name, migrations, { indexedDB, IDBKeyRange });
}

export async function createTestDb(
  options: { migrations?: readonly Migration[] } = {},
): Promise<PretometruDB> {
  const db = testDb(undefined, options.migrations);
  await db.open();
  return db;
}
