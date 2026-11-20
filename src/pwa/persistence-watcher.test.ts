import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeReceipt } from '@/domain/testing';
import { createRecord, PretometruDB, softDelete } from '@/storage';
import { startPersistenceWatcher } from './persistence-watcher';
import type { StorageEnv } from './persistence';

// Dexie's liveQuery only emits on the global (auto-installed) fake IndexedDB, not on the explicit
// one that `createTestDb()` passes in, so the watcher is tested on a database like the app's.
let databases = 0;
async function createTestDb() {
  databases += 1;
  const db = new PretometruDB(`persistence-watcher-${databases}`);
  await db.open();
  return db;
}

function fakeEnv(initiallyAsked = false) {
  const data = new Map<string, string>(
    initiallyAsked ? [['pretometru.storage-persist', '{}']] : [],
  );
  const persist = vi.fn(() => Promise.resolve(true));
  const env: StorageEnv = {
    storage: {
      persisted: () => Promise.resolve(false),
      persist,
      estimate: () => Promise.resolve({}),
    },
    memory: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    installed: () => false,
    now: () => new Date('2026-11-20T10:00:00.000Z'),
  };
  return { env, persist };
}

async function addReceipt(db: PretometruDB, status: 'draft' | 'confirmed') {
  const { id: _id, updatedAt: _updatedAt, ...receipt } = makeReceipt({ status });
  return createRecord(db.receipts, receipt);
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, 60));

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

describe('startPersistenceWatcher', () => {
  it('asks for persistent storage once, when the first receipt is confirmed, and not before', async () => {
    const db = await createTestDb();
    const { env, persist } = fakeEnv();
    stop = startPersistenceWatcher({ env, openDb: () => Promise.resolve(db) });

    await quiet();
    expect(persist).not.toHaveBeenCalled();

    // A draft is not yet something the user keeps.
    await addReceipt(db, 'draft');
    await quiet();
    expect(persist).not.toHaveBeenCalled();

    await addReceipt(db, 'confirmed');
    await vi.waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });

    await addReceipt(db, 'confirmed');
    await quiet();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('asks as soon as it starts when a confirmed receipt already exists (an update of an app in use)', async () => {
    const db = await createTestDb();
    await addReceipt(db, 'confirmed');
    const { env, persist } = fakeEnv();

    stop = startPersistenceWatcher({ env, openDb: () => Promise.resolve(db) });

    await vi.waitFor(() => {
      expect(persist).toHaveBeenCalledTimes(1);
    });
  });

  it('does not count a deleted receipt', async () => {
    const db = await createTestDb();
    const receipt = await addReceipt(db, 'confirmed');
    await softDelete(db.receipts, receipt.id);
    const { env, persist } = fakeEnv();

    stop = startPersistenceWatcher({ env, openDb: () => Promise.resolve(db) });
    await quiet();

    expect(persist).not.toHaveBeenCalled();
  });

  it('never opens the database once the browser has been asked, or cannot be asked', async () => {
    const openDb = vi.fn(() => Promise.reject(new Error('must not open')));

    startPersistenceWatcher({ env: fakeEnv(true).env, openDb })();
    startPersistenceWatcher({ env: { ...fakeEnv().env, storage: undefined }, openDb })();

    await quiet();
    expect(openDb).not.toHaveBeenCalled();
  });

  it('stops watching when told to, even before the database has opened', async () => {
    const db = await createTestDb();
    const { env, persist } = fakeEnv();
    let open: (db: PretometruDB) => void = () => undefined;
    const opened = new Promise<PretometruDB>((resolve) => {
      open = resolve;
    });

    const stopWatching = startPersistenceWatcher({ env, openDb: () => opened });
    stopWatching();
    open(db);
    await addReceipt(db, 'confirmed');
    await quiet();

    expect(persist).not.toHaveBeenCalled();
  });

  it('survives a database that cannot be opened (private browsing, blocked storage)', async () => {
    const { env, persist } = fakeEnv();

    stop = startPersistenceWatcher({ env, openDb: () => Promise.reject(new Error('blocked')) });
    await quiet();

    expect(persist).not.toHaveBeenCalled();
  });
});
