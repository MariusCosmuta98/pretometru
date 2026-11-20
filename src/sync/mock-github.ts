/**
 * Test-only: an in-memory GitHub behind a `fetch`. It answers the calls the sync makes (the user,
 * a repository, the Git Data API and one Contents call) with the status codes and error bodies of
 * api.github.com, computes real Git object ids, refuses any header the real API's CORS policy
 * would block, and lets a test break things on purpose (offline, rate limit, a push that lands
 * between two requests of the sync). Everything in it is fake data: never use a real token.
 * It depends on nothing but Web APIs (no `@/` import), so a browser test can serve the real
 * app from it too (`e2e/sync.spec.ts`). Never import this from application code.
 */

const API_ORIGIN = 'https://api.github.com';
// What a browser may send to api.github.com: the headers the plan's CORS check covered.
const ALLOWED_HEADERS = new Set(['authorization', 'accept', 'content-type']);

export type Permission = 'write' | 'read' | 'metadata';

export interface MockRepoOptions {
  owner: string;
  name: string;
  /** Default true. */
  private?: boolean;
  archived?: boolean;
  defaultBranch?: string;
  /** Make the first commit with a README (default). `false` creates a repository without any commit. */
  readme?: boolean;
}

export interface MockRequest {
  method: string;
  path: string;
  status: number;
  headers: string[];
  body: unknown;
}

export interface MockCommit {
  sha: string;
  parents: string[];
  message: string;
  files: ReadonlyMap<string, string>;
}

