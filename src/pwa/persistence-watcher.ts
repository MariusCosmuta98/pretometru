import { liveQuery } from 'dexie';
import { getDb, type PretometruDB } from '@/storage';
import {
  browserStorageEnv,
  hasAskedForPersistence,
  requestPersistenceOnce,
  type StorageEnv,
} from './persistence';

export interface WatcherOptions {
  env?: StorageEnv;
  openDb?: () => Promise<PretometruDB>;
}

const countConfirmed = async (db: PretometruDB) =>
  await db.receipts
    .where('status')
    .equals('confirmed')
    .filter((receipt) => receipt.deletedAt === undefined)
    .count();

/**
 * Asks the browser for persistent storage once, when the first receipt is confirmed: that is when the
 * data starts to matter to the user. Stops at the first answer, whatever it is. Returns the function
 * that stops watching.
 */
export function startPersistenceWatcher({
  env = browserStorageEnv(),
  openDb = getDb,
}: WatcherOptions = {}): () => void {
  if (typeof env.storage?.persist !== 'function' || hasAskedForPersistence(env))
    return () => undefined;

  let stopped = false;
  let subscription: { unsubscribe(): void } | undefined;
  const stop = () => {
    stopped = true;
    subscription?.unsubscribe();
  };

  openDb().then(
    (db) => {
      if (stopped) return;
      subscription = liveQuery(async () => await countConfirmed(db)).subscribe({
        next: (count) => {
          if (count === 0 || stopped) return;
          stop();
          void requestPersistenceOnce(env);
        },
        error: () => undefined,
      });
      // The query may have answered before `subscribe` returned.
      if (stopped) subscription.unsubscribe();
    },
    () => undefined,
  );
  return stop;
}
