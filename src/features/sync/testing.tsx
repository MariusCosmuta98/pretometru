/**
 * Test-only harness for the Settings section: the whole app router at `/setari` over an in-memory
 * database and an in-memory GitHub (the section only ever reaches either through the sync
 * services). Never import this from application code.
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor as waitForDefault,
  within as withinDefault,
  type BoundFunctions,
  type ByRoleMatcher,
  type ByRoleOptions,
  type Matcher,
  type queries,
  type SelectorMatcherOptions,
  type waitForOptions,
} from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, expect } from 'vitest';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import { ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';
import {
  lockToken,
  resetRunSync,
  resetSyncRuntime,
  resetSyncServices,
  setSyncServices,
  type SyncServices,
} from '@/sync';
import { makeWorld, type MockGitHub } from '@/sync/testing';

export const NOW = new Date('2026-11-20T12:00:00.000Z');
export const SECTION = 'Sincronizare GitHub';

/**
 * How long the section may take to show the result of a sync or of a stored change: a chain of
 * async steps (IndexedDB, SHA-1, the in-memory GitHub, a live query, a render) that a busy CI
 * machine can stretch. Given to every wait that depends on one, so that no test relies on the
 * Testing Library default, or on a global setting somebody else may change.
 */
export const WAIT = { timeout: 15_000 };

type Queries = BoundFunctions<typeof queries>;

/** Testing Library's `waitFor`, with `WAIT` unless the call says otherwise. */
export const waitFor: typeof waitForDefault = (callback, options) =>
  waitForDefault(callback, { ...WAIT, ...options });

/** Testing Library's `within`, whose `findBy…` queries wait for `WAIT` unless the call says otherwise. */
export function within(element: HTMLElement): Queries {
  const found = withinDefault(element);
  return {
    ...found,
    findByText: (text: Matcher, options?: SelectorMatcherOptions, waitOptions?: waitForOptions) =>
      found.findByText(text, options, { ...WAIT, ...waitOptions }),
    findByRole: (role: ByRoleMatcher, options?: ByRoleOptions, waitOptions?: waitForOptions) =>
      found.findByRole(role, options, { ...WAIT, ...waitOptions }),
    findByLabelText: (
      text: Matcher,
      options?: SelectorMatcherOptions,
      waitOptions?: waitForOptions,
    ) => found.findByLabelText(text, options, { ...WAIT, ...waitOptions }),
  } as Queries;
}

const present = <T,>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`${what} is not ready yet`);
  return value;
};

/** Call at the top of a test file: every test gets a fresh database and a fresh in-memory GitHub. */
export function syncHarness() {
  let db: PretometruDB | undefined;
  let github: MockGitHub | undefined;
  let overrides: Partial<SyncServices> = {};

  function install(more: Partial<SyncServices> = {}) {
    overrides = { ...overrides, ...more };
    setSyncServices({
      getDb: () => Promise.resolve(present(db, 'the database')),
      fetch: present(github, 'GitHub').fetch,
      now: () => NOW,
      sleep: () => Promise.resolve(),
      newDeviceId: () => 'DEV001',
      passphraseIterations: 1000,
      ...overrides,
    });
  }

  beforeEach(async () => {
    overrides = {};
    db = await createTestDb();
    await ensureSeed(db);
    github = await makeWorld();
    install();
  });
  afterEach(async () => {
    // End the world first: a request a failed test left held fails now, so the sync it belongs to
    // ends and can neither block nor disturb the next test.
    github?.dispose();
    await resetRunSync();
    cleanup();
    resetSyncServices();
    lockToken();
    resetSyncRuntime();
    await db?.delete();
    // Nothing the section sent may be something a browser would have blocked.
    expect(github?.violations ?? []).toEqual([]);
  });

  return {
    get db(): PretometruDB {
      return present(db, 'the database');
    },
    get github(): MockGitHub {
      return present(github, 'GitHub');
    },
    /** Replaces the sync services (offline, a slower clock, ...) for the rest of the test. */
    install,
    /** Starts the test over with a different world (a read-only token, a public repository). */
    async world(options: Parameters<typeof makeWorld>[0]) {
      github = await makeWorld(options);
      install();
    },

    /** Opens the Settings screen and waits until the section has read the stored state. */
    async renderSettings(): Promise<HTMLElement> {
      const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
      render(<RouterProvider router={router} />);
      await screen.findByRole('heading', { level: 2, name: SECTION });
      const section = screen.getByRole('region', { name: SECTION });
      await waitFor(() => expect(within(section).queryByText('Se încarcă…')).toBeNull());
      return section;
    },
  };
}

export const typeInto = (scope: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(scope).getByLabelText<HTMLInputElement>(label), { target: { value } });

export const press = (scope: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(scope).getByRole('button', { name }));
