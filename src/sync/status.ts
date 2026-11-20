import { z } from 'zod';
import { InstantSchema, isPortableSetting } from '@/domain';
import { getKeyValue, setKeyValue, type PretometruDB } from '@/storage';
import {
  readConnection,
  readTokenProtection,
  STATUS_KEY,
  type Connection,
  type TokenProtection,
} from './connection';
import type { SyncResult } from './engine';
import { describeFailure, SYNC_ERROR_CODES, type SyncError, type SyncFailure } from './errors';
import type { SyncAttempt } from './runtime';
import type { SyncServices } from './services';

const StatusSchema = z.strictObject({
  /** When the last attempt finished. */
  at: InstantSchema,
  ok: z.boolean(),
  /** What the last successful sync did; kept while later attempts fail. */
  success: z
    .strictObject({
      at: InstantSchema,
      pulled: z.int().min(0),
      pushed: z.int().min(0),
      firstSync: z.boolean(),
      commit: z.string().optional(),
    })
    .optional(),
  /** Why the last attempt failed; absent when it succeeded. */
  error: z
    .strictObject({
      code: z.enum(SYNC_ERROR_CODES),
      detail: z.string().optional(),
      retryAt: InstantSchema.optional(),
    })
    .optional(),
  /** The newest `updatedAt` this device had when the last successful sync read it. */
  syncedThrough: InstantSchema.optional(),
});
export type SyncStatus = z.infer<typeof StatusSchema>;

export async function readStatus(db: PretometruDB): Promise<SyncStatus | undefined> {
  const parsed = StatusSchema.safeParse(await getKeyValue(db.syncState, STATUS_KEY));
  return parsed.success ? parsed.data : undefined;
}

export async function recordSuccess(
  db: PretometruDB,
  result: SyncResult,
  services: Pick<SyncServices, 'now'>,
): Promise<void> {
  const status: SyncStatus = {
    at: result.at,
    ok: true,
    success: {
      at: result.at,
      pulled: result.pulled,
      pushed: result.pushed,
      firstSync: result.firstSync,
      ...(result.commit === undefined ? {} : { commit: result.commit }),
    },
    ...(result.syncedThrough === undefined ? {} : { syncedThrough: result.syncedThrough }),
  };
  await setKeyValue(db.syncState, STATUS_KEY, status, services);
}

export async function recordFailure(
  db: PretometruDB,
  error: SyncError,
  services: Pick<SyncServices, 'now'>,
): Promise<void> {
  const previous = await readStatus(db);
  const status: SyncStatus = {
    at: services.now().toISOString(),
    ok: false,
    error: describeFailure(error),
    ...(previous?.success ? { success: previous.success } : {}),
    ...(previous?.syncedThrough ? { syncedThrough: previous.syncedThrough } : {}),
  };
  await setKeyValue(db.syncState, STATUS_KEY, status, services);
}

/**
 * The failure the section shows: that of the sync which ended last. This session's own last sync is
 * known the moment it ends, whoever started it (the button, the automatic run, the onboarding),
 * while the stored status follows through a live query; after a restart, or when another tab synced
 * since, the stored status is the newer witness. A tie goes to the session: it is the same sync.
 */
export function currentFailure(
  status: SyncStatus | undefined,
  lastAttempt: SyncAttempt | undefined,
): SyncFailure | undefined {
  if (lastAttempt && (status === undefined || lastAttempt.at >= status.at)) {
    return lastAttempt.failure;
  }
  return status && !status.ok ? status.error : undefined;
}

/** The newest `updatedAt` among the records a sync carries (portable settings only). */
export async function latestChange(db: PretometruDB): Promise<string | undefined> {
  const newest = async (table: { orderBy(index: string): { last(): Promise<unknown> } }) =>
    ((await table.orderBy('updatedAt').last()) as { updatedAt: string } | undefined)?.updatedAt;

  const tables = [
    db.stores,
    db.receipts,
    db.lines,
    db.products,
    db.aliases,
    db.categories,
    db.lists,
    db.listItems,
  ];
  const settings = db.settings
    .orderBy('updatedAt')
    .reverse()
    .filter((row) => isPortableSetting(row.key))
    .first()
    .then((row) => row?.updatedAt);

  const all = await Promise.all([...tables.map(newest), settings]);
  return all.reduce<string | undefined>(
    (max, value) => (value !== undefined && (max === undefined || value > max) ? value : max),
    undefined,
  );
}

/** What the Settings section shows: the connection, its last result and whether anything is waiting. */
export interface SyncView {
  connection: Connection | undefined;
  protection: TokenProtection | undefined;
  status: SyncStatus | undefined;
  /** Something on this device is newer than what the last successful sync read. */
  unsynced: boolean;
}

export async function loadSyncView(db: PretometruDB): Promise<SyncView> {
  const [connection, protection, status, latest] = await Promise.all([
    readConnection(db),
    readTokenProtection(db),
    readStatus(db),
    latestChange(db),
  ]);
  const unsynced =
    connection !== undefined &&
    latest !== undefined &&
    (status?.syncedThrough === undefined || latest > status.syncedThrough);
  return { connection, protection, status, unsynced };
}
