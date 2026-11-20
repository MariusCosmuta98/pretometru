import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitHubClient, isValidRepoRef, parseRepoRef, tokenKind } from './github';
import { makeWorld, OWNER, REPO, TOKEN, type MockGitHub } from './testing';

describe('repository names', () => {
  it.each([
    ['ana/pretometru-data', 'ana', 'pretometru-data'],
    ['  ana/pretometru-data  ', 'ana', 'pretometru-data'],
    ['https://github.com/ana/pretometru-data', 'ana', 'pretometru-data'],
    ['https://github.com/ana/pretometru-data.git', 'ana', 'pretometru-data'],
    ['github.com/ana/pretometru-data/', 'ana', 'pretometru-data'],
    ['ana/data.v2_x', 'ana', 'data.v2_x'],
  ])('reads %j', (input, owner, repo) => {
    expect(parseRepoRef(input)).toEqual({ owner, repo });
  });

  it.each([
    '',
    'ana',
    'ana/',
    '/pretometru-data',
    'ana/b/c',
    'ana/..',
    'ana/.',
    'ana/re po',
    'an a/repo',
    '-ana/repo',
    `${'a'.repeat(40)}/repo`,
    'ana/<script>',
  ])('refuses %j', (input) => {
    expect(parseRepoRef(input)).toBeUndefined();
  });

  it('is what keeps a name from changing the address it is put into', () => {
    expect(isValidRepoRef('ana', '..')).toBe(false);
    expect(isValidRepoRef('ana', 'a/../b')).toBe(false);
    expect(() => createGitHubClient({ token: TOKEN, fetch }).repo('ana', '..')).toThrow(
      expect.objectContaining({ code: 'INVALID_REPO' }),
    );
  });
});

describe('tokenKind', () => {
  it('tells the fine-grained token the app recommends from the classic one', () => {
    expect(tokenKind(`github_pat_${'x'.repeat(20)}`)).toBe('fine-grained');
    expect(tokenKind(['ghp', 'x'.repeat(8)].join('_'))).toBe('classic');
    expect(tokenKind(TOKEN)).toBe('unknown');
  });
});

describe('the client, against an in-memory GitHub', () => {
  let github: MockGitHub;

  beforeEach(async () => {
    github = await makeWorld();
  });
  afterEach(() => {
    expect(github.violations).toEqual([]);
  });

  const clientFor = (overrides: Partial<Parameters<typeof createGitHubClient>[0]> = {}) =>
    createGitHubClient({
      token: TOKEN,
      fetch: github.fetch,
      now: () => new Date('2026-11-20T12:00:00.000Z'),
      ...overrides,
    });

  it('sends only the headers api.github.com lets a browser use, and never takes a cached answer', async () => {
    const inits: Array<RequestInit | undefined> = [];
    const client = clientFor({
      fetch: (input, init) => {
        inits.push(init);
        return github.fetch(input, init);
      },
    });
    const repo = client.repo(OWNER, REPO);

    await client.getUser();
    await repo.get();
    await repo.createBlob('content');

    expect(github.requests).toHaveLength(3);
    for (const request of github.requests) {
      const allowed = ['authorization', 'accept', 'content-type'];
      expect(request.headers.every((name) => allowed.includes(name))).toBe(true);
    }
    expect(github.requests[0]?.headers).not.toContain('content-type');
    expect(github.requests[2]?.headers).toContain('content-type');
    expect(inits.every((init) => init?.cache === 'no-store')).toBe(true);
  });

  it('reads a file back exactly, with diacritics and past the base64 line length', async () => {
    const repo = clientFor().repo(OWNER, REPO);
    const text = 'Cafea măcinată, 250 g — preț 20,00 lei\n'.repeat(8);

    expect(await repo.getBlob(await repo.createBlob(text))).toBe(text);
  });

  it('never puts the token into an error', async () => {
    const error = await clientFor({ token: `${TOKEN}-revoked` })
      .getUser()
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'BAD_TOKEN' });
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
  });

  it('refuses an object id that is not one, instead of putting it into an address', async () => {
    const repo = clientFor().repo(OWNER, REPO);
    await expect(repo.getBlob('../../../user')).rejects.toMatchObject({ code: 'UNEXPECTED' });
    expect(github.requests).toEqual([]);
  });

  it('tells a network failure from a cancelled request', async () => {
    const failing = (error: Error) => clientFor({ fetch: () => Promise.reject(error) });

    await expect(failing(new TypeError('Failed to fetch')).getUser()).rejects.toMatchObject({
      code: 'NETWORK',
    });
    await expect(
      failing(new DOMException('Aborted', 'AbortError')).getUser(),
    ).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it('survives a body that is not JSON (an HTML error page from a proxy)', async () => {
    const html = () => Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(clientFor({ fetch: html }).getUser()).rejects.toMatchObject({
      code: 'SERVER',
      status: 502,
    });
  });

  it('reports an answer that is not what the API documents', async () => {
    github.failNext(/GET \/user/, { status: 200, body: { unexpected: true } });
    await expect(clientFor().getUser()).rejects.toMatchObject({ code: 'UNEXPECTED' });
  });

  it('reports an unknown repository as one the token cannot use', async () => {
    await expect(clientFor().repo(OWNER, 'nu-exista').get()).rejects.toMatchObject({
      code: 'NO_ACCESS',
      status: 404,
    });
  });
});
