import { expect, test, type Page } from '@playwright/test';
import { MockGitHub } from '../src/sync/mock-github.ts';
import { openApp, visitFresh, watchForProblems } from './support/app.ts';
import { seedPriceHistory } from './support/seed.ts';

// The production build in a real browser, with api.github.com answered by an in-memory GitHub
// (src/sync/mock-github.ts). No real token or repository is ever used.
const TOKEN = 'fake-token-for-e2e';
const OWNER = 'ana';
const REPO = 'ana/pretometru-data';

const section = (page: Page) => page.getByRole('region', { name: 'Sincronizare GitHub' });

async function newWorld(): Promise<MockGitHub> {
  const github = new MockGitHub().addToken(TOKEN, OWNER, { [REPO]: 'write' });
  await github.addRepo({ owner: OWNER, name: 'pretometru-data' });
  return github;
}

/**
 * Answers every request to api.github.com from the in-memory GitHub, the way the browser would see
 * the real one: only the headers the app sets are passed on, and CORS headers are added. (Playwright
 * answers the CORS preflight itself, so the header allow-list is checked by the mock's own tests.)
 */
async function serveGitHub(page: Page, github: MockGitHub): Promise<void> {
  await page.route('https://api.github.com/**', async (route) => {
    const request = route.request();
    const sent = request.headers();
    const headers: Record<string, string> = {};
    for (const name of ['authorization', 'accept', 'content-type']) {
      const value = sent[name];
      if (value !== undefined) headers[name] = value;
    }
    const response = await github.fetch(request.url(), {
      method: request.method(),
      headers,
      body: request.postData() ?? undefined,
    });
    await route.fulfill({
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'access-control-allow-origin': sent['origin'] ?? '*',
        'access-control-expose-headers': 'Retry-After, X-RateLimit-Remaining, X-RateLimit-Reset',
      },
      body: await response.text(),
    });
  });
}

/** What `syncState` holds, as the text a thief of the browser profile would read. */
const syncStateText = (page: Page): Promise<string> =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pretometru');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database did not open'));
      };
    });
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('syncState').objectStore('syncState').getAll();
      request.onsuccess = () => {
        resolve(request.result as unknown[]);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not read syncState'));
      };
    });
    db.close();
    return JSON.stringify(rows);
  });

/** What a user does to a product on another screen: a newer copy of it in the app's database. */
const renameFirstProduct = (page: Page, name: string): Promise<void> =>
  page.evaluate(async (newName) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('pretometru');
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('The database did not open'));
      };
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('products', 'readwrite');
      const store = transaction.objectStore('products');
      const all = store.getAll();
      all.onsuccess = () => {
        const [first] = all.result as Array<Record<string, unknown>>;
        if (first) store.put({ ...first, name: newName, updatedAt: new Date().toISOString() });
      };
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(transaction.error ?? new Error('Could not write the product'));
      };
    });
    db.close();
  }, name);

const asked = (github: MockGitHub) =>
  github.requests.filter((request) => request.path === `/repos/${REPO}`).length;

