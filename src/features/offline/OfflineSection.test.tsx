// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import type { EngineStatus, OfflineReadiness, PrepareProgress, StorageEnv } from '@/pwa';
import { OfflineEnvContext, type OfflineEnv } from './hooks';
import OfflineSection from './OfflineSection';

afterEach(cleanup);

const MB = 1024 * 1024;
const NOTHING: EngineStatus[] = [
  { id: 'pdf', files: 1, cached: 0, bytes: 1.2 * MB, cachedBytes: 0 },
  { id: 'ocr', files: 6, cached: 0, bytes: 16.5 * MB, cachedBytes: 0 },
];
const EVERYTHING: EngineStatus[] = NOTHING.map((engine) => ({
  ...engine,
  cached: engine.files,
  cachedBytes: engine.bytes,
}));

interface Options {
  readiness?: OfflineReadiness;
  /** `null`: no service worker to ask. */
  engines?: EngineStatus[] | null;
  persisted?: boolean;
  /** What `persist()` answers; the browser's `persisted()` follows it. */
  grant?: boolean;
  persistSupported?: boolean;
}

function setup({
  readiness = 'ready',
  engines = NOTHING,
  persisted = false,
  grant = true,
  persistSupported = true,
}: Options = {}) {
  let stored = engines;
  let isPersisted = persisted;
  const prepare =
    vi.fn<(onProgress?: (progress: PrepareProgress) => void) => Promise<EngineStatus[]>>();
  const persist = vi.fn(() => {
    isPersisted = grant;
    return Promise.resolve(grant);
  });
  const storage: StorageEnv = {
    storage: persistSupported
      ? {
          persisted: () => Promise.resolve(isPersisted),
          persist,
          estimate: () => Promise.resolve({ usage: 2.5 * MB, quota: 80 * 1024 * MB }),
        }
      : undefined,
    memory: undefined,
    installed: () => false,
    now: () => new Date('2026-11-20T10:00:00.000Z'),
  };
  const env: OfflineEnv = {
    storage,
    engines: {
      status: () => Promise.resolve(stored ?? undefined),
      prepare: async (onProgress) => {
        const done = await prepare(onProgress);
        stored = done;
        return done;
      },
    },
    readiness: () => Promise.resolve(readiness),
  };
  render(
    <OfflineEnvContext value={env}>
      <OfflineSection />
    </OfflineEnvContext>,
  );
  return { prepare, persist };
}

describe('offline readiness', () => {
  it.each<[OfflineReadiness, RegExp]>([
    ['ready', /pornește și funcționează și fără internet/],
    ['pending', /Închide și redeschide aplicația o dată/],
    ['unregistered', /doar în versiunea publicată/],
    ['unsupported', /Acest browser nu permite folosirea aplicației fără internet/],
  ])('says what %s means', async (readiness, text) => {
    setup({ readiness });
    expect(await screen.findByText(text)).toBeTruthy();
  });
});

