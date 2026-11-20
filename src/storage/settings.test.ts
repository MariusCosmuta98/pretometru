import { describe, expect, it } from 'vitest';
import { deleteKeyValue, getKeyValue, getSetting, setKeyValue, setSetting } from './settings';
import { createTestDb } from './testing';

describe('typed settings', () => {
  it('fall back to the default until a value is stored', async () => {
    const db = await createTestDb();
    expect(await getSetting(db, 'priceWindowDays')).toBe(90);
    expect(await getSetting(db, 'excludeDiscountedPrices')).toBe(false);
  });

  it('store and read back a validated value', async () => {
    const db = await createTestDb();
    await setSetting(db, 'priceWindowDays', 30);
    expect(await getSetting(db, 'priceWindowDays')).toBe(30);
  });

  it('refuse a value that breaks the setting schema and keep the old one', async () => {
    const db = await createTestDb();
    await setSetting(db, 'priceWindowDays', 30);
    await expect(setSetting(db, 'priceWindowDays', 0)).rejects.toThrow();
    expect(await getSetting(db, 'priceWindowDays')).toBe(30);
  });

  it('ignore a stored value that no longer fits (for instance written by an older version)', async () => {
    const db = await createTestDb();
    await db.settings.put({
      key: 'priceWindowDays',
      value: 'oops',
      updatedAt: '2026-11-20T10:00:00.000Z',
    });
    expect(await getSetting(db, 'priceWindowDays')).toBe(90);
  });
});

describe('key-value helpers (free-form settings, sync state)', () => {
  it('round-trip JSON values, one namespace per table', async () => {
    const db = await createTestDb();
    await setKeyValue(db.syncState, 'github', { repo: 'someone/data', branch: 'main' });
    await setKeyValue(db.settings, 'github', 'not the sync state');

    expect(await getKeyValue(db.syncState, 'github')).toEqual({
      repo: 'someone/data',
      branch: 'main',
    });
    expect(await getKeyValue(db.settings, 'github')).toBe('not the sync state');
    expect(await getKeyValue(db.syncState, 'missing')).toBeUndefined();
  });

  it('bump updatedAt on every write so sync sees the change', async () => {
    const db = await createTestDb();
    await setKeyValue(db.syncState, 'cursor', 1, {
      now: () => new Date('2026-11-20T10:00:00.000Z'),
    });
    await setKeyValue(db.syncState, 'cursor', 2, {
      now: () => new Date('2026-11-20T11:00:00.000Z'),
    });
    expect(await db.syncState.get('cursor')).toMatchObject({
      value: 2,
      updatedAt: '2026-11-20T11:00:00.000Z',
    });
  });

  it('refuse values that cannot be exported as JSON', async () => {
    const db = await createTestDb();
    await expect(setKeyValue(db.syncState, 'bad', () => 1)).rejects.toThrow();
    await expect(setKeyValue(db.syncState, 'bad', undefined)).rejects.toThrow();
  });

  it('leave a tombstone on delete without keeping the old value (a deleted token must not stay on disk)', async () => {
    const db = await createTestDb();
    await setKeyValue(db.syncState, 'token', 'sentinel-token-value');
    expect(await deleteKeyValue(db.syncState, 'token')).toBe(true);

    expect(await getKeyValue(db.syncState, 'token')).toBeUndefined();
    const row = await db.syncState.get('token');
    expect(row?.deletedAt).toBeDefined();
    expect(row?.value).toBeNull();
    expect(JSON.stringify(row)).not.toContain('sentinel-token-value');
    expect(await deleteKeyValue(db.syncState, 'token')).toBe(false);

    await setKeyValue(db.syncState, 'token', 'def');
    expect(await getKeyValue(db.syncState, 'token')).toBe('def');
    expect((await db.syncState.get('token'))?.deletedAt).toBeUndefined();
  });
});
