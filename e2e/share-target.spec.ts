import { expect, test, type Page } from '@playwright/test';
import { BASE, openApp, visitFresh } from './support/app.ts';
import { pdfFromFixture } from './support/samples.ts';

/**
 * What the Android share sheet does with an installed PWA that declares a `share_target`: a multipart
 * POST of the shared files to the manifest's action, as a navigation. The browser can not be made to
 * show a share sheet, so the page submits the same request itself; from there on everything is real:
 * the service worker answers it, the app opens on the add-receipt screen and reads the files.
 */
async function share(page: Page, files: Array<{ name: string; mimeType: string; buffer: Buffer }>) {
  await page.evaluate(
    ({ action }) => {
      const form = document.createElement('form');
      form.id = 'e2e-share';
      form.method = 'POST';
      form.enctype = 'multipart/form-data';
      form.action = action;
      const input = document.createElement('input');
      input.type = 'file';
      input.name = 'files';
      input.multiple = true;
      form.append(input);
      document.body.append(form);
    },
    { action: `${BASE}share-target` },
  );
  await page.locator('#e2e-share input[name=files]').setInputFiles(files);
  await page.locator('#e2e-share').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });
}

const REVIEW = (page: Page) => page.getByRole('heading', { level: 2, name: 'Detalii bon' });

test.describe('Web Share Target', () => {
  test('the manifest is valid and offers the app for PDFs and images', async ({
    page,
    context,
  }) => {
    await openApp(page);
    const client = await context.newCDPSession(page);
    const { errors, data } = await client.send('Page.getAppManifest');
    const { installabilityErrors } = await client.send('Page.getInstallabilityErrors');
    const manifest = JSON.parse(data ?? '{}') as {
      name: string;
      short_name: string;
      scope: string;
      start_url: string;
      display: string;
      share_target: unknown;
    };

    expect(errors, 'what Chrome says about the manifest').toEqual([]);
    expect(installabilityErrors, 'what Chrome says about installability').toEqual([]);
    expect(manifest.name).toBe('Pretometru');
    expect(manifest.short_name).toBe('Pretometru');
    expect(manifest.display).toBe('standalone');
    expect(manifest.share_target).toEqual({
      action: `${BASE}share-target`,
      method: 'POST',
      enctype: 'multipart/form-data',
      params: { files: [{ name: 'files', accept: ['application/pdf', 'image/*'] }] },
    });
    // Chrome only registers an action that lies inside the app's scope.
    expect(`${BASE}share-target`.startsWith(manifest.scope)).toBe(true);
    expect(manifest.start_url).toBe(BASE);
  });

  test('a shared PDF is imported at once and opens its review', async ({ page }) => {
    await openApp(page, 'adauga');

    await share(page, [
      { name: 'distribuit.pdf', mimeType: 'application/pdf', buffer: pdfFromFixture() },
    ]);

    await expect(REVIEW(page)).toBeVisible({ timeout: 60_000 });
    await expect(page).toHaveURL(/#\/bonuri\/[0-9A-Z]{26}$/);
    await expect(page.getByText(/Sursă: PDF „distribuit\.pdf”/)).toBeVisible();
    // The shared copy is gone once it was picked up.
    const left = await page.evaluate(async () => {
      const cache = await caches.open('pretometru-share-v1');
      return (await cache.keys()).length;
    });
    expect(left).toBe(0);
  });

  test('sharing works without a connection, as the whole import does once the engine was used', async ({
    page,
    context,
  }) => {
    await openApp(page, 'adauga');
    // The engine's first use, online.
    await page.getByLabel('Alege fișiere').setInputFiles({
      name: 'primul.pdf',
      mimeType: 'application/pdf',
      buffer: pdfFromFixture(),
    });
    await expect(REVIEW(page)).toBeVisible({ timeout: 60_000 });
    await page.goto('about:blank');
    await openApp(page, 'adauga');

    await context.setOffline(true);
    await share(page, [
      { name: 'offline.pdf', mimeType: 'application/pdf', buffer: pdfFromFixture() },
    ]);

    await expect(REVIEW(page)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Sursă: PDF „offline\.pdf”/)).toBeVisible();
  });

  test('several shared files are listed so that each can be opened', async ({ page }) => {
    await openApp(page, 'adauga');

    await share(page, [
      { name: 'unu.pdf', mimeType: 'application/pdf', buffer: pdfFromFixture() },
      { name: 'doi.txt', mimeType: 'text/plain', buffer: Buffer.from('KAUFLAND\nLAPTE 5,00') },
    ]);

    const results = page.getByRole('region', { name: 'Rezultat' });
    await expect(results.getByRole('link', { name: 'Verifică „unu.pdf”' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page).toHaveURL(new RegExp(`${BASE}#/adauga$`));
  });

  test('a share that brought no file, or whose files are gone, leaves the screen usable', async ({
    page,
  }) => {
    await openApp(page, 'adauga');

    await page.evaluate(
      ({ action }) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.enctype = 'multipart/form-data';
        form.action = action;
        const text = document.createElement('input');
        text.name = 'text';
        text.value = 'a link, not a receipt';
        form.append(text);
        document.body.append(form);
        form.requestSubmit();
      },
      { action: `${BASE}share-target` },
    );
    await expect(page.getByLabel('Alege fișiere')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${BASE}#/adauga$`));

    // A link to files that are gone (picked up already, or expired), opened as a fresh page load.
    await visitFresh(page, 'adauga?shared=gone-0123456789');
    await expect(page.getByText(/Nu am primit niciun fișier prin „Distribuie”/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`${BASE}#/adauga$`));
  });
});
