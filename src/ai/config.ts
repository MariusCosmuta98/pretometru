import { z } from 'zod';
import {
  deleteKeyValue,
  getKeyValue,
  setKeyValue,
  type PretometruDB,
  type StorageContext,
} from '@/storage';
import { AiError } from './errors';

/*
 * Everything about the feature lives in `syncState`: a device-local table that is never exported,
 * never synced and never part of a backup (the GitHub token has the same home). The key has a row
 * of its own, so that reading the settings never touches it. Deleting a row leaves a tombstone
 * with `value: null`: the old key does not stay on disk.
 */
export const AI_CONFIG_KEY = 'ai.gemini';
export const AI_KEY_KEY = 'ai.gemini.key';

/**
 * Gemini 3.5 Flash-Lite: stable, with a free tier, structured outputs and minimal thinking by
 * default, and named for "document parsing" and new projects by Google's model pages (checked
 * 2026-11-20, docs/architecture.md section 16). Model names are retired every few months, which is
 * why the id is a setting.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

const ConfigSchema = z.strictObject({ enabled: z.boolean(), model: z.string() });
const KeySchema = z.strictObject({ key: z.string().min(1) });

/** The model id ends up in an address (`/models/<id>:generateContent`): letters, digits, dots, dashes only. */
export function isValidModelId(model: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{1,63}$/.test(model);
}

/** Printable ASCII without spaces, 16 to 256 characters: safe in a request header and nothing like a sentence. */
export function isPlausibleApiKey(key: string): boolean {
  return /^[\x21-\x7e]{16,256}$/.test(key);
}

export interface AiConfig {
  /** Switched on and a key is saved: the only state in which anything may be sent. */
  enabled: boolean;
  model: string;
  hasKey: boolean;
  /** The last characters of the saved key, to recognise it (`…x9Qd`). The key itself never leaves `readApiKey`. */
  keyHint?: string;
}

interface StoredConfig {
  enabled: boolean;
  model: string;
}

async function readStored(db: PretometruDB): Promise<StoredConfig> {
  const parsed = ConfigSchema.safeParse(await getKeyValue(db.syncState, AI_CONFIG_KEY));
  if (!parsed.success) return { enabled: false, model: DEFAULT_MODEL };
  const { enabled, model } = parsed.data;
  return { enabled, model: isValidModelId(model) ? model : DEFAULT_MODEL };
}

/** The saved key, for the code that sends a request. Nothing else reads it. */
export async function readApiKey(db: PretometruDB): Promise<string | undefined> {
  const parsed = KeySchema.safeParse(await getKeyValue(db.syncState, AI_KEY_KEY));
  return parsed.success ? parsed.data.key : undefined;
}

/** The settings as the screens show them. `enabled` is false without a key, whatever was switched. */
export async function readAiConfig(db: PretometruDB): Promise<AiConfig> {
  const stored = await readStored(db);
  const key = await readApiKey(db);
  return {
    enabled: stored.enabled && key !== undefined,
    model: stored.model,
    hasKey: key !== undefined,
    ...(key === undefined ? {} : { keyHint: `…${key.slice(-4)}` }),
  };
}

export async function isAiEnabled(db: PretometruDB): Promise<boolean> {
  return (await readAiConfig(db)).enabled;
}

/** Saves the key without switching anything on. A replaced key keeps the on/off choice. */
export async function saveApiKey(
  db: PretometruDB,
  key: string,
  context?: StorageContext,
): Promise<void> {
  const trimmed = key.trim();
  if (!isPlausibleApiKey(trimmed)) throw new AiError('INVALID_KEY', 'That is not an API key');
  await setKeyValue(db.syncState, AI_KEY_KEY, { key: trimmed }, context);
}

/** Deletes the key from this device and switches the feature off. */
export async function removeApiKey(db: PretometruDB, context?: StorageContext): Promise<void> {
  await db.transaction('rw', db.syncState, async () => {
    await deleteKeyValue(db.syncState, AI_KEY_KEY, context);
    const stored = await readStored(db);
    if (stored.enabled) {
      await setKeyValue(db.syncState, AI_CONFIG_KEY, { ...stored, enabled: false }, context);
    }
  });
}

/** Switches the feature on or off. Switching on needs a saved key. */
export async function setAiEnabled(
  db: PretometruDB,
  enabled: boolean,
  context?: StorageContext,
): Promise<void> {
  await db.transaction('rw', db.syncState, async () => {
    if (enabled && (await readApiKey(db)) === undefined) {
      throw new AiError('NO_KEY', 'Save an API key before switching the feature on');
    }
    await setKeyValue(db.syncState, AI_CONFIG_KEY, { ...(await readStored(db)), enabled }, context);
  });
}

/** Chooses the model; an empty text goes back to the default. */
export async function setAiModel(
  db: PretometruDB,
  model: string,
  context?: StorageContext,
): Promise<void> {
  const id = model.trim().toLowerCase() || DEFAULT_MODEL;
  if (!isValidModelId(id)) throw new AiError('INVALID_MODEL', 'That is not a model id');
  await db.transaction('rw', db.syncState, async () => {
    await setKeyValue(
      db.syncState,
      AI_CONFIG_KEY,
      { ...(await readStored(db)), model: id },
      context,
    );
  });
}