describe('engines', () => {
  it('shows what each engine needs and what downloading everything costs', async () => {
    setup();

    expect(await screen.findByText(/Citire PDF:/)).toBeTruthy();
    expect(screen.getByText(/se descarcă la prima folosire \(1,2 MB\)/)).toBeTruthy();
    expect(screen.getByText(/Citire din poze \(OCR\):/)).toBeTruthy();
    expect(screen.getByText(/se descarcă la prima folosire \(16,5 MB\)/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descarcă acum (17,7 MB)' })).toBeTruthy();
  });

  it('downloads them on request, shows the progress and then that everything is ready', async () => {
    const { prepare } = setup();
    let finish: (engines: EngineStatus[]) => void = () => undefined;
    prepare.mockImplementation(
      (onProgress) =>
        new Promise((resolve) => {
          onProgress?.({ doneFiles: 3, totalFiles: 7, doneBytes: 9 * MB, totalBytes: 18 * MB });
          finish = resolve;
        }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Descarcă acum/ }));

    const status = await screen.findByRole('status');
    expect(within(status).getByText(/Se descarcă… 3 din 7 fișiere/)).toBeTruthy();
    expect(within(status).getByRole<HTMLProgressElement>('progressbar').value).toBe(0.5);
    expect(screen.queryByRole('button', { name: /Descarcă acum/ })).toBeNull();

    finish(EVERYTHING);

    expect(await screen.findByText(/poți citi PDF-uri și poze și fără internet/)).toBeTruthy();
    expect(screen.getAllByText(/gata fără internet/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /Descarcă acum/ })).toBeNull();
  });

  it('offers only what is still missing when part of it is stored', async () => {
    setup({
      engines: [
        { id: 'pdf', files: 1, cached: 1, bytes: 1 * MB, cachedBytes: 1 * MB },
        { id: 'ocr', files: 6, cached: 2, bytes: 16 * MB, cachedBytes: 6 * MB },
      ],
    });

    expect(await screen.findByText(/parțial: 2 din 6 fișiere/)).toBeTruthy();
    expect(screen.getByText(/gata fără internet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Descarcă acum (10 MB)' })).toBeTruthy();
  });

  it('keeps the button and says what to do when the download stops', async () => {
    const { prepare } = setup();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    prepare.mockRejectedValue(new Error('ocr/worker.min.js: HTTP 503'));

    fireEvent.click(await screen.findByRole('button', { name: /Descarcă acum/ }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Descărcarea s-a oprit');
    expect(screen.getByRole('button', { name: /Descarcă acum/ })).toBeTruthy();
  });

  it('explains why nothing can be prepared without a service worker', async () => {
    setup({ readiness: 'pending', engines: null });
    expect(await screen.findByText(/nu poate fi pregătită acum/)).toBeTruthy();
    expect(screen.getAllByText(/Închide și redeschide aplicația o dată/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Descarcă acum/ })).toBeNull();
  });
});

describe('storage', () => {
  it('shows that the storage is not persistent yet, with the usage, and lets the user ask', async () => {
    const { persist } = setup({ persisted: false });

    expect(await screen.findByText('neactivă')).toBeTruthy();
    expect(screen.getByText('2,5 MB din 80 GB')).toBeTruthy();
    expect(screen.getByText('nu')).toBeTruthy(); // not installed

    fireEvent.click(screen.getByRole('button', { name: 'Cere stocare persistentă' }));

    expect(await screen.findByText(/Browserul a acceptat/)).toBeTruthy();
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('activă')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cere stocare persistentă' })).toBeNull();
  });

  it('keeps the button when the browser refuses, and says how to improve the odds', async () => {
    setup({ persisted: false, grant: false });

    fireEvent.click(await screen.findByRole('button', { name: 'Cere stocare persistentă' }));

    expect(await screen.findByText(/Browserul nu a acceptat acum/)).toBeTruthy();
    expect(screen.getByText(/Instalează aplicația pe ecranul principal/)).toBeTruthy();
    expect(screen.getByText('neactivă')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cere stocare persistentă' })).toBeTruthy();
  });

  it('shows an already persistent storage without offering to ask', async () => {
    setup({ persisted: true });
    expect(await screen.findByText('activă')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cere stocare persistentă' })).toBeNull();
  });

  it('says so in a browser without persistent storage', async () => {
    setup({ persistSupported: false });
    expect(await screen.findByText('indisponibilă în acest browser')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cere stocare persistentă' })).toBeNull();
  });

  it('points at a copy outside the browser', async () => {
    setup();
    expect(await screen.findByText(/nu ține loc de o copie de siguranță/)).toBeTruthy();
    expect(screen.getByText(/„Sincronizare GitHub”/)).toBeTruthy();
  });
});

describe('Settings screen', () => {
  it('has the section, which works in a browser without service workers', async () => {
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole('heading', { level: 2, name: 'Offline și stocare' });
    const section = heading.closest('section');
    expect(section).not.toBeNull();
    expect(
      await within(section as HTMLElement).findByText(
        'Acest browser nu permite folosirea aplicației fără internet.',
      ),
    ).toBeTruthy();
    await waitFor(() => {
      expect(within(section as HTMLElement).getByText('Stocarea datelor')).toBeTruthy();
    });
  });
});
