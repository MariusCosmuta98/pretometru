// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import { clearReviewSessions, ImportError, resetImportServices, setImportServices } from '@/import';
import {
  fakeCatalog,
  fakeEngines,
  fakeParser,
  pdfFile,
  pngFile,
  sampleReceipt,
  testIds,
  testNow,
  textFile,
  type FakeEngines,
} from '@/import/testing';
import { readSharedFiles, stashSharedFiles } from '@/pwa/share-target';
import { fakeCacheStorage } from '@/pwa/testing';
import { ensureSeed, listActive, type PretometruDB } from '@/storage';
import { createTestDb } from '@/storage/testing';

let db: PretometruDB;

// Load the screens once, outside the time budget of the first `findBy`.
beforeAll(() => import('./AddReceiptScreen'));

beforeEach(async () => {
  db = await createTestDb();
  await ensureSeed(db);
});

afterEach(() => {
  cleanup();
  resetImportServices();
  clearReviewSessions();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function install(options: { engines?: FakeEngines; parse?: ReturnType<typeof fakeParser> } = {}) {
  const parser = options.parse ?? fakeParser(sampleReceipt());
  const engines = options.engines ?? fakeEngines();
  setImportServices({
    getDb: () => Promise.resolve(db),
    parser,
    engines,
    catalog: fakeCatalog(),
    now: testNow,
    newId: testIds,
  });
  return { parser, engines };
}

async function renderAddScreen() {
  const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/adauga'] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { level: 2, name: 'Din fișier sau poză' });
  return router;
}

const pick = (label: string, files: File[]) => {
  fireEvent.change(screen.getByLabelText(label), { target: { files } });
};

describe('add receipt', () => {
  it('offers files, the camera, pasted text and manual entry', async () => {
    install();
    await renderAddScreen();

    const files = screen.getByLabelText<HTMLInputElement>('Alege fișiere');
    expect(files.type).toBe('file');
    expect(files.multiple).toBe(true);
    expect(files.accept).toContain('application/pdf');
    expect(files.accept).toContain('image/*');

    // On a phone the camera opens straight away.
    const camera = screen.getByLabelText<HTMLInputElement>('Fotografiază bonul');
    expect(camera.getAttribute('capture')).toBe('environment');
    expect(camera.accept).toBe('image/*');

    expect(screen.getByLabelText('Textul bonului')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Introdu bonul manual' }).getAttribute('href')).toBe(
      '/bonuri/nou',
    );
  });

  it('says what is wrong with a file that is not a receipt', async () => {
    install();
    await renderAddScreen();

    pick('Alege fișiere', [
      new File(['PK\u0003\u0004'], 'arhiva.zip', { type: 'application/zip' }),
    ]);

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('arhiva.zip:')).toBeTruthy();
    expect(
      within(alert).getByText(
        /Format nesuportat\. Alege un PDF, o imagine \(JPG, PNG\) sau un fișier text\./,
      ),
    ).toBeTruthy();
    expect(await listActive(db.receipts)).toEqual([]);
  });

  it('asks for text before reading pasted text', async () => {
    const { parser } = install();
    await renderAddScreen();

    fireEvent.click(screen.getByRole('button', { name: 'Citește textul' }));
    const message = await screen.findByText('Lipește mai întâi textul bonului.');
    expect(screen.getByLabelText('Textul bonului').getAttribute('aria-invalid')).toBe('true');
    expect(message.getAttribute('role')).toBe('alert');
    expect(parser.calls).toEqual([]);

    // Typing clears the complaint.
    fireEvent.change(screen.getByLabelText('Textul bonului'), { target: { value: 'KAUFLAND' } });
    expect(screen.queryByText('Lipește mai întâi textul bonului.')).toBeNull();
  });

  it('explains an engine that fails and one that is not available', async () => {
    const failing = fakeEngines(
      {},
      {
        extractPdfText: () => Promise.reject(new Error('boom')),
        recognizeImage: () => Promise.reject(new ImportError('ENGINE_UNAVAILABLE', 'not wired in')),
      },
    );
    install({ engines: failing });
    await renderAddScreen();

    pick('Alege fișiere', [pdfFile('stricat.pdf')]);
    expect(
      await screen.findByText(
        /Nu am putut citi documentul\. Încearcă din nou, cu o poză mai clară/,
      ),
    ).toBeTruthy();

    pick('Fotografiază bonul', [pngFile('poza.png')]);
    expect(
      await screen.findByText('Citirea acestui tip de document nu este disponibilă încă.'),
    ).toBeTruthy();
  });

  it('says that the engine is not on the device yet when a document cannot be read offline', async () => {
    const failing = fakeEngines(
      {},
      { extractPdfText: () => Promise.reject(new Error('Failed to fetch the worker')) },
    );
    install({ engines: failing });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await renderAddScreen();

    pick('Alege fișiere', [pdfFile('bon.pdf')]);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('motorul de citire nu a fost descărcat încă');
    expect(alert.textContent).toContain('Offline și stocare');
    expect(alert.textContent).not.toContain('poză mai clară');
  });

  it('tells the user when nothing in the text looks like a receipt', async () => {
    install({ parse: fakeParser(sampleReceipt({ lines: [] })) });
    await renderAddScreen();

    fireEvent.change(screen.getByLabelText('Textul bonului'), { target: { value: 'salut' } });
    fireEvent.click(screen.getByRole('button', { name: 'Citește textul' }));

    expect(await screen.findByText(/Nu am recunoscut niciun produs în bon/)).toBeTruthy();
    expect(await listActive(db.receipts)).toEqual([]);
  });

  it('shows progress while reading and stops when cancelled', async () => {
    const engines = fakeEngines(
      {},
      {
        recognizeImage: (_image, opts) =>
          new Promise((_resolve, reject) => {
            opts?.onProgress?.(0.4);
            opts?.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          }),
      },
    );
    install({ engines });
    await renderAddScreen();

    pick('Alege fișiere', [pngFile('lidl.png')]);

    const status = await screen.findByRole('status', { name: 'Se citește bonul…' });
    expect(await within(status).findByText(/Se extrage textul din bon… 40%/)).toBeTruthy();
    expect(within(status).getByRole<HTMLProgressElement>('progressbar').value).toBe(0.4);
    // Nothing can be started on top of a running import.
    expect(screen.getByLabelText<HTMLInputElement>('Alege fișiere').disabled).toBe(true);

    fireEvent.click(within(status).getByRole('button', { name: 'Anulează' }));

    expect(await screen.findByText('Citirea a fost anulată.')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Se citește bonul…' })).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Alege fișiere').disabled).toBe(false);
    expect(await listActive(db.receipts)).toEqual([]);
  });

  it('reads several files in turn and lists each result, so every receipt can be reviewed', async () => {
    install();
    const router = await renderAddScreen();

    pick('Alege fișiere', [
      pdfFile('a.pdf', 'first'),
      pdfFile('b.pdf', 'second'),
      new File(['PK'], 'c.zip', { type: 'application/zip' }),
      textFile('KAUFLAND\nLAPTE', 'd.txt'),
    ]);

    const results = await screen.findByRole('region', { name: 'Rezultat' });
    expect(within(results).getByRole('link', { name: 'Verifică „a.pdf”' })).toBeTruthy();
    expect(within(results).getByRole('link', { name: 'Verifică „b.pdf”' })).toBeTruthy();
    expect(within(results).getByRole('link', { name: 'Verifică „d.txt”' })).toBeTruthy();
    expect(within(results).getByText(/Format nesuportat/)).toBeTruthy();
    // The same receipt twice: the second one is flagged.
    expect(within(results).getAllByText(/pare un duplicat/).length).toBeGreaterThan(0);
    // The focus moves to the results once their commit has run its effects.
    await waitFor(() => {
      expect(document.activeElement).toBe(results);
    });
    // With several files the user stays here to pick which one to open.
    expect(router.state.location.pathname).toBe('/adauga');
    expect(await listActive(db.receipts)).toHaveLength(3);

    fireEvent.click(within(results).getByRole('link', { name: 'Verifică „b.pdf”' }));
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
  });

  it('goes straight to the review of a single file', async () => {
    install();
    const router = await renderAddScreen();

    pick('Alege fișiere', [pdfFile('singur.pdf')]);

    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
    await waitFor(() => {
      expect(screen.getByText(/Sursă: PDF „singur\.pdf”/)).toBeTruthy();
    });
  });
});

