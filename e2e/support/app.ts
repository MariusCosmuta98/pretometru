import type { Page } from '@playwright/test';

/** The Vite base the e2e build is served under (GitHub Pages serves the project at /<repo>/). */
export const BASE = '/pretometru/';

/**
 * Opens the app and waits until the service worker is active and controls the page: from then on the
 * app shell is cached and any engine the page loads is stored for offline use.
 */
export async function openApp(page: Page, route = ''): Promise<void> {
  await page.goto(`${BASE}${route === '' ? '' : `#/${route}`}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

/** Names of the Cache API caches of the origin. */
export function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(() => caches.keys());
}
