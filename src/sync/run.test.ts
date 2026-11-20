import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRecord, ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { lockToken, saveConnection, unlockToken } from './connection';
import { resetRunSync, runSync } from './run';
import { getSyncRuntime, resetSyncRuntime, type SyncRuntime } from './runtime';
import { resetSyncServices, setSyncServices } from './services';
import { loadSyncView, readStatus } from './status';
import { at, makeWorld, OWNER, REPO, seedSample, TOKEN, type MockGitHub } from './testing';

const clock = () => new Date('2026-11-20T12:00:00.000Z');
const connecting = { now: clock, newDeviceId: () => 'DEV001', passphraseIterations: 1000 };

let github: MockGitHub;
let db: PretometruDB;

beforeEach(async () => {
  github = await makeWorld();
  db = await createTestDb();
  await ensureSeed(db);
  setSyncServices({
    getDb: () => Promise.resolve(db),
    fetch: github.fetch,
    sleep: () => Promise.resolve(),
    ...connecting,
  });
});
afterEach(() => {
  resetSyncServices();
  lockToken();
  resetSyncRuntime();
  resetRunSync();
  expect(github.violations).toEqual([]);
});

const connect = (passphrase?: string) =>
  saveConnection(db, { owner: OWNER, repo: REPO, token: TOKEN, passphrase }, connecting);

describe('runSync', () => {
  it('asks for a connection first, and does not call that a failed sync', async () => {
    await expect(runSync()).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(await readStatus(db)).toBeUndefined();
    expect(github.requests).toEqual([]);
  });

  it('syncs the connected repository and records the outcome', async () => {
    await connect();
    await seedSample(db);

    const result = await runSync();

    expect(result).toMatchObject({ firstSync: true, attempts: 1 });
    expect(await readStatus(db)).toEqual({
      at: '2026-11-20T12:00:00.000Z',
      ok: true,
      success: {
        at: '2026-11-20T12:00:00.000Z',
        pulled: 0,
        pushed: result.pushed,
        firstSync: true,
        commit: result.commit,
      },
      syncedThrough: '2026-11-05T10:00:00.000Z',
    });
    expect(github.history('ana/pretometru-data')[0]?.message).toContain('dispozitiv DEV001');
  });

  it('knows what changed on this device since the last sync', async () => {
    await connect();
    await seedSample(db);
    expect((await loadSyncView(db)).unsynced).toBe(true);

    await runSync();
    expect(await loadSyncView(db)).toMatchObject({ unsynced: false, protection: 'none' });

    await createRecord(
      db.stores,
      { chain: 'metro', name: 'METRO' },
      at('2026-11-20T12:30:00.000Z'),
    );
    expect((await loadSyncView(db)).unsynced).toBe(true);

    await runSync();
    expect((await loadSyncView(db)).unsynced).toBe(false);
  });

  it('keeps the last success on record when a later attempt fails, and says why it failed', async () => {
    await connect();
    await seedSample(db);
    await runSync();
    const before = await readStatus(db);

    github.setOffline(true);
    await expect(runSync()).rejects.toMatchObject({ code: 'NETWORK' });

    const after = await readStatus(db);
    expect(after).toMatchObject({ ok: false, error: { code: 'NETWORK' } });
    expect(after?.success).toEqual(before?.success);
    expect(after?.syncedThrough).toBe(before?.syncedThrough);
  });

  it('records when GitHub allows requests again after a rate limit', async () => {
    await connect();
    github.failNext(/./, {
      status: 403,
      headers: { 'retry-after': '120' },
      body: { message: 'You have exceeded a secondary rate limit.' },
    });

    await expect(runSync()).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    expect((await readStatus(db))?.error).toEqual({
      code: 'RATE_LIMITED',
      retryAt: '2026-11-20T12:02:00.000Z',
    });
  });

  it('joins a sync that is already running instead of starting a second one', async () => {
    await connect();
    await seedSample(db);

    const [first, second] = await Promise.all([runSync(), runSync()]);

    expect(second).toBe(first);
    expect(github.writes.filter((request) => request.method === 'PATCH')).toHaveLength(1);
  });

  it('tells the screen that it is running, and in which phase', async () => {
    await connect();
    await seedSample(db);
    const seen: SyncRuntime[] = [];
    github.before(/^POST .*\/git\/blobs$/, () => {
      seen.push(getSyncRuntime());
    });

    await runSync();

    expect(seen[0]).toMatchObject({ running: true, phase: 'uploading' });
    expect(getSyncRuntime()).toMatchObject({ running: false, phase: undefined });
  });

  it('needs the passphrase of a protected token again after a restart, which is not a failed sync', async () => {
    await connect('parola mea');
    lockToken();

    await expect(runSync()).rejects.toMatchObject({ code: 'TOKEN_LOCKED' });
    expect(await readStatus(db)).toBeUndefined();
    expect(github.requests).toEqual([]);

    await unlockToken(db, 'parola mea');
    await expect(runSync()).resolves.toMatchObject({ firstSync: true });
  });

  it('reports a database that cannot be opened', async () => {
    setSyncServices({ getDb: () => Promise.reject(new Error('blocked')) });
    await expect(runSync()).rejects.toMatchObject({ code: 'STORAGE' });
  });
});
