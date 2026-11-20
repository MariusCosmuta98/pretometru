import { expect, test, type Page } from '@playwright/test';
import { MockGemini } from '../src/ai/mock-gemini.ts';
import { openApp, visitFresh, watchForProblems } from './support/app.ts';
import {
  aiSettings,
  bigPhoto,
  FAKE_KEY,
  isAiEngineChunk,
  lidlAnswer,
  seedImageDraft,
  serveGemini,
  sizeOfJpeg,
} from './support/gemini.ts';
import { receiptPhoto } from './support/samples.ts';

// The production build in a real browser, with generativelanguage.googleapis.com answered by an
// in-memory Gemini (src/ai/mock-gemini.ts). No real key and no real receipt is ever used.
const card = (page: Page) => page.getByRole('region', { name: 'Gemini (opțional)' });
const review = (page: Page) => page.getByRole('heading', { level: 2, name: 'Detalii bon' });
const askAi = (page: Page) => page.getByRole('button', { name: 'Citește cu AI' });
const model = 'gemini-3.5-flash-lite';

/** Settings: save the fake key and switch the reading on. */
async function switchOn(page: Page): Promise<void> {
  await openApp(page, 'setari');
  const section = card(page);
  await section.getByLabel('Cheie API Gemini').fill(FAKE_KEY);
  await section.getByRole('button', { name: 'Salvează cheia' }).click();
  await expect(section.getByText(/Cheia este salvată pe acest dispozitiv \(…0001\)/)).toBeVisible();
  await section.getByRole('switch', { name: /Pornește citirea cu AI/ }).check();
  await expect(section.getByRole('switch', { name: /Pornește citirea cu AI/ })).toBeChecked();
}

/** What the app's IndexedDB holds for the receipts: the engine of each extraction. */
const storedEngines = (page: Page): Promise<string[]> =>
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
    const rows = await new Promise<Array<{ extraction: { engine: string } }>>((resolve, reject) => {
      const request = db.transaction('receipts').objectStore('receipts').getAll();
      request.onsuccess = () => {
        resolve(request.result as Array<{ extraction: { engine: string } }>);
      };
      request.onerror = () => {
        reject(request.error ?? new Error('Could not read the receipts'));
      };
    });
    db.close();
    return rows.map((row) => row.extraction.engine);
  });

