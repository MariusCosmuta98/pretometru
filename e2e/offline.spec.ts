import { expect, test, type Page } from '@playwright/test';
import { BASE, cacheNames, openApp, visitFresh, watchForProblems } from './support/app.ts';
import { seedPriceHistory } from './support/seed.ts';

test.describe('the production build offline', () => {
  test('the install step downloads the shell, not the engines', async ({ page }) => {
    await openApp(page);

    const names = await cacheNames(page);
    expect(names.some((name) => name.startsWith('workbox-precache'))).toBe(true);
    expect(names.some((name) => name.startsWith('pretometru-engine-'))).toBe(false);
  });

  test('every screen renders offline, with the data stored on the device', async ({
    page,
    context,
  }) => {
    // First visit, online: the service worker installs, the database is created and filled.
    await openApp(page, 'produse');
    const { receiptId, productId } = await seedPriceHistory(page);
    const links = await page.$$eval('a[href^="#/"]', (anchors) =>
      anchors.map((anchor) => anchor.getAttribute('href')?.slice(2) ?? ''),
    );
    const routes = [...new Set(['', ...links])];
    // The screens that read the data, and a route that does not exist.
    routes.push(`bonuri/${receiptId}`, `produse/${productId}`, 'nu-exista');

    await context.setOffline(true);
    const problems = watchForProblems(page);

    for (const route of routes) {
      await visitFresh(page, route);
      await expect(page.getByRole('heading', { level: 1 }), route).toBeVisible();
      expect(await page.locator('main').innerText(), route).not.toContain('A apărut o eroare');
    }

    // The data comes from IndexedDB, not from the network.
    await visitFresh(page, 'bonuri');
    const receipts = page.getByRole('list', { name: 'Bonuri' });
    await expect(receipts.getByText('Kaufland Cluj').first()).toBeVisible();
    await expect(receipts.getByText('METRO Cluj')).toBeVisible();
    await expect(page.getByText('3 bonuri')).toBeVisible();

    await visitFresh(page, 'produse');
    await expect(page.getByRole('link', { name: /Hârtie igienică/ })).toBeVisible();

    // The product page has the comparison and the chart, whose code is a lazy chunk with its own CSS.
    await visitFresh(page, `produse/${productId}`);
    await expect(page.getByRole('heading', { name: /Hârtie igienică/ }).first()).toBeVisible();
    await expect(page.getByRole('img', { name: /Prețul pe rolă în timp/ })).toBeVisible();
    await expect(page.locator('figure canvas').first()).toBeVisible();

    await visitFresh(page, `bonuri/${receiptId}`);
    await expect(page.getByRole('heading', { level: 2, name: 'Detalii bon' })).toBeVisible();

    await visitFresh(page, 'nu-exista');
    await expect(page.getByRole('heading', { level: 1, name: 'Pagină negăsită' })).toBeVisible();

    expect(problems(), 'errors or failed requests while offline').toEqual([]);
  });

  test('a returning visit offline opens straight into the app, from the installed worker', async ({
    page,
    context,
  }) => {
    await openApp(page);
    await context.setOffline(true);

    // A new tab, as when the installed app is opened with no connection.
    const tab: Page = await context.newPage();
    await tab.goto(BASE);
    await expect(tab.getByRole('heading', { level: 1, name: 'Acasă' })).toBeVisible();
    expect(await tab.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  });
});

test.describe('camera capture', () => {
  test('the add-receipt screen of the built app offers a camera input that opens the rear camera', async ({
    page,
  }) => {
    await openApp(page, 'adauga');

    const camera = page.getByLabel('Fotografiază bonul');
    await expect(camera).toHaveAttribute('capture', 'environment');
    await expect(camera).toHaveAttribute('accept', 'image/*');
    // The file picker takes PDFs, images and text, several at once.
    const files = page.getByLabel('Alege fișiere');
    await expect(files).toHaveAttribute('multiple', '');
    await expect(files).toHaveAttribute('accept', /application\/pdf/);
  });
});
