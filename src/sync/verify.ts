import { SyncError } from './errors';
import {
  createGitHubClient,
  isValidRepoRef,
  parseRepoRef,
  tokenKind,
  type TokenKind,
} from './github';
import { assertUsable, checkRemoteManifest, ensureInitialized, readRemote } from './remote';
import type { SyncServices } from './services';

/** What the connection check has established so far, in the order it checks. */
export type VerifyStep = 'token' | 'repository' | 'private' | 'access' | 'remote';

export interface VerifyInput {
  token: string;
  /** `owner/name`, a github.com address, or just a name (then the owner is the token's user). */
  repo: string;
}

export interface RemoteSummary {
  /** `new`: no Pretometru data yet, the first sync uploads this device. `data`: the first sync merges. */
  state: 'new' | 'data';
  /** Data files in the repository. */
  files: number;
  bytes: number;
  /** When the repository was last committed to (ISO). */
  updatedAt: string | undefined;
  /** The repository had no commit at all: the check made the first one (a README). */
  initialized: boolean;
}

export interface ConnectionCheck {
  /** The GitHub user the token belongs to. */
  login: string;
  owner: string;
  repo: string;
  defaultBranch: string;
  tokenKind: TokenKind;
  remote: RemoteSummary;
}

// A blob that no commit refers to: proves that the token may write without touching the history.
const WRITE_PROBE = 'pretometru write check\n';

function resolveRepo(typed: string, login?: string): { owner: string; repo: string } | undefined {
  const text = typed.trim();
  if (text.includes('/')) return parseRepoRef(text);
  return login !== undefined && isValidRepoRef(login, text)
    ? { owner: login, repo: text }
    : undefined;
}

/**
 * Everything the onboarding has to know before it saves a token: the token is valid, the
 * repository exists and is **private**, the token may read and write it (Contents: Read and
 * write), and what the repository holds. Throws the `SyncError` of the first check that fails;
 * `onStep` reports the ones that passed. It writes nothing except what an empty repository needs
 * to get its first commit.
 */
export async function verifyConnection(
  input: VerifyInput,
  services: Pick<SyncServices, 'fetch' | 'isOnline' | 'now'>,
  onStep: (step: VerifyStep) => void = () => undefined,
): Promise<ConnectionCheck> {
  const token = input.token.trim();
  if (!token || /\s/.test(token)) {
    throw new SyncError('BAD_TOKEN', 'The token is empty or contains spaces');
  }
  if (input.repo.includes('/') && !resolveRepo(input.repo)) {
    throw new SyncError('INVALID_REPO', 'The repository name is not valid');
  }

  const client = createGitHubClient({
    token,
    fetch: services.fetch,
    isOnline: services.isOnline,
    now: services.now,
  });
  const user = await client.getUser();
  onStep('token');

  const target = resolveRepo(input.repo, user.login);
  if (!target) throw new SyncError('INVALID_REPO', 'The repository name is not valid');
  const repo = client.repo(target.owner, target.repo);
  const info = await repo.get();
  onStep('repository');
  assertUsable(info);
  onStep('private');

  const hadCommits = (await repo.getBranchHead(info.defaultBranch)) !== undefined;
  const head = await ensureInitialized(repo, info.defaultBranch);
  // Initialising an empty repository is itself a write; otherwise try one.
  if (hadCommits) await repo.createBlob(WRITE_PROBE);
  onStep('access');

  const remote = await readRemote(repo, head);
  await checkRemoteManifest(repo, remote);
  onStep('remote');

  const files = [...remote.files.values()];
  return {
    login: user.login,
    owner: target.owner,
    repo: target.repo,
    defaultBranch: info.defaultBranch,
    tokenKind: tokenKind(token),
    remote: {
      state: remote.manifestSha !== undefined || files.length > 0 ? 'data' : 'new',
      files: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      updatedAt: remote.date,
      initialized: !hadCommits,
    },
  };
}
