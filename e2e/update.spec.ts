import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devices, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { BASE, cacheNames, openApp } from './support/app.ts';
import { startPagesServer, type PagesServer } from './support/pages-server.ts';

/**
 * An app update with the custom service worker (`registerType: 'prompt'`): the new version installs in
 * the background and waits; nothing changes under the user until they press "Actualizează". The "new
 * version" is a copy of the build whose index.html and worker differ, served from a folder the test owns.
 */

let directory: string;
let server: PagesServer;
let context: BrowserContext;
let page: Page;

const marker = (target: Page) =>
  target.evaluate(
    () => document.querySelector('meta[name="x-build"]')?.getAttribute('content') ?? null,
  );
// While the page reloads into the new version the context it asks is gone for a moment.
const markerWhileReloading = (target: Page) => marker(target).catch(() => 'reloading');

test.beforeAll(async ({ browser }) => {
  directory = await mkdtemp(join(tmpdir(), 'pretometru-e2e-update-'));
  await cp('dist', directory, { recursive: true });
  server = await startPagesServer({ root: directory });
  context = await browser.newContext({ ...devices['Pixel 7'], baseURL: server.origin });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
});

/** Version 2: another index.html (it says so) and a worker that lists it under another revision. */
async function publishVersionTwo() {
  const indexPath = join(directory, 'index.html');
  const index = await readFile(indexPath, 'utf8');
  await writeFile(
    indexPath,
    index.replace('</head>', '<meta name="x-build" content="v2" /></head>'),
  );

  const workerPath = join(directory, 'sw.js');
  const worker = await readFile(workerPath, 'utf8');
  const changed = worker.replace(
    /"revision":"[0-9a-f]{32}","url":"index\.html"/,
    '"revision":"v2-index-revision","url":"index.html"',
  );
  expect(changed, 'the worker lists index.html with a revision').not.toBe(worker);
  await writeFile(workerPath, `${changed}\n// version 2\n`);
}

test('an update waits for the user, keeps the downloaded engines and works offline afterwards', async () => {
  test.setTimeout(240_000);

  // Version 1, installed; the engines are downloaded from Settings.
  await openApp(page, 'setari');
  expect(await marker(page)).toBeNull();
  const section = page.getByRole('region', { name: 'Offline și stocare' });
  await section.getByRole('button', { name: /^Descarcă acum/ }).click();
  await expect(section.getByText(/poți citi PDF-uri și poze și fără internet/)).toBeVisible({
    timeout: 120_000,
  });
  const before = (await cacheNames(page)).filter((name) => name.startsWith('pretometru-engine-'));
  expect(before).toHaveLength(2);

  // Version 2 is published, and the browser checks for it.
  await publishVersionTwo();
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });

  // The user is told, and nothing else happens: this page and a reload stay on version 1.
  const prompt = page.getByRole('status').filter({ hasText: 'versiune nouă' });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  expect(await marker(page)).toBeNull();
  await page.reload();
  expect(await marker(page)).toBeNull();
  await expect(prompt).toBeVisible();

  // "Actualizează": the new worker takes over and the page reloads into version 2.
  await prompt.getByRole('button', { name: 'Actualizează' }).click();
  await expect.poll(() => markerWhileReloading(page), { timeout: 30_000 }).toBe('v2');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  // The engines were left alone by the update: the same caches, nothing downloaded again.
  const after = (await cacheNames(page)).filter((name) => name.startsWith('pretometru-engine-'));
  expect(after.sort()).toEqual(before.sort());
  expect(
    (await cacheNames(page)).filter((name) => name.startsWith('workbox-precache')),
  ).toHaveLength(1);

  // Version 2 works offline, its own shell included.
  await context.setOffline(true);
  await page.goto('about:blank');
  await page.goto(`${BASE}#/adauga`);
  await expect(page.getByRole('heading', { level: 1, name: 'Adaugă bon' })).toBeVisible();
  expect(await marker(page)).toBe('v2');
  await context.setOffline(false);
});
