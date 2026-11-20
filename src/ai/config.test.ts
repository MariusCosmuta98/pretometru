import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, getKeyValue, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import {
  AI_CONFIG_KEY,
  AI_KEY_KEY,
  DEFAULT_MODEL,
  isAiEnabled,
  isPlausibleApiKey,
  isValidModelId,
  readAiConfig,
  readApiKey,
  removeApiKey,
  saveApiKey,
  setAiEnabled,
  setAiModel,
} from './config';
import { AiError } from './errors';
import { FAKE_KEY } from './testing';

let db: PretometruDB;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.delete();
});

const wholeDatabase = async (): Promise<string> =>
  JSON.stringify({
    settings: await db.settings.toArray(),
    syncState: await db.syncState.toArray(),
    backup: (await exportBackup(db)).backup,
  });

describe('the settings of the feature', () => {
  it('start off: nothing is enabled, there is no key and the model is the default', async () => {
    expect(await readAiConfig(db)).toEqual({ enabled: false, model: DEFAULT_MODEL, hasKey: false });
    expect(await isAiEnabled(db)).toBe(false);
    expect(await readApiKey(db)).toBeUndefined();
  });

  it('save a key without switching anything on, and show only its end', async () => {
    await saveApiKey(db, `  ${FAKE_KEY}\n`);
    expect(await readApiKey(db)).toBe(FAKE_KEY);
    expect(await readAiConfig(db)).toEqual({
      enabled: false,
      model: DEFAULT_MODEL,
      hasKey: true,
      keyHint: '…0001',
    });
  });

  it('cannot be switched on without a key, and are on only while the key is there', async () => {
    await expect(setAiEnabled(db, true)).rejects.toMatchObject({ code: 'NO_KEY' });
    expect(await isAiEnabled(db)).toBe(false);

    await saveApiKey(db, FAKE_KEY);
    await setAiEnabled(db, true);
    expect(await isAiEnabled(db)).toBe(true);

    await setAiEnabled(db, false);
    expect(await isAiEnabled(db)).toBe(false);
  });

  it('keep the on/off choice when the key is replaced', async () => {
    await saveApiKey(db, FAKE_KEY);
    await setAiEnabled(db, true);
    await saveApiKey(db, 'another-fake-key-for-tests-0002');
    expect(await readApiKey(db)).toBe('another-fake-key-for-tests-0002');
    expect(await isAiEnabled(db)).toBe(true);
  });

  it('switch the feature off and leave no copy of the key when it is removed', async () => {
    await saveApiKey(db, FAKE_KEY);
    await setAiEnabled(db, true);
    await removeApiKey(db);

    expect(await isAiEnabled(db)).toBe(false);
    expect(await readApiKey(db)).toBeUndefined();
    expect(await readAiConfig(db)).toMatchObject({ enabled: false, hasKey: false });
    // The tombstone is there (so nothing stale returns) but it holds no value.
    expect(await db.syncState.get(AI_KEY_KEY)).toMatchObject({ value: null });
    expect(await wholeDatabase()).not.toContain(FAKE_KEY);
    // Switching on again needs a new key.
    await expect(setAiEnabled(db, true)).rejects.toBeInstanceOf(AiError);
  });

  it('refuse a key that is not one, whatever the spaces around it', async () => {
    for (const bad of [
      '',
      'short',
      'has a space inside the key 000',
      'ключ-ключ-ключ-ключ-0000',
      `${FAKE_KEY}\n${FAKE_KEY}`,
    ]) {
      await expect(saveApiKey(db, bad), bad).rejects.toMatchObject({ code: 'INVALID_KEY' });
    }
    expect(await readApiKey(db)).toBeUndefined();
    expect(isPlausibleApiKey(FAKE_KEY)).toBe(true);
  });

  it('keep a model id that can be put in an address, lower-cased, and go back to the default when emptied', async () => {
    await setAiModel(db, ' Gemini-3.6-Flash ');
    expect((await readAiConfig(db)).model).toBe('gemini-3.6-flash');
    await setAiModel(db, '');
    expect((await readAiConfig(db)).model).toBe(DEFAULT_MODEL);

    for (const bad of [
      'a',
      'a/b',
      'gemini:generateContent',
      'gemini 3',
      '../x',
      'x?key=1',
      '-gemini',
      `m${'x'.repeat(70)}`,
    ]) {
      await expect(setAiModel(db, bad), bad).rejects.toMatchObject({ code: 'INVALID_MODEL' });
      expect(isValidModelId(bad)).toBe(false);
    }
  });

  it('ignore a stored value that no longer fits instead of failing', async () => {
    await db.syncState.put({
      key: AI_CONFIG_KEY,
      value: { enabled: 'yes', model: 7 },
      updatedAt: '2026-11-20T10:00:00.000Z',
    });
    await db.syncState.put({
      key: AI_KEY_KEY,
      value: 'not an object',
      updatedAt: '2026-11-20T10:00:00.000Z',
    });
    expect(await readAiConfig(db)).toEqual({ enabled: false, model: DEFAULT_MODEL, hasKey: false });

    await db.syncState.put({
      key: AI_CONFIG_KEY,
      value: { enabled: true, model: 'not a model!' },
      updatedAt: '2026-11-20T10:00:00.000Z',
    });
    await saveApiKey(db, FAKE_KEY);
    expect(await readAiConfig(db)).toMatchObject({ enabled: true, model: DEFAULT_MODEL });
  });
});

describe('the key', () => {
  it('lives in syncState only, never in a synced table, a backup or an export', async () => {
    await saveApiKey(db, FAKE_KEY);
    await setAiEnabled(db, true);
    await setAiModel(db, 'gemini-3.6-flash');

    expect(await getKeyValue(db.syncState, AI_KEY_KEY)).toEqual({ key: FAKE_KEY });
    // The on/off choice and the model are device-local too: nothing of the feature is portable.
    expect(JSON.stringify(await db.settings.toArray())).not.toContain('ai.gemini');
    const { backup } = await exportBackup(db);
    const text = JSON.stringify(backup);
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain('ai.gemini');
    expect(text).not.toContain('gemini-3.6-flash');
  });
});
