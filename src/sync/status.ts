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
import { SYNC_ERROR_CODES, type SyncError } from './errors';
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
  const retryAt =
    error.retryAt && !Number.isNaN(error.retryAt.getTime()) ? error.retryAt : undefined;
  const status: SyncStatus = {
    at: services.now().toISOString(),
    ok: false,
    error: {
      code: error.code,
      ...(error.detail ? { detail: error.detail } : {}),
      ...(retryAt ? { retryAt: retryAt.toISOString() } : {}),
    },
    ...(previous?.success ? { success: previous.success } : {}),
    ...(previous?.syncedThrough ? { syncedThrough: previous.syncedThrough } : {}),
  };
  await setKeyValue(db.syncState, STATUS_KEY, status, services);
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
