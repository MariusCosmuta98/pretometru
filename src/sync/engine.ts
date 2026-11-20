import { createBackup, isPortableSetting } from '@/domain';
import { exportBackup, importBackup, type PretometruDB } from '@/storage';
import { gitBlobSha } from './bytes';
import { SyncError } from './errors';
import type { RepoClient, TreeChange } from './github';
import { MANIFEST_PATH, manifestText, planShards, type ShardFile } from './layout';
import { mapLimit } from './pool';
import {
  assertUsable,
  checkRemoteManifest,
  downloadChanged,
  ensureInitialized,
  readRemote,
} from './remote';
import { fromBackupData, identityOf, overlay, toBackupData, type SyncRecord } from './records';
import type { SyncPhase } from './runtime';

const DEFAULT_ATTEMPTS = 4;
/** Writes run a couple at a time: GitHub rate-limits clients that create content in bursts. */
const UPLOADS_AT_ONCE = 3;

export interface SyncOptions {
  db: PretometruDB;
  repo: RepoClient;
  /** Tells this device's commits apart in the repository's history. */
  deviceId: string;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  onPhase?: (phase: SyncPhase) => void;
  /** How often the whole round is tried when the branch keeps moving (default 4). */
  maxAttempts?: number;
}

export interface SyncResult {
  /** When the sync finished (ISO). */
  at: string;
  /** The repository held no Pretometru data yet: this sync uploaded everything. */
  firstSync: boolean;
  /** Records written to this device (new or newer than the local copy). */
  pulled: number;
  /** Records that are new or changed in the repository afterwards. */
  pushed: number;
  /** The commit this sync made; `undefined` when both sides already agreed. */
  commit: string | undefined;
  /** The branch head afterwards. */
  head: string;
  /** Rounds it took (more than 1 when another device pushed in the meantime). */
  attempts: number;
  /** Local records left out because they no longer satisfy their schema. */
  skipped: number;
  /** The newest `updatedAt` among this device's records that the sync read; the status uses it to tell what changed since. */
  syncedThrough: string | undefined;
}

interface PlannedFile extends ShardFile {
  /** Git blob id of `text`. */
  sha: string;
}

async function plan(records: Iterable<SyncRecord>): Promise<PlannedFile[]> {
  return Promise.all(
    planShards(records).map(async (file) => ({ ...file, sha: await gitBlobSha(file.text) })),
  );
}

async function readLocal(db: PretometruDB, now: Date) {
  try {
    const { backup, skipped } = await exportBackup(db, now);
    return { records: fromBackupData(backup.data), skipped: skipped.length };
  } catch (error) {
    throw new SyncError('STORAGE', 'The data of this device could not be read', { cause: error });
  }
}

/** Last-write-wins per record, through the storage layer's merge import (which also reconciles lines). */
async function applyIncoming(db: PretometruDB, incoming: SyncRecord[], now: Date): Promise<number> {
  // Settings the app does not mark portable (a key planted in the repository) never reach this device.
  const records = incoming.filter(
    (record) => record.table !== 'settings' || isPortableSetting(record.key),
  );
  if (records.length === 0) return 0;
  try {
    const report = await importBackup(db, createBackup(toBackupData(records), now), {
      mode: 'merge',
    });
    return Object.values(report.tables).reduce(
      (sum, table) => sum + table.added + table.updated,
      0,
    );
  } catch (error) {
    throw new SyncError('STORAGE', 'The downloaded data could not be saved on this device', {
      cause: error,
    });
  }
}

const countOf = (records: number) =>
  `${records} ${records === 1 ? 'înregistrare' : 'înregistrări'}`;

function commitMessage(firstSync: boolean, pushed: number, deviceId: string): string {
  const what = firstSync ? 'Prima sincronizare' : 'Sincronizare';
  return `${what} Pretometru (dispozitiv ${deviceId}): ${countOf(pushed)}`;
}

type Round =
  { moved: true; pulled: number } | { moved: false; result: Omit<SyncResult, 'attempts' | 'at'> };

/**
 * One pull -> merge -> push round against the head the branch has right now: download what differs,
 * merge it into the local database, write what the repository lacks in one commit. `moved` means
 * somebody else pushed first; the caller starts over from the new head.
 */
