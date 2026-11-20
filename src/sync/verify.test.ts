import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeDevice, makeWorld, OWNER, REPO, seedSample, TOKEN, type MockGitHub } from './testing';
import { verifyConnection, type ConnectionCheck, type VerifyStep } from './verify';

let github: MockGitHub;

beforeEach(async () => {
  github = await makeWorld();
});
afterEach(() => {
  expect(github.violations).toEqual([]);
});

interface Outcome {
  check: ConnectionCheck | undefined;
  error: unknown;
  /** The checks that passed before it stopped. */
  steps: VerifyStep[];
}

const check = async (repo: string, token = TOKEN): Promise<Outcome> => {
  const steps: VerifyStep[] = [];
  const services = {
    fetch: github.fetch,
    isOnline: () => true,
    now: () => new Date('2026-11-20T12:00:00.000Z'),
  };
  try {
    const found = await verifyConnection({ token, repo }, services, (step) => steps.push(step));
    return { check: found, error: undefined, steps };
  } catch (error) {
    return { check: undefined, error, steps };
  }
};

describe('verifyConnection', () => {
  it('checks the token, the repository, that it is private, that it can be written, and what it holds', async () => {
    const { check: found, steps } = await check('ana/pretometru-data');

    expect(steps).toEqual(['token', 'repository', 'private', 'access', 'remote']);
    expect(found).toEqual({
      login: 'ana',
      owner: 'ana',
      repo: 'pretometru-data',
      defaultBranch: 'main',
      tokenKind: 'unknown',
      remote: {
        state: 'new',
        files: 0,
        bytes: 0,
        updatedAt: expect.any(String) as string,
        initialized: false,
      },
    });
  });

  it('proves the write permission without leaving a commit behind', async () => {
    await check('ana/pretometru-data');
    expect(github.writes.map((request) => `${request.method} ${request.path}`)).toEqual([
      'POST /repos/ana/pretometru-data/git/blobs',
    ]);
    expect(github.history('ana/pretometru-data')).toHaveLength(1);
  });

  it('tells a repository that already holds data, so that the first sync merges', async () => {
    const phone = await makeDevice(github, 'PHONE1');
    await seedSample(phone.db);
    await phone.sync();

    const { check: found } = await check('ana/pretometru-data');

    expect(found?.remote).toMatchObject({ state: 'data', initialized: false });
    expect(found?.remote.files).toBeGreaterThan(5);
    expect(found?.remote.bytes).toBeGreaterThan(1000);
  });

  it('initialises a repository without any commit, which is also the write test', async () => {
    github = await makeWorld({ readme: false });

    const { check: found } = await check('ana/pretometru-data');

    expect(found?.remote).toMatchObject({ state: 'new', initialized: true });
    expect(github.history('ana/pretometru-data').map((commit) => commit.message)).toEqual([
      'Inițializare depozit Pretometru',
    ]);
  });

  it.each([
    ['a bare name, which belongs to the token’s user', 'pretometru-data'],
    ['an address', 'https://github.com/ana/pretometru-data'],
  ])('accepts %s', async (_name, repo) => {
    const { check: found } = await check(repo);
    expect(found).toMatchObject({ owner: 'ana', repo: 'pretometru-data' });
  });

  it('stops at a token GitHub rejects', async () => {
    const { error, steps } = await check('ana/pretometru-data', 'a-token-nobody-issued');
    expect(error).toMatchObject({ code: 'BAD_TOKEN' });
    expect(steps).toEqual([]);
  });

  it('stops at a repository that does not exist or that the token does not include', async () => {
    const { error, steps } = await check('ana/nu-exista');
    expect(error).toMatchObject({ code: 'NO_ACCESS' });
    expect(steps).toEqual(['token']);
  });

  it('stops at a public repository, before anything is written', async () => {
    github.setPrivate('ana/pretometru-data', false);
    const { error, steps } = await check('ana/pretometru-data');
    expect(error).toMatchObject({ code: 'REPO_NOT_PRIVATE' });
    expect(steps).toEqual(['token', 'repository']);
    expect(github.writes).toEqual([]);
  });

  it('stops at an archived repository', async () => {
    github.setArchived('ana/pretometru-data', true);
    expect((await check('ana/pretometru-data')).error).toMatchObject({ code: 'REPO_ARCHIVED' });
  });

  it('stops at a token that may only read', async () => {
    github = await makeWorld({ permission: 'read' });
    const { error, steps } = await check('ana/pretometru-data');
    expect(error).toMatchObject({ code: 'NO_PERMISSION' });
    expect(steps).toEqual(['token', 'repository', 'private']);
  });

  it('stops at data a newer version of the app wrote', async () => {
    await github.push('ana/pretometru-data', {
      'data/pretometru.json': JSON.stringify({ format: 'pretometru-data', formatVersion: 9 }),
    });
    expect((await check('ana/pretometru-data')).error).toMatchObject({ code: 'REMOTE_NEWER' });
  });

  it.each([
    ['a repository name that is not one', 'a/b/c', 'ana/pretometru-data'],
    ['a token with spaces', 'ana/pretometru-data', 'two words'],
    ['an empty token', 'ana/pretometru-data', ' '],
  ])('rejects %s without a single request', async (_name, repo, token) => {
    const { error } = await check(repo, token);
    expect(error).toMatchObject({
      code: expect.stringMatching(/INVALID_REPO|BAD_TOKEN/) as string,
    });
    expect(github.requests).toEqual([]);
  });

  it('recognises a classic token, which reaches every repository of its owner', async () => {
    const classic = ['ghp', 'x'.repeat(8)].join('_');
    github.addToken(classic, OWNER, { [`${OWNER}/${REPO}`]: 'write' });
    expect((await check('ana/pretometru-data', classic)).check?.tokenKind).toBe('classic');
  });
});
