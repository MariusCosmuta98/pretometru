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
import Dexie, { type DBCore, type DBCoreTable, type Transaction } from 'dexie';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, expect } from 'vitest';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import { ensureSeed, type PretometruDB } from '@/storage';
import { testDb } from '@/storage/testing';
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

/**
 * Two switches to hunt for a test that counts on speed; both are off unless set:
 *   VITE_SYNC_TEST_LATENCY_MS=150     every request to the in-memory GitHub takes 150 ms longer
 *   VITE_SYNC_TEST_READ_DELAY_MS=20   every read of the database takes 20 ms longer
 * For example `VITE_SYNC_TEST_LATENCY_MS=150 npx vitest run src/features/sync`.
 */
const switchedOn = (name: 'VITE_SYNC_TEST_LATENCY_MS' | 'VITE_SYNC_TEST_READ_DELAY_MS'): number => {
  const raw: unknown = import.meta.env[name];
  const ms = typeof raw === 'string' ? Number(raw) : 0;
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
};

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

/** How much later every read of the database answers: 0 is untouched. */
interface ReadDelay {
  ms: number;
}

/**
 * Lets the reads of `db` be slowed down on demand (a Dexie middleware, so the application code is
 * the real one): the stored state then reaches a screen late, as it can on a busy device. Writes
 * are not slowed, so a change is stored at once and only read back late; neither are the reads
 * inside a transaction, which a delay would end early.
 */
function slowable(db: PretometruDB, delay: ReadDelay): PretometruDB {
  const later = <T,>(result: Promise<T>): Promise<T> => {
    // A read inside a transaction of the code's own cannot wait: the transaction would end under it.
    const current: Transaction | null = Dexie.currentTransaction;
    if (delay.ms <= 0 || current?.explicit === true) return result;
    return result.then(async (value) => {
      await new Promise((resolve) => setTimeout(resolve, delay.ms));
      return value;
    });
  };

  db.use({
    stack: 'dbcore',
    name: 'slow-reads',
    create: (down: DBCore) => ({
      table: (name: string): DBCoreTable => {
        const table = down.table(name);
        return {
          ...table,
          get: (request) => later(table.get(request)),
          getMany: (request) => later(table.getMany(request)),
          query: (request) => later(table.query(request)),
          count: (request) => later(table.count(request)),
          openCursor: (request) => later(table.openCursor(request)),
        };
      },
    }),
  });
  return db;
}

/** Call at the top of a test file: every test gets a fresh database and a fresh in-memory GitHub. */
export function syncHarness() {
  let db: PretometruDB | undefined;
  let github: MockGitHub | undefined;
  let overrides: Partial<SyncServices> = {};
  let delay: ReadDelay = { ms: 0 };

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

  /** A fresh in-memory GitHub, as slow as the switch says. */
  async function newWorld(options?: Parameters<typeof makeWorld>[0]): Promise<MockGitHub> {
    return (await makeWorld(options)).setLatency(switchedOn('VITE_SYNC_TEST_LATENCY_MS'));
  }

  beforeEach(async () => {
    overrides = {};
    delay = { ms: 0 };
    db = slowable(testDb(), delay);
    await db.open();
    await ensureSeed(db);
    delay.ms = switchedOn('VITE_SYNC_TEST_READ_DELAY_MS');
    github = await newWorld();
    install();
  });
  afterEach(async () => {
    // End the world first: a request a failed test left held fails now, so the sync it belongs to
    // ends and can neither block nor disturb the next test.
    github?.dispose();
    delay.ms = 0;
    await resetRunSync();
    cleanup();
    resetSyncServices();
    lockToken();
    resetSyncRuntime();
    await db?.delete();
    // Nothing the section sent may be something a browser would have blocked.
    expect(github?.violations ?? []).toEqual([]);
  });

  /** Opens the Settings screen and waits until the section has read the stored state. */
  async function renderSettings(): Promise<HTMLElement> {
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);
    await screen.findByRole('heading', { level: 2, name: SECTION });
    const section = screen.getByRole('region', { name: SECTION });
    await waitFor(() => expect(within(section).queryByText('Se încarcă…')).toBeNull());
    return section;
  }

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
      github = await newWorld(options);
      install();
    },
    /**
     * From now on every read of the database takes `ms` longer, so that the stored state reaches the
     * screen late, as it can on a busy device (0 ends it). A test that says what the screen shows
     * right after something happened can use it to check that the screen does not wait for the
     * database; one that waits for the database does not need it.
     */
    slowReads(ms: number) {
      delay.ms = ms;
    },

    renderSettings,
    /**
     * Closes the app and opens Settings again: nothing is left in memory (not the last sync, not an
     * unlocked token), so the section has only what was stored to go by.
     */
    async restart(): Promise<HTMLElement> {
      cleanup();
      lockToken();
      resetSyncRuntime();
      return renderSettings();
    },
  };
}

export const typeInto = (scope: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(scope).getByLabelText<HTMLInputElement>(label), { target: { value } });

export const press = (scope: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(scope).getByRole('button', { name }));