describe('add receipt: files shared from another app (Web Share Target)', () => {
  const scope = () => new URL(import.meta.env.BASE_URL, window.location.href).href;

  /** What the service worker leaves behind for `#/adauga?shared=<id>`. */
  async function share(id: string, files: File[]) {
    const caches = fakeCacheStorage();
    vi.stubGlobal('caches', caches);
    await stashSharedFiles(files, {
      caches,
      scope: scope(),
      now: () => Date.now(),
      newId: () => id,
    });
    return caches;
  }

  function renderShared(id: string) {
    const router = createMemoryRouter(buildRoutes(features), {
      initialEntries: [`/adauga?shared=${id}`],
    });
    // StrictMode runs every effect twice: the batch must still be read, and imported, once.
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
    return router;
  }

  it('reads a shared receipt at once and opens its review', async () => {
    const { engines } = install();
    const caches = await share('k1-aaaa', [pdfFile('distribuit.pdf')]);
    const router = renderShared('k1-aaaa');

    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
    expect(await listActive(db.receipts)).toHaveLength(1);
    expect(engines.calls.extractPdfText).toHaveLength(1);
    await waitFor(async () => {
      expect(await readSharedFiles('k1-aaaa', caches, scope())).toEqual([]);
    });
  });

  it('lists the results of several shared files and leaves the batch id out of the address', async () => {
    install();
    await share('k2-bbbb', [pdfFile('a.pdf', 'first'), pdfFile('b.pdf', 'second')]);
    const router = renderShared('k2-bbbb');

    const results = await screen.findByRole('region', { name: 'Rezultat' });
    expect(within(results).getByRole('link', { name: 'Verifică „a.pdf”' })).toBeTruthy();
    expect(within(results).getByRole('link', { name: 'Verifică „b.pdf”' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/adauga');
    expect(router.state.location.search).toBe('');
  });

  it('says so when the shared files are gone, and keeps the screen usable', async () => {
    install();
    vi.stubGlobal('caches', fakeCacheStorage());
    const router = renderShared('k3-cccc');

    expect(await screen.findByText(/Nu am primit niciun fișier prin „Distribuie”/)).toBeTruthy();
    expect(router.state.location.search).toBe('');
    expect(screen.getByLabelText('Alege fișiere')).toBeTruthy();
    expect(await listActive(db.receipts)).toEqual([]);
  });

  it('does nothing without a batch id', async () => {
    install();
    await renderAddScreen();
    expect(screen.queryByText(/Distribuie/)).toBeNull();
  });
});