test.describe('GitHub sync in the production build', () => {
  test('walks from the instructions to a first sync, a second one, an automatic one and a disconnect', async ({
    page,
  }) => {
    const github = await newWorld();
    await serveGitHub(page, github);
    const problems = watchForProblems(page);

    await openApp(page, 'setari');
    const card = section(page);
    await expect(card.getByText('Only select repositories')).toBeVisible();
    await expect(card.getByLabel('Token GitHub')).toHaveAttribute('type', 'password');

    // The app opened its database; give it something to upload.
    await seedPriceHistory(page);

    await card.getByLabel('Token GitHub').fill(TOKEN);
    await card.getByRole('button', { name: 'Verifică conexiunea' }).click();
    await expect(card.getByText(/nu conține încă date Pretometru/)).toBeVisible();
    await expect(card.getByRole('list', { name: 'Verificări' }).getByRole('listitem')).toHaveCount(
      5,
    );
    expect(github.history(REPO)).toHaveLength(1); // the check committed nothing

    await card.getByRole('button', { name: 'Conectează și încarcă datele' }).click();
    await expect(card.getByText(REPO)).toBeVisible();
    await expect(card.getByText(/Prima sincronizare: \d+ înregistrări trimise/)).toBeVisible();

    const files = [...github.files(REPO).keys()];
    expect(files).toEqual(
      expect.arrayContaining([
        'data/pretometru.json',
        'data/categories/seed.json',
        'data/stores/2023-11.json',
        'data/products/2023-11.json',
        'data/receipts/2023-11.json',
        'data/lines/2023-11.json',
      ]),
    );
    expect(github.history(REPO)[0]?.message).toMatch(
      /^Prima sincronizare Pretometru \(dispozitiv \w{6}\)/,
    );
    expect([...github.files(REPO).values()].join('\n')).not.toContain(TOKEN);
    expect(await syncStateText(page)).toContain(TOKEN); // on this device only, in syncState

    // A change on the device goes up with "Sincronizează acum", as one record.
    await renameFirstProduct(page, 'Hârtie igienică 3 straturi');
    await card.getByRole('button', { name: 'Sincronizează acum' }).click();
    await expect(card.getByText(/1 înregistrare trimisă\./)).toBeVisible();
    expect(github.files(REPO).get('data/products/2023-11.json')).toContain('3 straturi');

    // The next start syncs by itself (3 s after the app opens), with no tap.
    const before = asked(github);
    await visitFresh(page, 'setari');
    await expect(card.getByText(REPO)).toBeVisible();
    await expect.poll(() => asked(github), { timeout: 15_000 }).toBeGreaterThan(before);

    // A repository that turned public is refused, and nothing is written to it.
    github.setPrivate(REPO, false);
    const writes = github.writes.length;
    await card.getByRole('button', { name: 'Sincronizează acum' }).click();
    await expect(card.getByRole('alert')).toContainText('Depozitul este public');
    await expect(card.getByText(/Sincronizarea automată este oprită/)).toBeVisible();
    expect(github.writes).toHaveLength(writes);

    // Disconnecting takes the token off the device.
    await card.getByRole('button', { name: 'Deconectează' }).click();
    await card.getByRole('button', { name: 'Da, deconectează' }).click();
    await expect(card.getByLabel('Token GitHub')).toBeVisible();
    expect(await syncStateText(page)).not.toContain(TOKEN);

    expect(problems()).toEqual([]);
  });

  test('keeps a token protected by a passphrase encrypted, and asks for it again after a restart', async ({
    page,
  }) => {
    const github = await newWorld();
    await serveGitHub(page, github);
    const problems = watchForProblems(page);

    await openApp(page, 'setari');
    const card = section(page);
    await card.getByLabel('Token GitHub').fill(TOKEN);
    await card.getByLabel('Protejează tokenul cu o parolă (opțional)').check();
    await card.getByLabel('Parolă', { exact: true }).fill('o parolă de test');
    await card.getByLabel('Repetă parola').fill('o parolă de test');
    await card.getByRole('button', { name: 'Verifică conexiunea' }).click();
    await card.getByRole('button', { name: /Conectează/ }).click();
    await expect(card.getByText(/Prima sincronizare|Totul era deja la zi/)).toBeVisible();

    const stored = await syncStateText(page);
    expect(stored).not.toContain(TOKEN);
    expect(stored).toContain('PBKDF2-SHA256');

    await visitFresh(page, 'setari');
    await expect(card.getByLabel('Parola tokenului')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Sincronizează acum' })).toBeDisabled();

    await card.getByLabel('Parola tokenului').fill('altă parolă');
    await card.getByRole('button', { name: 'Deblochează' }).click();
    await expect(card.getByRole('alert')).toHaveText('Parola nu este corectă.');

    await card.getByLabel('Parola tokenului').fill('o parolă de test');
    await card.getByRole('button', { name: 'Deblochează' }).click();
    await expect(card.getByRole('button', { name: 'Sincronizează acum' })).toBeEnabled();
    await card.getByRole('button', { name: 'Sincronizează acum' }).click();
    await expect(card.getByText(/Totul era deja la zi/)).toBeVisible();

    expect(problems()).toEqual([]);
  });
});
