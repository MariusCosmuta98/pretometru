import { expect, test, type Page } from '@playwright/test';
import { openApp, visitFresh } from './support/app.ts';
import { pdfFromFixture } from './support/samples.ts';

const section = (page: Page) => page.getByRole('region', { name: 'Offline și stocare' });

/** A storage manager whose answers the test controls; `calls` counts `persist()` across page loads. */
async function stubStorage(page: Page, { persisted = false, grant = true } = {}) {
  await page.addInitScript(
    ({ initiallyPersisted, grantRequests }) => {
      let persisted = initiallyPersisted;
      let grant = grantRequests;
      const calls = () => Number(localStorage.getItem('e2e-persist-calls') ?? '0');
      Object.defineProperty(navigator, 'storage', {
        configurable: true,
        value: {
          persisted: () => Promise.resolve(persisted),
          persist: () => {
            localStorage.setItem('e2e-persist-calls', String(calls() + 1));
            persisted = grant;
            return Promise.resolve(grant);
          },
          estimate: () => Promise.resolve({ usage: 3_000_000, quota: 500_000_000 }),
        },
      });
      Object.defineProperty(window, 'e2eStorage', {
        configurable: true,
        value: {
          grant: (value: boolean) => {
            grant = value;
          },
        },
      });
    },
    { initiallyPersisted: persisted, grantRequests: grant },
  );
}

const persistCalls = (page: Page) =>
  page.evaluate(() => Number(localStorage.getItem('e2e-persist-calls') ?? '0'));

test.describe('persistent storage', () => {
  test('Settings shows the state of the real browser, with the space used', async ({ page }) => {
    await openApp(page, 'setari');

    await expect(section(page).getByText('Stocare persistentă', { exact: true })).toBeVisible();
    await expect(section(page).getByText(/^(activă|neactivă)$/)).toBeVisible();
    await expect(section(page).getByText(/^\d+(,\d)? [KM]B din \d+(,\d)? [MG]B$/)).toBeVisible();
    await expect(section(page).getByText('Instalată pe ecranul principal')).toBeVisible();
    await expect(section(page).getByText(/copie de siguranță/)).toBeVisible();
  });

  test('a refusal is shown, and the user can ask again', async ({ page }) => {
    await stubStorage(page, { grant: false });
    await openApp(page, 'setari');
    await expect(section(page).getByText('neactivă')).toBeVisible();

    await section(page).getByRole('button', { name: 'Cere stocare persistentă' }).click();
    await expect(section(page).getByText(/Browserul nu a acceptat acum/)).toBeVisible();
    await expect(section(page).getByText('neactivă')).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { e2eStorage: { grant(value: boolean): void } }).e2eStorage.grant(true);
    });
    await section(page).getByRole('button', { name: 'Cere stocare persistentă' }).click();
    await expect(section(page).getByText(/Browserul a acceptat/)).toBeVisible();
    await expect(section(page).getByText('activă')).toBeVisible();
    await expect(
      section(page).getByRole('button', { name: 'Cere stocare persistentă' }),
    ).toHaveCount(0);
    expect(await persistCalls(page)).toBe(2);
  });

  test('the app asks once, after the first confirmed receipt, and never again', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await stubStorage(page);
    await openApp(page, 'adauga');
    // Long enough for the watcher (it starts a few seconds after the first screen) to be running.
    await page.waitForTimeout(4_000);
    expect(await persistCalls(page), 'nothing to keep yet').toBe(0);

    await page.getByLabel('Alege fișiere').setInputFiles({
      name: 'kaufland.pdf',
      mimeType: 'application/pdf',
      buffer: pdfFromFixture(),
    });
    await expect(page.getByRole('heading', { level: 2, name: 'Detalii bon' })).toBeVisible({
      timeout: 60_000,
    });
    // A draft is not yet a receipt worth keeping.
    await page.waitForTimeout(500);
    expect(await persistCalls(page)).toBe(0);

    await page.getByRole('button', { name: 'Confirmă bonul' }).click();
    await expect.poll(() => persistCalls(page), { timeout: 30_000 }).toBe(1);

    // Later visits do not ask again, and do not even load the code that watches for it.
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));
    await visitFresh(page, 'bonuri');
    await expect(page.getByRole('list', { name: 'Bonuri' })).toBeVisible();
    await page.waitForTimeout(4_000);
    expect(await persistCalls(page)).toBe(1);
    expect(requested.filter((url) => /persistence-watcher/.test(url))).toEqual([]);
  });
});
