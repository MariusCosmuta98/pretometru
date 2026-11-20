import { z } from 'zod';
import { base64ToBytes, bytesToBase64, utf8Bytes, utf8Text } from './bytes';
import { isAbortError, SyncError } from './errors';

/** The only host the app talks to (plan §11; the CSP allows exactly this origin). */
export const GITHUB_API = 'https://api.github.com';

export interface GitHubOptions {
  token: string;
  fetch: typeof fetch;
  /** `false` fails fast with `OFFLINE`; the default trusts `navigator.onLine`. */
  isOnline?: () => boolean;
  now?: () => Date;
  signal?: AbortSignal | undefined;
}

export interface RepoInfo {
  fullName: string;
  /** Sync refuses a repository that is not private. */
  isPrivate: boolean;
  archived: boolean;
  defaultBranch: string;
}

export interface CommitInfo {
  treeSha: string;
  /** When the commit was made (ISO). */
  date: string | undefined;
}

export interface TreeFile {
  path: string;
  sha: string;
  size: number;
}

export interface TreeListing {
  /** Every file of the tree, folders left out. */
  files: TreeFile[];
  /** The API stopped listing (100,000 entries or 7 MB). */
  truncated: boolean;
}

/** A path to set to a blob, or to delete (`sha: null`). */
export interface TreeChange {
  path: string;
  sha: string | null;
}

export interface RepoClient {
  readonly owner: string;
  readonly name: string;
  get(): Promise<RepoInfo>;
  /** The commit a branch points to; `undefined` when the branch does not exist (an empty repository). */
  getBranchHead(branch: string): Promise<string | undefined>;
  getCommit(sha: string): Promise<CommitInfo>;
  getTree(sha: string): Promise<TreeListing>;
  getBlob(sha: string): Promise<string>;
  createBlob(content: string): Promise<string>;
  createTree(baseTree: string, changes: readonly TreeChange[]): Promise<string>;
  createCommit(input: { message: string; tree: string; parent: string }): Promise<string>;
  /** `rejected`: the branch moved since `parent`, so the update would not be a fast-forward. */
  updateBranch(branch: string, sha: string): Promise<'updated' | 'rejected'>;
  /** Creates one file in a commit of its own: the only call that works on a repository without commits. */
  createFile(path: string, content: string, message: string): Promise<void>;
}

export interface GitHubClient {
  getUser(): Promise<{ login: string }>;
  repo(owner: string, name: string): RepoClient;
}

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function isValidRepoRef(owner: string, name: string): boolean {
  return (
    OWNER_PATTERN.test(owner) &&
    REPO_PATTERN.test(name) &&
    name !== '.' &&
    name !== '..' &&
    !name.toLowerCase().endsWith('.git')
  );
}

/** `owner/name`, or the repository's github.com address, as a user may paste it. */
export function parseRepoRef(input: string): { owner: string; repo: string } | undefined {
  const cleaned = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '');
  const [owner, repo, ...rest] = cleaned.split('/');
  if (!owner || !repo || rest.length > 0) return undefined;
  return isValidRepoRef(owner, repo) ? { owner, repo } : undefined;
}

/** The kind of token, from its prefix: the app recommends a fine-grained one limited to one repository. */
export type TokenKind = 'fine-grained' | 'classic' | 'unknown';

export function tokenKind(token: string): TokenKind {
  if (token.startsWith('github_pat_')) return 'fine-grained';
  if (/^gh[pousr]_/.test(token)) return 'classic';
  return 'unknown';
}

interface Reply {
  status: number;
  body: unknown;
  headers: Headers;
}

const messageOf = (body: unknown): string =>
  typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
    ? body.message
    : '';

function rateLimitRetryAt(headers: Headers, now: Date): Date {
  const retryAfter = Number(headers.get('retry-after'));
  if (headers.get('retry-after') !== null && Number.isFinite(retryAfter)) {
    return new Date(now.getTime() + retryAfter * 1000);
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-reset') !== null && Number.isFinite(reset)) {
    return new Date(reset * 1000);
  }
  return new Date(now.getTime() + 60_000);
}

const isRateLimited = ({ status, headers, body }: Reply): boolean =>
  status === 429 ||
  (status === 403 &&
    (headers.get('x-ratelimit-remaining') === '0' ||
      headers.get('retry-after') !== null ||
      /rate limit|abuse/i.test(messageOf(body))));

