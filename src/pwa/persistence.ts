/*
 * Persistent storage. Browsers may evict a site's data when the device runs low on space (and Safari
 * after a week without a visit unless the app is installed); `navigator.storage.persist()` asks them
 * not to. Chrome answers by its own heuristics (an installed app is granted), Firefox asks the user,
 * so the answer can be "no" and is shown in Settings with a manual retry. The app asks on its own only
 * once, after the first confirmed receipt (`persistence-watcher.ts`): never a banner, never a nag.
 */

export interface StorageEnv {
  storage: Pick<StorageManager, 'persist' | 'persisted' | 'estimate'> | undefined;
  /** Where the one-time ask is remembered (`localStorage`: device-local, never exported or synced). */
  memory: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  /** Running as an installed app (home-screen icon), not in a browser tab. */
  installed: () => boolean;
  now: () => Date;
}

export interface PersistenceState {
  /** The browser has `navigator.storage.persist()`. */
  supported: boolean;
  /** `undefined` when the browser cannot say. */
  persisted: boolean | undefined;
  usageBytes: number | undefined;
  quotaBytes: number | undefined;
  installed: boolean;
}

const ASKED_KEY = 'pretometru.storage-persist';

function safeLocalStorage(): StorageEnv['memory'] {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    // Access is denied in some privacy modes.
    return undefined;
  }
}

export function browserStorageEnv(): StorageEnv {
  return {
    storage: typeof navigator === 'undefined' ? undefined : navigator.storage,
    memory: safeLocalStorage(),
    installed: () =>
      (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
      (navigator as { standalone?: boolean }).standalone === true,
    now: () => new Date(),
  };
}

export async function readPersistence(
  env: StorageEnv = browserStorageEnv(),
): Promise<PersistenceState> {
  const { storage } = env;
  const [persisted, estimate] = await Promise.all([
    storage ? Promise.resolve(storage.persisted()).catch(() => undefined) : undefined,
    storage ? Promise.resolve(storage.estimate()).catch(() => undefined) : undefined,
  ]);
  return {
    supported: typeof storage?.persist === 'function',
    persisted,
    usageBytes: estimate?.usage,
    quotaBytes: estimate?.quota,
    installed: env.installed(),
  };
}

function remember(env: StorageEnv, granted: boolean): void {
  try {
    env.memory?.setItem(ASKED_KEY, JSON.stringify({ askedAt: env.now().toISOString(), granted }));
  } catch {
    // A full or blocked localStorage only means the app may ask once more.
  }
}

export function hasAskedForPersistence(env: StorageEnv = browserStorageEnv()): boolean {
  try {
    return env.memory?.getItem(ASKED_KEY) != null;
  } catch {
    return false;
  }
}

/** Asks the browser now (the manual retry in Settings). `undefined` when it cannot be asked. */
export async function requestPersistence(
  env: StorageEnv = browserStorageEnv(),
): Promise<boolean | undefined> {
  if (typeof env.storage?.persist !== 'function') return undefined;
  const granted = await Promise.resolve(env.storage.persist()).catch(() => false);
  remember(env, granted);
  return granted;
}

/** The automatic ask: skipped when the browser cannot be asked, already agreed or was asked before. */
export async function requestPersistenceOnce(
  env: StorageEnv = browserStorageEnv(),
): Promise<boolean | undefined> {
  if (typeof env.storage?.persist !== 'function' || hasAskedForPersistence(env)) return undefined;
  if (await Promise.resolve(env.storage.persisted()).catch(() => false)) {
    remember(env, true);
    return true;
  }
  return requestPersistence(env);
}