export interface MockReply {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

interface Repo {
  owner: string;
  name: string;
  private: boolean;
  archived: boolean;
  defaultBranch: string;
  blobs: Map<string, string>;
  trees: Map<string, Map<string, string>>;
  commits: Map<string, { tree: string; parents: string[]; message: string; date: string }>;
  refs: Map<string, string>;
}

interface Account {
  login: string;
  access: Map<string, Permission>;
  revoked: boolean;
}

interface Interception<T> {
  match: RegExp;
  times: number;
  value: T;
}

const encoder = new TextEncoder();

async function objectId(type: string, content: string): Promise<string> {
  const body = encoder.encode(content);
  const header = encoder.encode(`${type} ${body.length}\0`);
  const whole = new Uint8Array(header.length + body.length);
  whole.set(header);
  whole.set(body, header.length);
  const digest = await crypto.subtle.digest('SHA-1', whole);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

const message = (status: number, text: string) => json(status, { message: text });
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');
const notFound = () => message(404, 'Not Found');
const forbidden = () => message(403, 'Resource not accessible by personal access token');
const empty = () => message(409, 'Git Repository is empty.');

export class MockGitHub {
  /** Every request that reached the server, in order. */
  readonly requests: MockRequest[] = [];
  /** Requests that a browser would have blocked (a header outside the CORS allow-list, another origin). */
  readonly violations: string[] = [];

  private readonly accounts = new Map<string, Account>();
  private readonly repos = new Map<string, Repo>();
  private readonly faults: Array<Interception<MockReply>> = [];
  private readonly hooks: Array<Interception<() => void | Promise<void>>> = [];
  private offline = false;
  private disposed = false;
  private latency = 0;
  private wake: () => void = () => undefined;
  // Settles when the test is over: a request held by a hook is let go then.
  private readonly disposal = new Promise<void>((resolve) => {
    this.wake = resolve;
  });
  private treeLimit = Number.POSITIVE_INFINITY;
  private commitCounter = 0;
  private clock = Date.parse('2026-11-20T10:00:00.000Z');

  // --- the world -------------------------------------------------------------------------------

  /** A user with a token. `repos` are the repositories the token may see, with what it may do. */
  addToken(token: string, login: string, repos: Record<string, Permission> = {}): this {
    this.accounts.set(token, { login, access: new Map(Object.entries(repos)), revoked: false });
    return this;
  }

  grant(token: string, fullName: string, permission: Permission): this {
    this.account(token).access.set(fullName, permission);
    return this;
  }

  revoke(token: string): this {
    this.account(token).revoked = true;
    return this;
  }

  async addRepo(options: MockRepoOptions): Promise<this> {
    const repo: Repo = {
      owner: options.owner,
      name: options.name,
      private: options.private ?? true,
      archived: options.archived ?? false,
      defaultBranch: options.defaultBranch ?? 'main',
      blobs: new Map(),
      trees: new Map(),
      commits: new Map(),
      refs: new Map(),
    };
    this.repos.set(`${options.owner}/${options.name}`, repo);
    if (options.readme ?? true) {
      await this.commit(repo, new Map([['README.md', '# pretometru-data\n']]), 'Initial commit');
    }
    return this;
  }

  setPrivate(fullName: string, value: boolean): this {
    this.repo(fullName).private = value;
    return this;
  }

  setArchived(fullName: string, value: boolean): this {
    this.repo(fullName).archived = value;
    return this;
  }

  /** The network is down: every request fails the way `fetch` does. */
  setOffline(value: boolean): this {
    this.offline = value;
    return this;
  }

  /** Every request takes `ms` longer to reach the server (a slow connection); 0 ends it. */
  setLatency(ms: number): this {
    this.latency = ms;
    return this;
  }

  /**
   * Ends the test's world: a request that a hook is holding is let go and fails, and every later
   * request fails too, so that a sync a failed test left behind ends instead of blocking the next test.
   */
  dispose(): void {
    this.disposed = true;
    this.hooks.length = 0;
    this.faults.length = 0;
    this.wake();
  }

  /** Lists at most `entries` files per tree and reports the rest as truncated. */
  limitTrees(entries: number): this {
    this.treeLimit = entries;
    return this;
  }

  /** Answers the next `times` requests that match (`"PATCH /repos/ana/data/git/refs/heads/main"`) with `reply`. */
  failNext(match: RegExp, reply: MockReply, times = 1): this {
    this.faults.push({ match, times, value: reply });
    return this;
  }

  /** Runs `action` just before the next `times` matching requests are served (another device pushing, say). */
  before(match: RegExp, action: () => void | Promise<void>, times = 1): this {
    this.hooks.push({ match, times, value: action });
    return this;
  }

  // --- inspecting it ---------------------------------------------------------------------------

  /** The files of the branch head: path -> content. */
  files(fullName: string): Map<string, string> {
    const repo = this.repo(fullName);
    const head = repo.refs.get(`heads/${repo.defaultBranch}`);
    return head === undefined ? new Map<string, string>() : this.filesOf(repo, head);
  }

  /** Commits of the default branch, newest first. */
  history(fullName: string): MockCommit[] {
    const repo = this.repo(fullName);
    const out: MockCommit[] = [];
    let sha = repo.refs.get(`heads/${repo.defaultBranch}`);
    while (sha !== undefined) {
      const commit = repo.commits.get(sha);
      if (!commit) break;
      out.push({
        sha,
        parents: commit.parents,
        message: commit.message,
        files: this.filesOf(repo, sha),
      });
      sha = commit.parents[0];
    }
    return out;
  }

  head(fullName: string): string | undefined {
    const repo = this.repo(fullName);
    return repo.refs.get(`heads/${repo.defaultBranch}`);
  }

  /** Requests that changed something (everything but GET). */
  get writes(): MockRequest[] {
    return this.requests.filter((request) => request.method !== 'GET');
  }

  /** Another client pushes: sets (or with `null` deletes) files in a new commit on the default branch. */
  async push(
    fullName: string,
    changes: Record<string, string | null>,
    text = 'external',
  ): Promise<string> {
    const repo = this.repo(fullName);
    const files = new Map(this.files(fullName));
    for (const [path, content] of Object.entries(changes)) {
      if (content === null) files.delete(path);
      else files.set(path, content);
    }
    return this.commit(repo, files, text);
  }

  // --- the HTTP surface ------------------------------------------------------------------------

  readonly fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (this.offline || this.disposed) throw new TypeError('Failed to fetch');
    if (this.latency > 0) {
      await Promise.race([
        new Promise((resolve) => setTimeout(resolve, this.latency)),
        this.disposal,
      ]);
      if (this.disposed) throw new TypeError('Failed to fetch');
    }

    const request = new Request(input, init);
    const url = new URL(request.url);
    const method = request.method;
    const headers = [...request.headers.keys()];
    const bodyText = init?.body === undefined || init.body === null ? '' : await request.text();
    const body: unknown = bodyText === '' ? undefined : JSON.parse(bodyText);
    const entry: MockRequest = { method, path: url.pathname, status: 0, headers, body };
    this.requests.push(entry);

    if (url.origin !== API_ORIGIN)
      this.violations.push(`${method} ${url.origin}: not api.github.com`);
    for (const name of headers) {
      if (!ALLOWED_HEADERS.has(name))
        this.violations.push(`${method} ${url.pathname}: header "${name}"`);
    }

    const key = `${method} ${url.pathname}`;
    const hook = this.take(this.hooks, key);
    if (hook) {
      await Promise.race([hook(), this.disposal]);
      // The test ended while the request was held: it fails like one from a closed page.
      if (this.disposed) throw new TypeError('Failed to fetch');
    }

    const fault = this.take(this.faults, key);
    let response: Response;
    if (fault) {
      response = json(fault.status, fault.body ?? { message: 'Injected failure' }, fault.headers);
    } else {
      response = await this.route(method, url, request.headers.get('authorization'), body);
    }
    entry.status = response.status;
    return response;
  };

  // --- internals -------------------------------------------------------------------------------

  private take<T>(list: Array<Interception<T>>, key: string): T | undefined {
    const index = list.findIndex((item) => item.match.test(key));
    const item = list[index];
    if (!item) return undefined;
    item.times -= 1;
    if (item.times <= 0) list.splice(index, 1);
    return item.value;
  }

  private account(token: string): Account {
    const account = this.accounts.get(token);
    if (!account) throw new Error('Unknown test token');
    return account;
  }

  private repo(fullName: string): Repo {
    const repo = this.repos.get(fullName);
    if (!repo) throw new Error(`Unknown test repository ${fullName}`);
    return repo;
  }

  private filesOf(repo: Repo, commitSha: string): Map<string, string> {
    const tree = repo.trees.get(repo.commits.get(commitSha)?.tree ?? '');
    return new Map([...(tree ?? [])].map(([path, blob]) => [path, repo.blobs.get(blob) ?? '']));
  }

  private now(): string {
    this.clock += 60_000;
    return new Date(this.clock).toISOString();
  }

  private async blob(repo: Repo, content: string): Promise<string> {
    const sha = await objectId('blob', content);
    repo.blobs.set(sha, content);
    return sha;
  }

  private async tree(repo: Repo, entries: Map<string, string>): Promise<string> {
    const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : 1));
    const sha = await objectId('tree', JSON.stringify(sorted));
    repo.trees.set(sha, new Map(sorted));
    return sha;
  }

  /** Writes `files` as a commit on the default branch (creating the branch when there is none). */
  private async commit(repo: Repo, files: Map<string, string>, text: string): Promise<string> {
    const entries = new Map<string, string>();
    for (const [path, content] of files) entries.set(path, await this.blob(repo, content));
    const tree = await this.tree(repo, entries);
    const ref = `heads/${repo.defaultBranch}`;
    const parent = repo.refs.get(ref);
    const parents = parent === undefined ? [] : [parent];
    return this.createCommit(repo, tree, parents, text, ref);
  }

  private async createCommit(
    repo: Repo,
    tree: string,
    parents: string[],
    text: string,
    moveRef?: string,
  ): Promise<string> {
    const date = this.now();
    this.commitCounter += 1;
    const sha = await objectId(
      'commit',
      JSON.stringify({ tree, parents, text, date, n: this.commitCounter }),
    );
    repo.commits.set(sha, { tree, parents, message: text, date });
    if (moveRef !== undefined) repo.refs.set(moveRef, sha);
    return sha;
  }

  private isAncestor(repo: Repo, ancestor: string, of: string): boolean {
    const seen = new Set<string>();
    const queue = [of];
    while (queue.length > 0) {
      const sha = queue.pop() as string;
      if (sha === ancestor) return true;
      if (seen.has(sha)) continue;
      seen.add(sha);
      queue.push(...(repo.commits.get(sha)?.parents ?? []));
    }
    return false;
  }

  private async route(
    method: string,
    url: URL,
    authorization: string | null,
    body: unknown,
  ): Promise<Response> {
    const token = /^(?:Bearer|token) (.+)$/.exec(authorization ?? '')?.[1];
    const account = token === undefined ? undefined : this.accounts.get(token);
    if (!account || account.revoked) return message(401, 'Bad credentials');

    const path = url.pathname;
    if (method === 'GET' && path === '/user') return json(200, { login: account.login, id: 1 });

    const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    if (!match) return notFound();
    const fullName = `${match[1]}/${match[2]}`;
    const rest = match[3] ?? '';
    const repo = this.repos.get(fullName);
    const permission = account.access.get(fullName);
    if (!repo || permission === undefined) return notFound();

    if (method === 'GET' && rest === '') {
      return json(200, {
        full_name: `${repo.owner}/${repo.name}`,
        private: repo.private,
        archived: repo.archived,
        default_branch: repo.defaultBranch,
      });
    }

    const canRead = permission === 'read' || permission === 'write';
    if (!canRead) return forbidden();
    const isEmpty = repo.refs.size === 0;

    const ref = /^\/git\/ref\/(heads\/.+)$/.exec(rest);
    if (method === 'GET' && ref) {
      if (isEmpty) return empty();
      const sha = repo.refs.get(decodeURIComponent(ref[1] as string));
      return sha === undefined
        ? notFound()
        : json(200, { ref: `refs/${ref[1]}`, object: { type: 'commit', sha } });
    }

    const commit = /^\/git\/commits\/([0-9a-f]{40})$/.exec(rest);
    if (method === 'GET' && commit) {
      const found = repo.commits.get(commit[1] as string);
      return found
        ? json(200, { sha: commit[1], tree: { sha: found.tree }, committer: { date: found.date } })
        : notFound();
    }

    const tree = /^\/git\/trees\/([0-9a-f]{40})$/.exec(rest);
    if (method === 'GET' && tree) {
      const found = repo.trees.get(tree[1] as string);
      if (!found) return notFound();
      const entries = [...found].map(([entryPath, sha]) => ({
        path: entryPath,
        mode: '100644',
        type: 'blob',
        sha,
        size: encoder.encode(repo.blobs.get(sha) ?? '').length,
      }));
      return json(200, {
        sha: tree[1],
        tree: entries.slice(0, this.treeLimit),
        truncated: entries.length > this.treeLimit,
      });
    }

    const blob = /^\/git\/blobs\/([0-9a-f]{40})$/.exec(rest);
    if (method === 'GET' && blob) {
      const content = repo.blobs.get(blob[1] as string);
      if (content === undefined) return notFound();
      const bytes = encoder.encode(content);
      // GitHub wraps base64 at 60 characters.
      const base64 = btoa(String.fromCharCode(...bytes)).replace(/(.{60})/g, '$1\n');
      return json(200, { sha: blob[1], size: bytes.length, encoding: 'base64', content: base64 });
    }

    // Everything below writes.
    if (permission !== 'write') return forbidden();
    const input = (body ?? {}) as Record<string, unknown>;

    if (method === 'PUT' && rest.startsWith('/contents/'))
      return this.putContents(repo, rest, input);

    if (isEmpty) return empty();
    if (repo.archived) return message(403, 'Repository was archived so is read-only.');

    if (method === 'POST' && rest === '/git/blobs') {
      if (typeof input.content !== 'string') return message(422, 'Invalid request');
      const content = input.encoding === 'base64' ? atob(input.content) : input.content;
      return json(201, { sha: await this.blob(repo, content) });
    }

    if (method === 'POST' && rest === '/git/trees') {
      const base =
        typeof input.base_tree === 'string' ? repo.trees.get(input.base_tree) : undefined;
      if (input.base_tree !== undefined && !base)
        return message(422, 'base_tree is not a valid tree');
      const entries = new Map(base);
      for (const item of (input.tree ?? []) as Array<{
        path: string;
        mode: string;
        sha: string | null;
      }>) {
        if (item.sha === null) {
          if (!entries.delete(item.path))
            return message(422, `${item.path} does not exist in the tree`);
        } else if (!repo.blobs.has(item.sha) || item.mode !== '100644') {
          return message(422, `Tree entry ${item.path} is invalid`);
        } else entries.set(item.path, item.sha);
      }
      return json(201, { sha: await this.tree(repo, entries), truncated: false });
    }

    if (method === 'POST' && rest === '/git/commits') {
      const parents = (input.parents ?? []) as string[];
      if (typeof input.tree !== 'string' || !repo.trees.has(input.tree))
        return message(422, 'Tree does not exist');
      if (!parents.every((parent) => repo.commits.has(parent)))
        return message(422, 'Parent does not exist');
      const sha = await this.createCommit(repo, input.tree, parents, textOf(input.message));
      return json(201, { sha });
    }

    const update = /^\/git\/refs\/(heads\/.+)$/.exec(rest);
    if (method === 'PATCH' && update) {
      const name = decodeURIComponent(update[1] as string);
      const current = repo.refs.get(name);
      const target = textOf(input.sha);
      if (current === undefined) return message(422, 'Reference does not exist');
      if (!repo.commits.has(target)) return message(422, 'Object does not exist');
      if (input.force !== true && !this.isAncestor(repo, current, target)) {
        return message(422, 'Update is not a fast forward');
      }
      repo.refs.set(name, target);
      return json(200, { ref: `refs/${name}`, object: { type: 'commit', sha: target } });
    }

    return notFound();
  }

  private async putContents(
    repo: Repo,
    rest: string,
    input: Record<string, unknown>,
  ): Promise<Response> {
    const path = decodeURIComponent(rest.slice('/contents/'.length));
    if (typeof input.content !== 'string' || typeof input.message !== 'string') {
      return message(422, 'Invalid request');
    }
    const text = new TextDecoder().decode(
      Uint8Array.from(atob(input.content), (c) => c.charCodeAt(0)),
    );
    const head = repo.refs.get(`heads/${repo.defaultBranch}`);
    const files = head === undefined ? new Map<string, string>() : this.filesOf(repo, head);
    const existed = files.has(path);
    if (existed && typeof input.sha !== 'string') return message(422, '"sha" wasn\'t supplied.');
    files.set(path, text);
    const sha = await this.commit(repo, files, input.message);
    return json(existed ? 200 : 201, { content: { path }, commit: { sha } });
  }
}
