import { expect, test, type Page } from '@playwright/test';
import { cacheNames, openApp, visitFresh } from './support/app.ts';
import { pdfFromFixture, receiptPhoto } from './support/samples.ts';

const REVIEW = (page: Page) => page.getByRole('heading', { level: 2, name: 'Detalii bon' });

/** Paths (below the base) of the files each engine cache holds. */
async function storedEngineFiles(page: Page): Promise<Record<string, string[]>> {
  return page.evaluate(async () => {
    const stored: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      if (!name.startsWith('pretometru-engine-')) continue;
      const keys = await (await caches.open(name)).keys();
      stored[name.replace(/^pretometru-engine-/, '').replace(/-[0-9a-f]{8}$/, '')] = keys.map(
        (request) => new URL(request.url).pathname.replace(/^\/pretometru\//, ''),
      );
    }
    return stored;
  });
}

async function importPdf(page: Page, name: string) {
  await page.getByLabel('Alege fișiere').setInputFiles({
    name,
    mimeType: 'application/pdf',
    buffer: pdfFromFixture(),
  });
  await expect(REVIEW(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('heading', { level: 2, name: /^Produse \(\d+\)$/ })).toBeVisible();
}

/**
 * Reads a photo of a receipt (the Lidl screenshot of the fixtures, drawn on a canvas) with the OCR
 * engine and waits for the review of the draft: Tesseract.js reads it, the Lidl parser recognises it.
 */
async function importPhoto(page: Page, name: string) {
  await page.getByLabel('Fotografiază bonul').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: await receiptPhoto(page),
  });
  await expect(REVIEW(page)).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole('heading', { level: 2, name: /^Produse \(\d+\)$/ })).toBeVisible();
}

test.describe('importing offline', () => {
  test('a PDF and a photo import offline once their engines have been used', async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);

    // First use, online: pdf.js and the OCR engine are fetched and stored by the service worker.
    await openApp(page, 'adauga');
    await importPdf(page, 'kaufland.pdf');
    await visitFresh(page, 'adauga');
    await importPhoto(page, 'lidl.png');

    const stored = await storedEngineFiles(page);
    expect(stored.pdf?.map((path) => path.replace(/-[\w-]+\.mjs$/, '.mjs'))).toEqual([
      'assets/pdf.worker.min.mjs',
    ]);
    expect(stored.ocr).toEqual(
      expect.arrayContaining([
        'ocr/worker.min.js',
        'ocr/lang/ron.traineddata.gz',
        'ocr/lang/eng.traineddata.gz',
      ]),
    );
    // One WASM core of the three: the one this browser picked.
    expect(stored.ocr?.filter((path) => path.startsWith('ocr/core/'))).toHaveLength(1);

    // No connection: the same imports, from the worker's caches.
    await context.setOffline(true);
    await visitFresh(page, 'adauga');
    await importPdf(page, 'kaufland-offline.pdf');
    await visitFresh(page, 'adauga');
    await importPhoto(page, 'lidl-offline.png');
  });

  test('"Descarcă acum" in Settings makes both imports work offline, with no earlier use of either', async ({
    page,
    context,
  }) => {
    test.setTimeout(420_000);
    await openApp(page, 'setari');
    const section = page.getByRole('region', { name: 'Offline și stocare' });
    await expect(section.getByText('Citire PDF:')).toBeVisible();
    await expect(section.getByText('gata fără internet')).toHaveCount(0);
    expect(await storedEngineFiles(page)).toEqual({});

    await section.getByRole('button', { name: /^Descarcă acum \(\d/ }).click();

    await expect(section.getByText(/poți citi PDF-uri și poze și fără internet/)).toBeVisible({
      timeout: 120_000,
    });
    await expect(section.getByText(/gata fără internet/)).toHaveCount(2);
    await expect(section.getByRole('button', { name: /Descarcă acum/ })).toHaveCount(0);

    // Every variant of the OCR core is there, not only the one this browser would use.
    const stored = await storedEngineFiles(page);
    expect(stored.ocr?.filter((path) => path.startsWith('ocr/core/'))).toHaveLength(3);
    expect(stored.ocr).toHaveLength(6);
    expect(stored.pdf).toHaveLength(1);

    await context.setOffline(true);
    await visitFresh(page, 'adauga');
    await importPdf(page, 'kaufland.pdf');
    await visitFresh(page, 'adauga');
    await importPhoto(page, 'lidl.png');
  });

  test('without the engines, an offline import fails with a reason the user can act on', async ({
    page,
    context,
  }) => {
    await openApp(page, 'adauga');
    await context.setOffline(true);
    await visitFresh(page, 'adauga');

    await page.getByLabel('Alege fișiere').setInputFiles({
      name: 'kaufland.pdf',
      mimeType: 'application/pdf',
      buffer: pdfFromFixture(),
    });

    await expect(page.getByRole('alert')).toContainText('motoarele de citire');
    await expect(page.getByRole('alert')).toContainText('Offline și stocare');
    expect(await cacheNames(page)).not.toContainEqual(expect.stringMatching(/^pretometru-engine-/));
  });
});
