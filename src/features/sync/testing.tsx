/**
 * Test-only harness for the Settings section: the whole app router at `/setari` over an in-memory
 * database and an in-memory GitHub (the section only ever reaches either through the sync
 * services). Never import this from application code.
 */
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
  resetSyncRuntime,
  resetSyncServices,
  setSyncServices,
  type SyncServices,
} from '@/sync';
import { makeWorld, type MockGitHub } from '@/sync/testing';

export const NOW = new Date('2026-11-20T12:00:00.000Z');
export const SECTION = 'Sincronizare GitHub';

// A sync is a chain of async steps (IndexedDB, SHA-1, the in-memory GitHub): give them room when
// several test files run at once on a small CI machine.
configure({ asyncUtilTimeout: 4000 });

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
  afterEach(() => {
    cleanup();
    resetSyncServices();
    lockToken();
    resetSyncRuntime();
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
