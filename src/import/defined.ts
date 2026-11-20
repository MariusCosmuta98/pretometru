/**
 * A copy of `value` without the keys whose value is `undefined`. The storage schemas reject
 * unknown keys, and a record should not carry `undefined` placeholders into IndexedDB or a backup.
 */
export function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
