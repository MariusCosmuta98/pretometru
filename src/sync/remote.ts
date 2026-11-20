import { SyncError } from './errors';
import { gitBlobSha } from './bytes';
import type { RepoClient, RepoInfo } from './github';
import {
  checkManifest,
  MANIFEST_PATH,
  manifestText,
  parseShard,
  README_PATH,
  README_TEXT,
  tableOfShardPath,
} from './layout';
import { mapLimit } from './pool';
import { validateRecords, type SyncRecord } from './records';

/** Reads run a few at a time; GitHub asks clients not to flood it. */
const DOWNLOADS_AT_ONCE = 4;

/** The repository as one commit left it: which of our files exist and what they hold (by Git id). */
export interface RemoteState {
  head: string;
  treeSha: string;
  /** When the head commit was made (ISO). */
  date: string | undefined;
  /** Our data files: path -> blob id and size. */
  files: Map<string, { sha: string; size: number }>;
  /** Blob id of `data/pretometru.json`; `undefined` when the repository holds no Pretometru data yet. */
  manifestSha: string | undefined;
}

/** The repository must be private (the data is personal) and writable. Nothing is read or written otherwise. */
export function assertUsable(info: RepoInfo): void {
  if (!info.isPrivate) {
    throw new SyncError('REPO_NOT_PRIVATE', `${info.fullName} is public: the sync refuses it`);
  }
  if (info.archived) {
    throw new SyncError('REPO_ARCHIVED', `${info.fullName} is archived and read-only`);
  }
}

/**
 * The head of the branch. A repository without a commit cannot take Git Data calls, so the first
 * commit is made through the Contents API: a README that says what the repository is.
 */
export async function ensureInitialized(repo: RepoClient, branch: string): Promise<string> {
  const existing = await repo.getBranchHead(branch);
  if (existing !== undefined) return existing;

  try {
    await repo.createFile(README_PATH, README_TEXT, 'Inițializare depozit Pretometru');
  } catch (error) {
    if (error instanceof SyncError && error.code === 'UNEXPECTED') {
      throw new SyncError('EMPTY_REPOSITORY', 'The first commit could not be created', {
        cause: error,
        ...(error.status === undefined ? {} : { status: error.status }),
      });
    }
    throw error;
  }
  const created = await repo.getBranchHead(branch);
  if (created === undefined) {
    throw new SyncError(
      'EMPTY_REPOSITORY',
      'The repository still has no branch after the first commit',
    );
  }
  return created;
}

export async function readRemote(repo: RepoClient, head: string): Promise<RemoteState> {
  const commit = await repo.getCommit(head);
  const tree = await repo.getTree(commit.treeSha);
  if (tree.truncated) {
    throw new SyncError('REMOTE_TOO_LARGE', 'The repository holds too many files to list');
  }

  const files = new Map<string, { sha: string; size: number }>();
  let manifestSha: string | undefined;
  for (const file of tree.files) {
    if (file.path === MANIFEST_PATH) manifestSha = file.sha;
    else if (tableOfShardPath(file.path) !== undefined) {
      files.set(file.path, { sha: file.sha, size: file.size });
    }
  }
  return { head, treeSha: commit.treeSha, date: commit.date, files, manifestSha };
}

/** Refuses a repository this app version must not touch (not ours, or written by a newer app). */
export async function checkRemoteManifest(repo: RepoClient, remote: RemoteState): Promise<void> {
  if (remote.manifestSha === undefined) return;
  // The app writes the manifest byte for byte; only a foreign one has to be read.
  if (remote.manifestSha === (await gitBlobSha(manifestText()))) return;
  checkManifest(await repo.getBlob(remote.manifestSha));
}

export interface DownloadedRecords {
  /** Records of the files that differ from the local ones, validated. */
  records: SyncRecord[];
  /** Files that are byte for byte what this device would write: nothing to download or merge. */
  identical: string[];
}

/**
 * Downloads the data files whose Git id differs from the one this device would write, and
 * validates every record. One unreadable file stops the sync before anything is changed.
 */
export async function downloadChanged(
  repo: RepoClient,
  remote: RemoteState,
  localShas: ReadonlyMap<string, string>,
): Promise<DownloadedRecords> {
  const identical: string[] = [];
  const changed: Array<{ path: string; sha: string }> = [];
  for (const [path, { sha }] of remote.files) {
    if (localShas.get(path) === sha) identical.push(path);
    else changed.push({ path, sha });
  }

  const perFile = await mapLimit(changed, DOWNLOADS_AT_ONCE, async ({ path, sha }) => {
    const table = tableOfShardPath(path);
    if (table === undefined) return [];
    return validateRecords(table, parseShard(path, await repo.getBlob(sha)), path);
  });
  return { records: perFile.flat(), identical };
}
