import { expect, type Page } from '@playwright/test';

/** The Vite base the e2e build is served under (GitHub Pages serves the project at /<repo>/). */
export const BASE = '/pretometru/';

/**
 * Opens the app and waits until the service worker is active and controls the page: from then on the
 * app shell is cached and any engine the page loads is stored for offline use.
 */
export async function openApp(page: Page, route = ''): Promise<void> {
  await page.goto(`${BASE}${route === '' ? '' : `#/${route}`}`);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const worker = navigator.serviceWorker;
          if (!worker) return 'unavailable';
          if (worker.controller) return 'controlling';
          const registration = await worker.getRegistration();
          return (
            registration?.active?.state ??
            registration?.waiting?.state ??
            registration?.installing?.state ??
            'unregistered'
          );
        }),
      { message: 'the installed service worker must control the page' },
    )
    .toBe('controlling');
}

/** Names of the Cache API caches of the origin. */
export function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}

/**
 * Opens a route with a full page load, as when the installed app is started on it (a hash change alone
 * would not load anything): the document, every script and every style come from where the worker puts them.
 */
export async function visitFresh(page: Page, route: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`${BASE}${route === '' ? '' : `#/${route}`}`);
}

/**
 * Starts recording what should never happen offline: a script error, a console error or a request that
 * fails (the service worker's own update check excepted, it has no one to report to). Call the result
 * for what was seen so far.
 */
export function watchForProblems(page: Page): () => string[] {
  const seen: string[] = [];
  page.on('pageerror', (error) => seen.push(`error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') seen.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    if (!request.url().endsWith('/sw.js')) seen.push(`request failed: ${request.url()}`);
  });
  return () => [...seen];
}