const RepoSchema = z.looseObject({
  full_name: z.string(),
  private: z.boolean(),
  archived: z.boolean().optional(),
  default_branch: z.string().min(1),
});
const UserSchema = z.looseObject({ login: z.string().min(1) });
const RefSchema = z.looseObject({ object: z.looseObject({ sha: z.string().regex(SHA_PATTERN) }) });
const CommitSchema = z.looseObject({
  tree: z.looseObject({ sha: z.string().regex(SHA_PATTERN) }),
  committer: z.looseObject({ date: z.string().optional() }).optional(),
});
const TreeSchema = z.looseObject({
  truncated: z.boolean().optional(),
  tree: z.array(
    z.looseObject({
      path: z.string(),
      type: z.string(),
      sha: z.string(),
      size: z.number().optional(),
    }),
  ),
});
const BlobSchema = z.looseObject({ content: z.string(), encoding: z.string() });
const CreatedSchema = z.looseObject({ sha: z.string().regex(SHA_PATTERN) });

function unexpected(what: string, reply?: Reply): SyncError {
  const status = reply?.status;
  const message = reply ? messageOf(reply.body) : '';
  return new SyncError('UNEXPECTED', `Unexpected answer from GitHub: ${what}`, {
    ...(status === undefined ? {} : { status }),
    detail: [status, message].filter(Boolean).join(' '),
  });
}

function parsed<S extends z.ZodType>(schema: S, reply: Reply, what: string): z.infer<S> {
  const result = schema.safeParse(reply.body);
  if (!result.success) throw unexpected(what, reply);
  return result.data;
}

const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

/**
 * A client of the few GitHub REST endpoints the sync needs (users, repositories, the Git Data API
 * and one Contents call). Only `Authorization`, `Accept` and `Content-Type` are ever sent: those
 * are the headers api.github.com's CORS policy lets a browser use. Failures every call shares
 * (offline, 401, rate limit, 5xx) are thrown here as `SyncError`; the status codes whose meaning
 * depends on the call (403, 404, 409, 422) are interpreted by the call.
 */
