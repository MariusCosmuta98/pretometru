import type { PretometruDB } from '@/storage';
import { readConnection, resolveToken } from './connection';
import { syncNow, type SyncResult } from './engine';
import { isSyncError, SyncError } from './errors';
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
    const failure = toSyncError(error);
    if (!NOT_AN_ATTEMPT.has(failure.code)) {
      // The status is a convenience; failing to write it must not hide why the sync failed.
      await recordFailure(db, failure, services).catch(() => undefined);
    }
    throw failure;
  } finally {
    setSyncRuntime({ running: false, phase: undefined });
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

/** Forgets a sync that is still running (tests: one that hangs must not block the next test). */
export function resetRunSync(): void {
  inFlight = undefined;
}
