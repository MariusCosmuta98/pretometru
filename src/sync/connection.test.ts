import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, getKeyValue, setKeyValue, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import {
  CONNECTION_KEY,
  disconnect,
  lockToken,
  readConnection,
  readTokenProtection,
  resolveToken,
  saveConnection,
  setAutoSync,
  TOKEN_KEY,
  unlockToken,
} from './connection';
import { getSyncRuntime, resetSyncRuntime, setSyncRuntime } from './runtime';
import { OWNER, REPO, TOKEN } from './testing';

const services = {
  now: () => new Date('2026-11-20T12:00:00.000Z'),
  newDeviceId: () => 'DEV001',
  passphraseIterations: 1000,
};
const input = { owner: OWNER, repo: REPO, token: TOKEN };

let db: PretometruDB;

beforeEach(async () => {
  db = await createTestDb();
});
afterEach(() => {
  lockToken();
  resetSyncRuntime();
});

describe('the connection', () => {
  it('keeps the repository, the token and a device id in the device-local sync state', async () => {
    const connection = await saveConnection(db, input, services);

    expect(connection).toEqual({
      owner: OWNER,
      repo: REPO,
      deviceId: 'DEV001',
      auto: true,
      connectedAt: '2026-11-20T12:00:00.000Z',
    });
    expect(await readConnection(db)).toEqual(connection);
    expect(await readTokenProtection(db)).toBe('none');
    expect(await resolveToken(db)).toBe(TOKEN);
    expect((await db.syncState.get(TOKEN_KEY))?.value).toEqual({ kind: 'plain', token: TOKEN });
  });

  it('never lets the token into a backup, whether it is protected or not', async () => {
    for (const passphrase of [undefined, 'o parolă']) {
      await saveConnection(db, { ...input, passphrase }, services);
      await setKeyValue(db.settings, 'geminiApiKey', 'sentinel-api-key');

      const exported = JSON.stringify((await exportBackup(db)).backup);

      expect(exported).not.toContain(TOKEN);
      expect(exported).not.toContain('sentinel-api-key');
      expect(exported).not.toContain('sync.');
    }
  });

  it('refuses a repository name that is not one, and stores nothing', async () => {
    await expect(saveConnection(db, { ...input, repo: '..' }, services)).rejects.toMatchObject({
      code: 'INVALID_REPO',
    });
    expect(await db.syncState.count()).toBe(0);
  });

  it('keeps the device id and the automatic-sync choice when the token is replaced', async () => {
    await saveConnection(db, input, services);
    await setAutoSync(db, false, services);

    const replaced = await saveConnection(
      db,
      { ...input, token: 'another-fake-token' },
      { ...services, newDeviceId: () => 'OTHER1' },
    );

    expect(replaced).toMatchObject({ deviceId: 'DEV001', auto: false });
    expect(await resolveToken(db)).toBe('another-fake-token');
  });

  it('starts the history of the last sync over when the token is replaced', async () => {
    await saveConnection(db, input, services);
    setSyncRuntime({
      lastAttempt: { at: '2026-11-20T11:00:00.000Z', failure: { code: 'BAD_TOKEN' } },
    });

    await saveConnection(db, { ...input, token: 'another-fake-token' }, services);

    expect(getSyncRuntime().lastAttempt).toBeUndefined();
  });

  it('treats damaged stored values as no connection', async () => {
    await setKeyValue(db.syncState, CONNECTION_KEY, { owner: OWNER });
    await setKeyValue(db.syncState, TOKEN_KEY, { kind: 'plain' });
    expect(await readConnection(db)).toBeUndefined();
    await expect(resolveToken(db)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
  });
});

describe('a token protected by a passphrase', () => {
  it('is stored encrypted and is usable at once, because the user has just typed it', async () => {
    await saveConnection(db, { ...input, passphrase: 'parola mea' }, services);

    expect(await readTokenProtection(db)).toBe('passphrase');
    expect(JSON.stringify(await db.syncState.toArray())).not.toContain(TOKEN);
    expect(await resolveToken(db)).toBe(TOKEN);
    expect(getSyncRuntime().unlocked).toBe(true);
  });

  it('has to be unlocked again after the app is restarted', async () => {
    await saveConnection(db, { ...input, passphrase: 'parola mea' }, services);
    lockToken(); // what a page reload does to what was only in memory
    expect(getSyncRuntime().unlocked).toBe(false);
    await expect(resolveToken(db)).rejects.toMatchObject({ code: 'TOKEN_LOCKED' });

    await expect(unlockToken(db, 'altă parolă')).rejects.toMatchObject({ code: 'BAD_PASSPHRASE' });
    await expect(resolveToken(db)).rejects.toMatchObject({ code: 'TOKEN_LOCKED' });

    await unlockToken(db, 'parola mea');
    expect(await resolveToken(db)).toBe(TOKEN);
    expect(getSyncRuntime().unlocked).toBe(true);
  });
});

describe('disconnecting', () => {
  it('removes the token from the device, leaving no trace of it in the stored rows', async () => {
    await saveConnection(db, input, services);

    await disconnect(db, services);

    expect(await readConnection(db)).toBeUndefined();
    expect(await getKeyValue(db.syncState, TOKEN_KEY)).toBeUndefined();
    await expect(resolveToken(db)).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    expect(JSON.stringify(await db.syncState.toArray())).not.toContain(TOKEN);
  });

  it('forgets an unlocked token too', async () => {
    await saveConnection(db, { ...input, passphrase: 'parola mea' }, services);
    await disconnect(db, services);
    expect(getSyncRuntime().unlocked).toBe(false);
  });

  it('forgets how the last sync ended: it was about a connection that is gone', async () => {
    await saveConnection(db, input, services);
    setSyncRuntime({
      lastAttempt: { at: '2026-11-20T11:00:00.000Z', failure: { code: 'BAD_TOKEN' } },
    });

    await disconnect(db, services);

    expect(getSyncRuntime().lastAttempt).toBeUndefined();
  });
});
