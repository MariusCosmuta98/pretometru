import type { PretometruDB } from '@/storage';
import { readConnection, resolveToken } from './connection';
import { syncNow, type SyncResult } from './engine';
import { describeFailure, isSyncError, SyncError, type SyncFailure } from './errors';
import { createGitHubClient } from './github';
import { setSyncRuntime } from './runtime';
import { getSyncServices } from './services';
import { recordFailure, recordSuccess } from './status';

function toSyncError(error: unknown): SyncError {
  return isSyncError(error)
    ? error
    : new SyncError('UNEXPECTED', 'The sync failed in an unexpected way', { cause: error });
}

// Asking again for a passphrase or a connection is not a failed attempt: nothing was tried.
const NOT_AN_ATTEMPT = new Set(['TOKEN_LOCKED', 'NOT_CONFIGURED', 'CANCELLED']);

async function execute(): Promise<SyncResult> {
  const services = getSyncServices();
  let db: PretometruDB;
  try {
    db = await services.getDb();
  } catch (error) {
    throw new SyncError('STORAGE', 'The database of this device cannot be opened', {
      cause: error,
    });
  }

  setSyncRuntime({ running: true, phase: 'checking' });
  let failure: SyncFailure | undefined;
  try {
    const connection = await readConnection(db);
    if (!connection) throw new SyncError('NOT_CONFIGURED', 'GitHub sync is not set up');
    const token = await resolveToken(db);
    const repo = createGitHubClient({
      token,
      fetch: services.fetch,
      isOnline: services.isOnline,
      now: services.now,
    }).repo(connection.owner, connection.repo);

    const result = await syncNow({
      db,
      repo,
      deviceId: connection.deviceId,
      now: services.now,
      sleep: services.sleep,
      onPhase: (phase) => setSyncRuntime({ phase }),
    });
    await recordSuccess(db, result, services);
    return result;
  } catch (error) {
    const syncError = toSyncError(error);
    failure = describeFailure(syncError);
    if (!NOT_AN_ATTEMPT.has(syncError.code)) {
      // The status is a convenience; failing to write it must not hide why the sync failed.
      await recordFailure(db, syncError, services).catch(() => undefined);
    }
    throw syncError;
  } finally {
    // One update, so that a screen never sees "not running" without also seeing how the sync ended.
    setSyncRuntime({
      running: false,
      phase: undefined,
      lastAttempt: { at: services.now().toISOString(), failure },
    });
  }
}

let inFlight: Promise<SyncResult> | undefined;

/**
 * Syncs this device with the repository it is connected to and records the outcome in `syncState`.
 * One sync runs at a time: a call made while another is running joins it (a second tap, an
 * automatic run meeting a manual one) instead of starting a second one.
 */
export function runSync(): Promise<SyncResult> {
  inFlight ??= execute().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

/** Forgets a sync that is still running (tests): waits a moment for it to end, then lets the next one start. */
export async function resetRunSync(): Promise<void> {
  const running = inFlight;
  inFlight = undefined;
  if (running === undefined) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const patience = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 2_000);
  });
  await Promise.race([running.then(noop, noop), patience]);
  clearTimeout(timer);
}

function noop(): void {
  // nothing to do
}