test.describe('the optional Gemini reading in the production build', () => {
  test('with the feature off, nothing is sent to Google and no part of the engine is even loaded', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const mock = new MockGemini({ keys: [FAKE_KEY] });
    const googleRequests = await serveGemini(page, mock);
    const engineChunks: string[] = [];
    page.on('request', (request) => {
      if (isAiEngineChunk(request.url())) engineChunks.push(request.url());
    });
    const problems = watchForProblems(page);

    // The Settings card is there, says what leaving the device means, and offers no way to read yet.
    await openApp(page, 'setari');
    const section = card(page);
    await expect(section.getByLabel('Cheie API Gemini')).toHaveAttribute('type', 'password');
    await expect(section.getByRole('switch', { name: /Pornește citirea cu AI/ })).toBeDisabled();
    await expect(section).toContainText('îmbunătățească produsele');
    await expect(section).toContainText('oameni din echipa Google');

    // A photo is imported with the OCR engine and reviewed: no AI action, no request, no chunk.
    await visitFresh(page, 'adauga');
    await page.getByLabel('Fotografiază bonul').setInputFiles({
      name: 'lidl.png',
      mimeType: 'image/png',
      buffer: await receiptPhoto(page),
    });
    await expect(review(page)).toBeVisible({ timeout: 150_000 });
    await expect(askAi(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Citire cu AI' })).toHaveCount(0);

    expect(googleRequests).toEqual([]);
    expect(engineChunks).toEqual([]);
    expect(problems()).toEqual([]);
  });

  test('switched on: a connection test, then a reading that leaves resized, as a JPEG, with the key in a header', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const mock = new MockGemini({ keys: [FAKE_KEY] });
    mock.answer = lidlAnswer();
    const googleRequests = await serveGemini(page, mock);
    const problems = watchForProblems(page);

    await switchOn(page);
    // Saving a key and switching on ask nobody anything.
    expect(googleRequests).toEqual([]);

    // The test asks for the description of the model: no receipt data.
    await card(page).getByRole('button', { name: 'Testează conexiunea' }).click();
    await expect(
      card(page).getByText(
        `Conexiunea funcționează: modelul ${model} este disponibil. Nu s-a trimis niciun bon.`,
      ),
    ).toBeVisible();
    expect(googleRequests).toEqual([`GET /v1beta/models/${model}`]);

    // A draft read from a photo whose lines do not add up; the photo is not in memory any more.
    const id = await seedImageDraft(page);
    await visitFresh(page, `bonuri/${id}`);
    await expect(review(page)).toBeVisible();
    await expect(page.getByText(/diferență/)).toBeVisible();

    await askAi(page).click();
    const dialog = page.getByRole('dialog', { name: 'Trimiți poza la Gemini?' });
    await expect(dialog).toContainText('Nivelul gratuit.');
    await expect(dialog).toContainText('Spațiul Economic European');
    await expect(dialog).toContainText('Poza originală nu mai este în memorie');
    await expect(dialog.getByRole('button', { name: 'Trimite poza la Gemini' })).toBeDisabled();
    // Backing out sends nothing.
    await dialog.getByRole('button', { name: 'Renunță' }).click();
    await expect(dialog).toHaveCount(0);
    expect(googleRequests).toHaveLength(1);

    // A 12 megapixel photo, chosen again.
    await askAi(page).click();
    await dialog.getByLabel('Poza bonului').setInputFiles({
      name: 'big.png',
      mimeType: 'image/png',
      buffer: await bigPhoto(page, 4000, 3000),
    });
    await dialog.getByRole('button', { name: 'Trimite poza la Gemini' }).click();
    await expect(
      page.getByText(new RegExp(`Bonul este citit cu Gemini \\(${model}\\)`)),
    ).toBeVisible({
      timeout: 60_000,
    });

    // What Google received: one request, with the key in a header and not in the address, and a
    // JPEG made by the browser that is smaller than the original and carries nothing of its file.
    expect(googleRequests).toEqual([
      `GET /v1beta/models/${model}`,
      `POST /v1beta/models/${model}:generateContent`,
    ]);
    const post = mock.requests.at(-1);
    expect(post?.headers['x-goog-api-key']).toBe(FAKE_KEY);
    expect(post?.query).toBe('');
    const [sent] = mock.generates;
    expect(sent?.imageMimeType).toBe('image/jpeg');
    expect(Buffer.from(sent?.image ?? []).includes('Exif')).toBe(false);
    const { width, height } = await sizeOfJpeg(page, sent?.image ?? new Uint8Array());
    expect(width * height).toBeLessThanOrEqual(3_500_000);
    expect(width * height).toBeGreaterThan(3_300_000);
    expect(width / height).toBeCloseTo(4 / 3, 1);
    expect(mock.violations).toEqual([]);

    // The reading replaced the wrong one: the sum matches, the date is flagged like any other, and
    // nothing is saved until the user saves.
    await expect(page.getByText(/se potrivesc/)).toBeVisible();
    await expect(page.getByRole('region', { name: /Avertismente/ })).toContainText(
      'este în viitor',
    );
    expect(await storedEngines(page)).toEqual(['tesseract']);
    await page.getByRole('button', { name: 'Arată citirea anterioară' }).click();
    await expect(page.getByText(/diferență/)).toBeVisible();
    await page.getByRole('button', { name: 'Arată citirea Gemini' }).click();
    await page.getByRole('button', { name: 'Salvează ciorna' }).click();
    await expect(page.getByText('Ciorna a fost salvată.')).toBeVisible();
    expect(await storedEngines(page)).toEqual(['gemini']);

    // Switched off, the action is gone; the key can be removed.
    await visitFresh(page, 'setari');
    await card(page)
      .getByRole('switch', { name: /Pornește citirea cu AI/ })
      .uncheck();
    // The switch answers at once; the choice is stored a moment later.
    await expect.poll(() => aiSettings(page)).toEqual({ enabled: false, hasKey: true });
    await visitFresh(page, `bonuri/${id}`);
    await expect(review(page)).toBeVisible();
    await expect(askAi(page)).toHaveCount(0);
    await visitFresh(page, 'setari');
    await card(page).getByRole('button', { name: 'Șterge cheia' }).click();
    await card(page).getByRole('button', { name: 'Șterge cheia' }).last().click();
    await expect(card(page).getByLabel('Cheie API Gemini')).toBeVisible();
    await expect.poll(() => aiSettings(page)).toEqual({ enabled: false, hasKey: false });
    expect(googleRequests).toHaveLength(2);
    expect(problems()).toEqual([]);
  });

  test('failures are Romanian messages that change nothing, and offline nothing is even attempted', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    // Google knows no key: the saved one is a wrong one.
    const mock = new MockGemini({ keys: [] });
    const googleRequests = await serveGemini(page, mock);

    await switchOn(page);
    const id = await seedImageDraft(page);
    await visitFresh(page, `bonuri/${id}`);
    await expect(review(page)).toBeVisible();

    const send = async () => {
      await askAi(page).click();
      const dialog = page.getByRole('dialog', { name: 'Trimiți poza la Gemini?' });
      const picker = dialog.getByLabel('Poza bonului');
      if (await picker.count()) {
        await picker.setInputFiles({
          name: 'bon.png',
          mimeType: 'image/png',
          buffer: await bigPhoto(page, 800, 1200),
        });
      }
      await dialog.getByRole('button', { name: 'Trimite poza la Gemini' }).click();
    };

    await send();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Google nu acceptă cheia API' }),
    ).toBeVisible();
    await expect(page.getByText(/diferență/)).toBeVisible();
    await expect(askAi(page)).toBeVisible();
    expect(googleRequests).toEqual([`POST /v1beta/models/${model}:generateContent`]);

    await context.setOffline(true);
    await send();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Nu ești conectat la internet' }),
    ).toBeVisible();
    expect(googleRequests).toHaveLength(1);
    expect(await storedEngines(page)).toEqual(['tesseract']);
  });
});