export function createGitHubClient(options: GitHubOptions): GitHubClient {
  const now = options.now ?? (() => new Date());
  const isOnline = options.isOnline ?? (() => globalThis.navigator?.onLine !== false);

  async function send(method: string, path: string, body?: unknown): Promise<Reply> {
    if (!isOnline()) throw new SyncError('OFFLINE', 'The device is offline');

    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
      Accept: 'application/vnd.github+json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let reply: Reply;
    try {
      const response = await options.fetch(`${GITHUB_API}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        // GitHub lets browsers cache GETs for a minute: a sync must never act on stale refs.
        cache: 'no-store',
        signal: options.signal ?? null,
      });
      const text = await response.text();
      let json: unknown;
      try {
        json = text === '' ? undefined : (JSON.parse(text) as unknown);
      } catch {
        json = undefined;
      }
      reply = { status: response.status, body: json, headers: response.headers };
    } catch (error) {
      if (isAbortError(error)) {
        throw new SyncError('CANCELLED', 'The sync was cancelled', { cause: error });
      }
      throw isOnline()
        ? new SyncError('NETWORK', 'GitHub could not be reached', { cause: error })
        : new SyncError('OFFLINE', 'The device is offline', { cause: error });
    }

    if (reply.status === 401) {
      throw new SyncError('BAD_TOKEN', 'GitHub rejected the token', { status: 401 });
    }
    if (isRateLimited(reply)) {
      throw new SyncError('RATE_LIMITED', 'The GitHub rate limit was reached', {
        status: reply.status,
        retryAt: rateLimitRetryAt(reply.headers, now()),
      });
    }
    if (reply.status >= 500) {
      throw new SyncError('SERVER', `GitHub answered ${reply.status}`, { status: reply.status });
    }
    return reply;
  }

  /** Writes and reads of an existing repository: no access to it (403, 404) means no permission. */
  const denied = (reply: Reply, what: string): SyncError =>
    reply.status === 403 || reply.status === 404
      ? new SyncError('NO_PERMISSION', `The token may not ${what}`, {
          status: reply.status,
          detail: messageOf(reply.body),
        })
      : unexpected(what, reply);

  function repo(owner: string, name: string): RepoClient {
    if (!isValidRepoRef(owner, name)) {
      throw new SyncError('INVALID_REPO', 'The repository name is not valid');
    }
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const sha = (value: string): string => {
      if (!SHA_PATTERN.test(value)) throw unexpected('a malformed object id');
      return value;
    };

    return {
      owner,
      name,

      async get() {
        const reply = await send('GET', base);
        if (reply.status === 403 || reply.status === 404) {
          throw new SyncError('NO_ACCESS', 'The repository does not exist or is not accessible', {
            status: reply.status,
          });
        }
        if (reply.status !== 200) throw unexpected('repository', reply);
        const data = parsed(RepoSchema, reply, 'repository');
        return {
          fullName: data.full_name,
          isPrivate: data.private,
          archived: data.archived ?? false,
          defaultBranch: data.default_branch,
        };
      },

      async getBranchHead(branch) {
        const reply = await send('GET', `${base}/git/ref/heads/${segments(branch)}`);
        // 409 is "Git Repository is empty"; 404 a branch that does not exist.
        if (reply.status === 404 || reply.status === 409) return undefined;
        if (reply.status === 403) throw denied(reply, 'read the repository');
        if (reply.status !== 200) throw unexpected('branch', reply);
        return parsed(RefSchema, reply, 'branch').object.sha;
      },

      async getCommit(commit) {
        const reply = await send('GET', `${base}/git/commits/${sha(commit)}`);
        if (reply.status === 403) throw denied(reply, 'read the repository');
        if (reply.status !== 200) throw unexpected('commit', reply);
        const data = parsed(CommitSchema, reply, 'commit');
        return { treeSha: data.tree.sha, date: data.committer?.date };
      },

      async getTree(tree) {
        const reply = await send('GET', `${base}/git/trees/${sha(tree)}?recursive=1`);
        if (reply.status === 403) throw denied(reply, 'read the repository');
        if (reply.status !== 200) throw unexpected('tree', reply);
        const data = parsed(TreeSchema, reply, 'tree');
        return {
          files: data.tree
            .filter((entry) => entry.type === 'blob')
            .map((entry) => ({ path: entry.path, sha: entry.sha, size: entry.size ?? 0 })),
          truncated: data.truncated ?? false,
        };
      },

      async getBlob(blob) {
        const reply = await send('GET', `${base}/git/blobs/${sha(blob)}`);
        if (reply.status === 403) throw denied(reply, 'read the repository');
        if (reply.status !== 200) throw unexpected('blob', reply);
        const data = parsed(BlobSchema, reply, 'blob');
        try {
          return data.encoding === 'base64' ? utf8Text(base64ToBytes(data.content)) : data.content;
        } catch (error) {
          throw new SyncError('REMOTE_INVALID', 'A file of the repository is not valid text', {
            cause: error,
            detail: blob,
          });
        }
      },

      async createBlob(content) {
        const reply = await send('POST', `${base}/git/blobs`, { content, encoding: 'utf-8' });
        if (reply.status === 409) {
          throw new SyncError('EMPTY_REPOSITORY', 'The repository has no commit yet', {
            status: 409,
          });
        }
        if (reply.status !== 201) throw denied(reply, 'write to the repository');
        return parsed(CreatedSchema, reply, 'blob').sha;
      },

      async createTree(baseTree, changes) {
        const reply = await send('POST', `${base}/git/trees`, {
          base_tree: sha(baseTree),
          tree: changes.map((change) => ({
            path: change.path,
            mode: '100644',
            type: 'blob',
            sha: change.sha,
          })),
        });
        if (reply.status !== 201) throw denied(reply, 'write to the repository');
        return parsed(CreatedSchema, reply, 'tree').sha;
      },

      async createCommit({ message, tree, parent }) {
        const reply = await send('POST', `${base}/git/commits`, {
          message,
          tree: sha(tree),
          parents: [sha(parent)],
        });
        if (reply.status !== 201) throw denied(reply, 'write to the repository');
        return parsed(CreatedSchema, reply, 'commit').sha;
      },

      async updateBranch(branch, commit) {
        const reply = await send('PATCH', `${base}/git/refs/heads/${segments(branch)}`, {
          sha: sha(commit),
          force: false,
        });
        if (reply.status === 200) return 'updated';
        const message = messageOf(reply.body);
        if (reply.status === 409 || (reply.status === 422 && /fast.?forward/i.test(message))) {
          return 'rejected';
        }
        if (/protected branch|rule violations|pull request/i.test(message)) {
          throw new SyncError('BRANCH_PROTECTED', 'The branch does not accept direct pushes', {
            status: reply.status,
            detail: message,
          });
        }
        throw denied(reply, 'write to the repository');
      },

      async createFile(path, content, message) {
        const reply = await send('PUT', `${base}/contents/${segments(path)}`, {
          message,
          content: bytesToBase64(utf8Bytes(content)),
        });
        if (reply.status !== 200 && reply.status !== 201) {
          throw denied(reply, 'write to the repository');
        }
      },
    };
  }

  return {
    async getUser() {
      const reply = await send('GET', '/user');
      if (reply.status !== 200) throw unexpected('user', reply);
      return { login: parsed(UserSchema, reply, 'user').login };
    },
    repo,
  };
}
