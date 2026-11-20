/**
 * Test-only harness for the screens of this feature: the whole app router over an in-memory
 * database, a parser that answers with a fixture's ground truth, and small DOM helpers.
 * Never import this from application code.
 */
import { getFixture, sourceOf } from '@fixtures';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import type { ParsedReceipt } from '@/domain';
import { clearReviewSessions, resetImportServices, setImportServices } from '@/import';
import {
  fakeCatalog,
  fakeEngines,
  fakeParser,
  pdfFile,
  pngFile,
  testIds,
  type FakeCatalog,
  type FakeEngines,
} from '@/import/testing';
import { ensureSeed, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';

export type AppRouter = ReturnType<typeof createMemoryRouter>;

export interface InstallOptions {
  kind?: 'pdf-text' | 'ocr-text' | 'pasted-text';
  /** What the parser answers, when it should differ from the fixture's ground truth. */
  receipt?: (expected: ParsedReceipt) => ParsedReceipt;
  catalog?: FakeCatalog;
}

export interface Installed {
  expected: ParsedReceipt;
  catalog: FakeCatalog;
  engines: FakeEngines;
}

/**
 * Evaluates the lazy route modules of the given features once. The first test of a file would
 * otherwise pay for loading its screens inside a `findBy` time budget, which a busy machine can
 * exhaust.
 */
export async function warmRoutes(...featureIds: string[]): Promise<void> {
  const routes = features
    .filter((feature) => featureIds.includes(feature.id))
    .flatMap((feature) => feature.routes);
  await Promise.all(
    routes.flatMap((route) => (typeof route.lazy === 'function' ? [route.lazy()] : [])),
  );
}

/**
 * Call at the top of a test file: gives every test a fresh seeded database and resets the import
 * services afterwards.
 */
export function appHarness() {
  let db: PretometruDB | undefined;

  beforeAll(() => warmRoutes('add-receipt', 'receipts'));
  beforeEach(async () => {
    db = await createTestDb();
    await ensureSeed(db);
  });
  afterEach(() => {
    cleanup();
    resetImportServices();
    clearReviewSessions();
    vi.restoreAllMocks();
  });

  const current = (): PretometruDB => {
    if (!db) throw new Error('The test database is not open yet');
    return db;
  };

  return {
    get db() {
      return current();
    },

    /** Wires the app to the test database and a parser that answers with a fixture's ground truth. */
    install(fixtureId: string, options: InstallOptions = {}): Installed {
      const fixture = getFixture(fixtureId);
      const { source, expected } = sourceOf(fixture, options.kind ?? 'pdf-text');
      const catalog = options.catalog ?? fakeCatalog();
      const engines = fakeEngines(
        source.kind === 'pdf-text'
          ? { pdf: source }
          : source.kind === 'ocr-text'
            ? { image: source }
            : {},
      );
      const database = current();
      setImportServices({
        getDb: () => Promise.resolve(database),
        parser: fakeParser(options.receipt ? options.receipt(expected) : expected),
        engines,
        catalog,
        now: () => new Date(fixture.now),
        newId: testIds,
      });
      return { expected, catalog, engines };
    },

    renderApp(path: string): AppRouter {
      const router = createMemoryRouter(buildRoutes(features), { initialEntries: [path] });
      render(<RouterProvider router={router} />);
      return router;
    },
  };
}

export const field = (name: string) =>
  screen.getByLabelText<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(name);

export function change(name: string, value: string) {
  fireEvent.change(field(name), { target: { value } });
}

export function click(name: string | RegExp, role: 'button' | 'link' = 'button') {
  fireEvent.click(screen.getByRole(role, { name }));
}

/** Focus follows a commit by an effect, so wait for it instead of asserting right after a `findBy`. */
export async function expectFocus(element: HTMLElement) {
  await waitFor(() => {
    expect(document.activeElement).toBe(element);
  });
}

export async function goTo(router: AppRouter, path: string) {
  await act(() => router.navigate(path));
}

/** Picks a PDF on the "add receipt" screen and waits for the review of the saved draft. */
export async function importPdf(router: AppRouter, name = 'bon.pdf', body = 'one') {
  await goTo(router, '/adauga');
  fireEvent.change(screen.getByLabelText('Alege fișiere'), {
    target: { files: [pdfFile(name, body)] },
  });
  await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
}

/** Picks a photo on the "add receipt" screen and waits for the review of the saved draft. */
export async function importPhoto(router: AppRouter, name = 'bon.png', body = 'photo') {
  await goTo(router, '/adauga');
  fireEvent.change(screen.getByLabelText('Alege fișiere'), {
    target: { files: [pngFile(name, body)] },
  });
  await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
}

/** The review's line number for a printed name: the position of that line on screen. */
export function lineNumber(expected: ParsedReceipt, rawName: string): number {
  const index = expected.lines.findIndex((line) => line.rawName === rawName);
  if (index < 0) throw new Error(`No line ${rawName}`);
  return index + 1;
}
