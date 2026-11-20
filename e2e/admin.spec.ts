import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { openApp, visitFresh, watchForProblems } from './support/app.ts';
import { seedPriceHistory } from './support/seed.ts';

const card = (page: Page, name: string) => page.getByRole('region', { name });

/** Every request that did not go to the app's own origin (a `blob:` download link is local). */
function watchForeignRequests(page: Page): () => string[] {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  return () => {
    const origin = new URL(page.url()).origin;
    return urls.filter((url) => !url.startsWith(origin) && !/^(blob|data|about):/.test(url));
  };
}

const newerFormat = {
  name: 'nou.pretometru-backup.json',
  mimeType: 'application/json',
  buffer: Buffer.from(
    JSON.stringify({
      format: 'pretometru-backup',
      formatVersion: 2,
      exportedAt: '2027-01-01T10:00:00.000Z',
      data: {},
    }),
  ),
};

test.describe('backup, categories and stores in the production build', () => {
  test('Settings has the three cards, and the two screens open from them', async ({ page }) => {
    const problems = watchForProblems(page);
    await openApp(page, 'setari');

    for (const name of ['Categorii', 'Magazine', 'Copie de siguranță']) {
      await expect(card(page, name), name).toBeVisible();
    }
    await expect(card(page, 'Categorii').getByText(/: 15 categorii\./)).toBeVisible();
    await expect(
      page.getByText(/sau sincronizează-le cu depozitul tău GitHub privat/),
    ).toBeVisible();

    await card(page, 'Categorii').getByRole('link', { name: 'Gestionează categoriile' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Categorii' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Categoriile tale' })).toBeVisible();
    const system = page.getByRole('listitem').filter({ hasText: 'Non-produs' });
    await expect(system).toContainText('Categorie de sistem');
    await expect(system.getByRole('button', { name: /Șterge|Mută/ })).toHaveCount(0);
    await page.getByRole('link', { name: '← Setări' }).click();

    await card(page, 'Magazine').getByRole('link', { name: 'Gestionează magazinele' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Magazine' })).toBeVisible();
    await expect(page.getByText(/Nu ai încă niciun magazin/)).toBeVisible();

    expect(problems()).toEqual([]);
  });

  test('a backup is exported to a file, previewed and imported in both modes, and nothing leaves the device', async ({
    page,
  }) => {
    const problems = watchForProblems(page);
    const foreign = watchForeignRequests(page);
    await openApp(page, 'setari');
    await seedPriceHistory(page);
    await visitFresh(page, 'setari');
    const backup = card(page, 'Copie de siguranță');
    await expect(backup.getByText(/\(3 bonuri, 1 produs și 2 magazine\)/)).toBeVisible();
    await expect(
      backup.getByText('Nu ai exportat încă o copie de pe acest dispozitiv.'),
    ).toBeVisible();

    // Export: a dated *.pretometru-backup.json with every record and no secrets.
    const download = page.waitForEvent('download');
    await backup.getByRole('button', { name: 'Exportă datele' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(
      /^pretometru-\d{4}-\d{2}-\d{2}\.pretometru-backup\.json$/,
    );
    const path = await file.path();
    const written = JSON.parse(await readFile(path, 'utf8')) as {
      format: string;
      formatVersion: number;
      data: Record<string, unknown[]>;
    };
    expect(written).toMatchObject({ format: 'pretometru-backup', formatVersion: 1 });
    expect(written.data['stores']).toHaveLength(2);
    expect(written.data['receipts']).toHaveLength(3);
    expect(written.data['lines']).toHaveLength(3);
    expect(JSON.stringify(written.data['settings'])).not.toContain('lastExportAt');
    await expect(backup.getByText(/Am pregătit fișierul/)).toBeVisible();
    await expect(backup.getByText(/Ultima exportare: \d/)).toBeVisible();

    // Import it back: previewed first, and merging changes nothing because nothing is newer.
    await backup.getByLabel('Fișier de copie de siguranță').setInputFiles(path);
    const preview = backup.getByRole('region', { name: 'Fișierul ales' });
    await expect(preview.getByRole('row', { name: /^Bonuri/ })).toContainText('3');
    await expect(preview.getByText('Versiunea formatului')).toBeVisible();
    await expect(preview.getByRole('radio', { name: /Îmbină/ })).toBeChecked();
    await preview.getByRole('button', { name: 'Importă datele' }).click();
    await expect(backup.getByRole('heading', { name: 'Import terminat' })).toBeVisible();
    await expect(backup.getByText(/Nu s-a schimbat nimic/)).toBeVisible();

    // A category added after the export is kept by a merge and lost by a replace.
    await visitFresh(page, 'setari/categorii');
    await page.getByRole('button', { name: 'Adaugă o categorie' }).click();
    await page.getByRole('form', { name: 'Categorie nouă' }).getByLabel('Nume').fill('Cafea');
    await page.getByRole('button', { name: 'Adaugă categoria' }).click();
    await expect(page.getByText('Categoria „Cafea” a fost adăugată.')).toBeVisible();

    await visitFresh(page, 'setari');
    await backup.getByLabel('Fișier de copie de siguranță').setInputFiles(path);
    await backup.getByRole('button', { name: 'Importă datele' }).click();
    await expect(backup.getByRole('heading', { name: 'Import terminat' })).toBeVisible();
    await visitFresh(page, 'setari/categorii');
    await expect(page.getByRole('listitem').filter({ hasText: 'Cafea' })).toBeVisible();

    await visitFresh(page, 'setari');
    await backup.getByLabel('Fișier de copie de siguranță').setInputFiles(path);
    await backup.getByRole('radio', { name: /Înlocuiește tot/ }).check();
    await backup.getByRole('button', { name: 'Importă datele' }).click();
    const question = backup.getByRole('group', {
      name: 'Înlocuiești datele de pe acest dispozitiv?',
    });
    await expect(question).toContainText('Nu se poate anula.');
    await expect(question.getByRole('button', { name: 'Anulează' })).toBeFocused();
    await question.getByRole('button', { name: 'Înlocuiește datele' }).click();
    await expect(backup.getByText(/au fost înlocuite cu cele din fișier/)).toBeVisible();
    await visitFresh(page, 'setari/categorii');
    await expect(page.getByRole('heading', { level: 2, name: 'Categoriile tale' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Cafea' })).toHaveCount(0);
    await visitFresh(page, 'bonuri');
    await expect(page.getByText('3 bonuri')).toBeVisible();

    // What cannot be imported is refused in Romanian.
    await visitFresh(page, 'setari');
    const input = backup.getByLabel('Fișier de copie de siguranță');
    await input.setInputFiles(newerFormat);
    await expect(backup.getByRole('alert')).toContainText(
      'o versiune mai nouă a aplicației (format 2)',
    );
    await input.setInputFiles({
      name: 'a.json',
      mimeType: 'application/json',
      buffer: Buffer.from('nu e json'),
    });
    await expect(backup.getByRole('alert')).toContainText(
      'Fișierul nu este o copie de siguranță Pretometru',
    );

    expect(foreign(), 'requests that left the origin').toEqual([]);
    expect(problems()).toEqual([]);
  });

  test('deleting a category moves its products to the one chosen', async ({ page }) => {
    const problems = watchForProblems(page);
    await openApp(page, 'setari');
    await seedPriceHistory(page);
    await visitFresh(page, 'setari/categorii');

    const row = page.getByRole('listitem').filter({ hasText: 'Curățenie & menaj' });
    await expect(row).toContainText('1 produs');
    await row.getByRole('button', { name: 'Șterge categoria „Curățenie & menaj”' }).click();
    const question = row.getByRole('group', { name: 'Ștergi categoria „Curățenie & menaj”?' });
    const confirm = question.getByRole('button', { name: 'Șterge și mută' });
    await expect(question.getByLabel('Mută în')).toBeFocused();
    await expect(confirm).toBeDisabled();
    await question.getByLabel('Mută în').selectOption({ label: '📦 Altele' });
    await confirm.click();

    await expect(
      page.getByText(
        'Categoria „Curățenie & menaj” a fost ștearsă; 1 produs și 3 linii de bon au trecut la „Altele”.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Curățenie & menaj' })).toHaveCount(
      0,
    );

    await visitFresh(page, 'produse');
    await expect(
      page.getByRole('region', { name: /Altele/ }).getByRole('link', { name: /Hârtie igienică/ }),
    ).toBeVisible();
    expect(problems()).toEqual([]);
  });

  test('merging two stores moves the receipts to the one that stays', async ({ page }) => {
    const problems = watchForProblems(page);
    await openApp(page, 'setari');
    await seedPriceHistory(page);
    await visitFresh(page, 'setari/magazine');

    const metro = page.getByRole('listitem').filter({ hasText: 'METRO Cluj' });
    await expect(metro).toContainText('1 bon');
    await metro.getByRole('button', { name: 'Unește magazinul „METRO Cluj” cu altul' }).click();
    const question = metro.getByRole('group', { name: 'Unești „METRO Cluj” cu alt magazin?' });
    await question.getByLabel('Păstrează magazinul').selectOption({ index: 1 });
    await question.getByRole('button', { name: 'Unește magazinele' }).click();

    await expect(
      page.getByText(
        'Magazinul „METRO Cluj” a fost unit cu „Kaufland Cluj”: 1 bon a trecut la „Kaufland Cluj”.',
      ),
    ).toBeVisible();
    const kaufland = page.getByRole('listitem').filter({ hasText: 'Kaufland Cluj' });
    await expect(kaufland).toContainText('3 bonuri');
    await expect(page.getByRole('listitem').filter({ hasText: 'METRO Cluj' })).toHaveCount(0);

    await visitFresh(page, 'bonuri');
    const receipts = page.getByRole('list', { name: 'Bonuri' });
    await expect(receipts.getByText('Kaufland Cluj')).toHaveCount(3);
    await expect(receipts.getByText('METRO Cluj')).toHaveCount(0);
    expect(problems()).toEqual([]);
  });
});
