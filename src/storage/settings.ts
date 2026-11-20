import type { Table } from 'dexie';
import {
  KeyValueSchema,
  SETTING_DEFINITIONS,
  type KeyValue,
  type SettingKey,
  type SettingValue,
} from '@/domain';
import type { PretometruDB } from './db';
import { resolveContext, type StorageContext } from './records';

/** Value stored under `key`, or `undefined` if there is none (or it was deleted). */
export async function getKeyValue(table: Table<KeyValue, string>, key: string): Promise<unknown> {
  const row = await table.get(key);
  return row?.deletedAt === undefined ? row?.value : undefined;
}

/** Stores any JSON value under `key`; rejects anything that could not be exported as JSON. */
export async function setKeyValue(
  table: Table<KeyValue, string>,
  key: string,
  value: unknown,
  context?: StorageContext,
): Promise<void> {
  const row = KeyValueSchema.parse({
    key,
    value,
    updatedAt: resolveContext(context).now().toISOString(),
  });
  await table.put(row);
}

/** Leaves a tombstone (so sync can propagate it); the old value, a possible secret, is dropped. `false` if there was no live value. */
export function deleteKeyValue(
  table: Table<KeyValue, string>,
  key: string,
  context?: StorageContext,
): Promise<boolean> {
  const stamp = resolveContext(context).now().toISOString();
  return table.db.transaction('rw', table, async () => {
    const row = await table.get(key);
    if (!row || row.deletedAt !== undefined) return false;
    await table.put({ ...row, value: null, updatedAt: stamp, deletedAt: stamp });
    return true;
  });
}

/** A known setting, or its default when unset or when the stored value no longer fits. */
export async function getSetting<K extends SettingKey>(
  db: PretometruDB,
  key: K,
): Promise<SettingValue<K>> {
  const definition = SETTING_DEFINITIONS[key];
  const parsed = definition.schema.safeParse(await getKeyValue(db.settings, key));
  return (parsed.success ? parsed.data : definition.default) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(
  db: PretometruDB,
  key: K,
  value: SettingValue<K>,
  context?: StorageContext,
): Promise<void> {
  await setKeyValue(db.settings, key, SETTING_DEFINITIONS[key].schema.parse(value), context);
}
