import { describe, expect, it, vi } from 'vitest';
import {
  hasAskedForPersistence,
  readPersistence,
  requestPersistence,
  requestPersistenceOnce,
  type StorageEnv,
} from './persistence';

function fakeEnv({
  persisted = false,
  grant = true,
  persistFails = false,
}: { persisted?: boolean; grant?: boolean; persistFails?: boolean } = {}) {
  const data = new Map<string, string>();
  const storage = {
    persisted: vi.fn(() => Promise.resolve(persisted)),
    persist: vi.fn(() =>
      persistFails ? Promise.reject(new Error('blocked')) : Promise.resolve(grant),
    ),
    estimate: vi.fn(() => Promise.resolve({ usage: 2_000_000, quota: 80_000_000 })),
  };
  const env: StorageEnv = {
    storage,
    memory: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => {
        data.set(key, value);
      },
    },
    installed: () => false,
    now: () => new Date('2026-11-20T10:00:00.000Z'),
  };
  return { env, storage, data };
}

describe('readPersistence', () => {
  it('reports what the browser says: persistence, usage and quota, installed or not', async () => {
    const { env } = fakeEnv({ persisted: true });
    expect(await readPersistence({ ...env, installed: () => true })).toEqual({
      supported: true,
      persisted: true,
      usageBytes: 2_000_000,
      quotaBytes: 80_000_000,
      installed: true,
    });
  });

  it('says so when the browser has no storage manager, or cannot answer', async () => {
    const { env } = fakeEnv();
    expect(await readPersistence({ ...env, storage: undefined })).toEqual({
      supported: false,
      persisted: undefined,
      usageBytes: undefined,
      quotaBytes: undefined,
      installed: false,
    });

    const failing = {
      ...env.storage,
      persisted: () => Promise.reject(new Error('denied')),
      estimate: () => Promise.reject(new Error('denied')),
      persist: () => Promise.resolve(false),
    };
    expect(await readPersistence({ ...env, storage: failing })).toMatchObject({
      supported: true,
      persisted: undefined,
      usageBytes: undefined,
    });
  });
});

describe('requestPersistenceOnce (the automatic ask)', () => {
  it('asks the browser once and remembers that it did, whatever the answer', async () => {
    const { env, storage, data } = fakeEnv({ grant: false });

    expect(hasAskedForPersistence(env)).toBe(false);
    expect(await requestPersistenceOnce(env)).toBe(false);
    expect(hasAskedForPersistence(env)).toBe(true);
    expect(JSON.parse(data.get('pretometru.storage-persist') ?? '{}')).toEqual({
      askedAt: '2026-11-20T10:00:00.000Z',
      granted: false,
    });

    expect(await requestPersistenceOnce(env)).toBeUndefined();
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask when the browser already keeps the data (an installed app)', async () => {
    const { env, storage } = fakeEnv({ persisted: true });

    expect(await requestPersistenceOnce(env)).toBe(true);

    expect(storage.persist).not.toHaveBeenCalled();
    expect(hasAskedForPersistence(env)).toBe(true);
  });

  it('does nothing in a browser without persistent storage', async () => {
    const { env } = fakeEnv();
    expect(await requestPersistenceOnce({ ...env, storage: undefined })).toBeUndefined();
  });
});

describe('requestPersistence (the retry in Settings)', () => {
  it('asks every time, so a refusal is not final', async () => {
    const { env, storage } = fakeEnv({ grant: false });
    await requestPersistenceOnce(env);

    expect(await requestPersistence(env)).toBe(false);
    expect(await requestPersistence(env)).toBe(false);
    expect(storage.persist).toHaveBeenCalledTimes(3);
  });

  it('treats a browser that throws as a refusal, and an unsupported one as no answer', async () => {
    expect(await requestPersistence(fakeEnv({ persistFails: true }).env)).toBe(false);
    expect(await requestPersistence({ ...fakeEnv().env, storage: undefined })).toBeUndefined();
  });

  it('copes with a localStorage that refuses to answer', async () => {
    const { env } = fakeEnv();
    const blocked: StorageEnv = {
      ...env,
      memory: {
        getItem: () => {
          throw new Error('SecurityError');
        },
        setItem: () => {
          throw new Error('SecurityError');
        },
      },
    };

    expect(hasAskedForPersistence(blocked)).toBe(false);
    expect(await requestPersistence(blocked)).toBe(true);
  });
});