async function round(options: SyncOptions, branch: string): Promise<Round> {
  const { db, repo, now, onPhase } = options;

  onPhase?.('checking');
  const head = await ensureInitialized(repo, branch);
  const remote = await readRemote(repo, head);
  await checkRemoteManifest(repo, remote);
  const firstSync = remote.manifestSha === undefined && remote.files.size === 0;

  const local = await readLocal(db, now());
  const localFiles = await plan(local.records);
  const localShas = new Map(localFiles.map((file) => [file.path, file.sha]));

  onPhase?.('downloading');
  const { records: downloaded, identical } = await downloadChanged(repo, remote, localShas);

  onPhase?.('merging');
  const incoming = overlay(new Map<string, SyncRecord>(), downloaded);
  const remoteRecords = new Map(incoming);
  const localByPath = new Map(localFiles.map((file) => [file.path, file]));
  for (const path of identical) overlay(remoteRecords, localByPath.get(path)?.records ?? []);

  let pulled = 0;
  let current = local.records;
  if (incoming.size > 0) {
    pulled = await applyIncoming(db, [...incoming.values()], now());
    current = (await readLocal(db, now())).records;
  }

  // What the repository should hold: every record of both sides, the newer copy of each. On a
  // tie the repository's copy stays, so two devices never overwrite each other forever.
  const merged = overlay(new Map(remoteRecords), current);
  const files = downloaded.length === 0 ? localFiles : await plan(merged.values());

  const changed = files.filter((file) => remote.files.get(file.path)?.sha !== file.sha);
  const wanted = new Set(files.map((file) => file.path));
  const stale = [...remote.files.keys()].filter((path) => !wanted.has(path));
  const needsManifest = remote.manifestSha === undefined;

  let pushed = 0;
  for (const record of merged.values()) {
    if (remoteRecords.get(identityOf(record))?.text !== record.text) pushed++;
  }

  const syncedThrough = current.reduce<string | undefined>(
    (max, record) => (max === undefined || record.updatedAt > max ? record.updatedAt : max),
    undefined,
  );
  const base = { firstSync, pulled, pushed, head, skipped: local.skipped, syncedThrough };
  if (changed.length === 0 && stale.length === 0 && !needsManifest) {
    return { moved: false, result: { ...base, pushed: 0, commit: undefined } };
  }

  onPhase?.('uploading');
  const uploads = changed.map(({ path, text }) => ({ path, text }));
  if (needsManifest) uploads.push({ path: MANIFEST_PATH, text: manifestText() });
  const blobs = await mapLimit(uploads, UPLOADS_AT_ONCE, async ({ path, text }) => ({
    path,
    sha: await repo.createBlob(text),
  }));
  const changes: TreeChange[] = [...blobs, ...stale.map((path) => ({ path, sha: null }))].sort(
    (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );

  const tree = await repo.createTree(remote.treeSha, changes);
  const commit = await repo.createCommit({
    message: commitMessage(firstSync, pushed, options.deviceId),
    tree,
    parent: head,
  });
  if ((await repo.updateBranch(branch, commit)) === 'rejected') return { moved: true, pulled };
  return { moved: false, result: { ...base, commit, head: commit } };
}

/**
 * Brings this device and the private data repository to the same state, in one atomic commit:
 * pull what the repository has, merge it (last write wins per record, a newer tombstone deletes),
 * push what the repository lacks. The Git history is the backup. When the branch moves meanwhile
 * (another device synced), the ref update is rejected and the round starts over from the new
 * head; the merge is idempotent, so repeating it is safe.
 */
export async function syncNow(options: SyncOptions): Promise<SyncResult> {
  options.onPhase?.('checking');
  const info = await options.repo.get();
  assertUsable(info);

  const maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS;
  let pulledBefore = 0;
  for (let attempt = 1; ; attempt++) {
    const outcome = await round(options, info.defaultBranch);
    if (!outcome.moved) {
      const { result } = outcome;
      return {
        ...result,
        pulled: result.pulled + pulledBefore,
        attempts: attempt,
        at: options.now().toISOString(),
      };
    }
    pulledBefore += outcome.pulled;
    if (attempt >= maxAttempts) {
      throw new SyncError('CONFLICT', `The branch moved ${attempt} times while syncing`);
    }
    await options.sleep(200 * attempt + Math.floor(Math.random() * 200));
  }
}
