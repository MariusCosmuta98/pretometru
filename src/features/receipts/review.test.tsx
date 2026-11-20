// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { clearReviewSessions } from '@/import';
import { fakeCatalog } from '@/import/testing';
import { getReceiptWithLines, listActive } from '@/storage';
import {
  appHarness,
  change,
  click,
  field,
  goTo,
  importPdf,
  importPhoto,
  lineNumber,
} from './testing';

const app = appHarness();

const FRUIT_AND_VEG = SEED_CATEGORIES[2];
const GROCERIES = SEED_CATEGORIES[4];

/** The card of a line on the review screen. */
const lineCard = (number: number) => {
  const card = screen.getByRole('heading', { level: 3, name: `Linia ${number}` }).closest('li');
  if (!card) throw new Error(`No card for line ${number}`);
  return card;
};

describe('product mapping', () => {
  it('creates a product from a line, remembers it when confirmed, and maps it by itself next time', async () => {
    const { catalog, expected } = app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router, 'first.pdf', 'first');

    const tomatoes = lineNumber(expected, 'ROSII DEPELATE425ML');
    expect(within(lineCard(tomatoes)).getByText(/Fără produs/)).toBeTruthy();
    click(`Alege produsul, linia ${tomatoes}`);
    const dialog = await screen.findByRole('dialog', { name: `Produs pentru linia ${tomatoes}` });

    // The new-product form starts from what the line says: its name, and 425 ml means litres.
    expect(field('Nume produs').value).toBe('ROSII DEPELATE425ML');
    expect(field('Preț comparat pe').value).toBe('l');
    change('Nume produs', 'Roșii decojite');
    change('Categorie', FRUIT_AND_VEG?.id ?? '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Creează produsul' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const card = lineCard(tomatoes);
    expect(within(card).getByText('Roșii decojite')).toBeTruthy();
    expect(within(card).getByText(/Fructe & legume/)).toBeTruthy();
    const [product] = await app.db.products.toArray();
    expect(product).toMatchObject({
      name: 'Roșii decojite',
      baseUnit: 'l',
      categoryId: FRUIT_AND_VEG?.id,
    });

    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    expect(catalog.remembered).toEqual([
      {
        chain: 'kaufland',
        choices: [
          {
            rawName: 'ROSII DEPELATE425ML',
            productId: product?.id,
            pack: { qty: 425, unit: 'ml' },
          },
        ],
      },
    ]);
    const [stored] = await listActive(app.db.receipts);
    const lines = (await getReceiptWithLines(app.db, stored?.id ?? ''))?.lines ?? [];
    expect(lines.find((line) => line.rawName === 'ROSII DEPELATE425ML')).toMatchObject({
      productId: product?.id,
      categoryId: FRUIT_AND_VEG?.id,
    });

    // The same line on the next receipt needs no help.
    await importPdf(router, 'second.pdf', 'second');
    const again = lineCard(tomatoes);
    expect(within(again).getByText('Roșii decojite')).toBeTruthy();
    expect(
      within(again).getByRole('button', { name: `Schimbă produsul, linia ${tomatoes}` }),
    ).toBeTruthy();
    expect(within(lineCard(tomatoes + 1)).getByText(/Fără produs/)).toBeTruthy();
  });

  it("offers the catalog's suggestions and applies one only when the user accepts it", async () => {
    const catalog = fakeCatalog();
    const chickpeas = await catalog.createProduct(app.db, {
      name: 'Năut',
      categoryId: GROCERIES?.id ?? '',
      baseUnit: 'kg',
    });
    catalog.suggest.set('MAXIM NAUT 400G', [chickpeas]);
    const { expected } = app.install('kaufland-2026-11-07', { catalog });
    const router = app.renderApp('/adauga');
    await importPdf(router);

    const line = lineNumber(expected, 'MAXIM NAUT 400G');
    expect(within(lineCard(line)).getByText(/Fără produs/)).toBeTruthy();
    click(`Acceptă sugestia „Năut”, linia ${line}`);

    const card = lineCard(line);
    expect(within(card).getByText('Năut')).toBeTruthy();
    expect(within(card).queryByText('Poate fi:')).toBeNull();
  });

  it('picks an existing product from a search, and can take it away again', async () => {
    const catalog = fakeCatalog();
    await catalog.createProduct(app.db, {
      name: 'Lapte UHT',
      categoryId: SEED_CATEGORIES[0]?.id ?? '',
      baseUnit: 'l',
    });
    await catalog.createProduct(app.db, {
      name: 'Bere blondă',
      categoryId: SEED_CATEGORIES[7]?.id ?? '',
      baseUnit: 'l',
    });
    const { expected } = app.install('kaufland-2026-11-07', { catalog });
    const router = app.renderApp('/adauga');
    await importPdf(router);

    const line = lineNumber(expected, 'VDR BORS 1L');
    click(`Alege produsul, linia ${line}`);
    const dialog = await screen.findByRole('dialog');
    // Everything is listed until the user types.
    expect(await within(dialog).findByRole('button', { name: 'Alege „Bere blondă”' })).toBeTruthy();
    change('Caută produs', 'lapt');
    await waitFor(() => {
      expect(within(dialog).queryByRole('button', { name: 'Alege „Bere blondă”' })).toBeNull();
    });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Alege „Lapte UHT”' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(lineCard(line)).getByText('Lapte UHT')).toBeTruthy();
    expect(within(lineCard(line)).getByText(/Lactate & ouă/)).toBeTruthy();

    click(`Schimbă produsul, linia ${line}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Fără produs' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(within(lineCard(line)).getByText(/Fără produs/)).toBeTruthy();
  });

  it('refuses a new product without a category', async () => {
    const { expected } = app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);

    click(`Alege produsul, linia ${lineNumber(expected, 'USTUROI')}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Creează produsul' }));
    expect((await screen.findByText('Alege categoria produsului.')).getAttribute('role')).toBe(
      'alert',
    );
    expect(await app.db.products.count()).toBe(0);
  });
});

describe('correcting an OCR misread against the printed total (Mega Image)', () => {
  it('re-checks the sum while the prices are fixed, then confirms', async () => {
    app.install('mega-image-2026-11-03', { kind: 'ocr-text' });
    const router = app.renderApp('/adauga');
    await importPhoto(router, 'mega.jpg');

    // 17,85 + 14,99 + 12,99 + 18,93 = 64,76 against a printed 65,86.
    expect(screen.getByText(/diferență −1,10 lei/)).toBeTruthy();
    const warnings = screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings).getByText('Suma nu se potrivește')).toBeTruthy();

    change('Total linie (lei), linia 1', '17,89');
    expect(await screen.findByText(/diferență −1,06 lei/)).toBeTruthy();
    change('Total linie (lei), linia 4', '19,99');
    await waitFor(() => {
      expect(screen.queryByText('Suma nu se potrivește')).toBeNull();
    });
    expect(screen.getByText(/se potrivesc/)).toBeTruthy();

    click('Confirmă bonul');
    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    const [receipt] = await listActive(app.db.receipts);
    const stored = await getReceiptWithLines(app.db, receipt?.id ?? '');
    expect(stored?.lines.map((line) => line.lineTotalBani)).toEqual([1789, 1499, 1299, 1999]);
  });
});

describe('doubts left over from the import (Lidl OCR)', () => {
  it('stay until the user verifies the line, also after the draft is reopened', async () => {
    app.install('lidl-2026-12-29', { kind: 'ocr-text' });
    const router = app.renderApp('/adauga');
    await importPhoto(router, 'lidl.png');

    const warnings = () => screen.getByRole('region', { name: /Avertismente/ });
    expect(within(warnings()).getByText('Cifre corectate automat · linia 5')).toBeTruthy();
    expect(
      within(warnings()).getByText('Prețul unitar 9,18 a fost corectat la 9,10 (totalul liniei).'),
    ).toBeTruthy();
    expect(within(warnings()).getByText('Cota TVA 11,80% a fost corectată la 11%.')).toBeTruthy();

    // Saved as a draft and reopened in a new session: the doubts are still there.
    click('Salvează ciorna');
    expect(await screen.findByText('Ciorna a fost salvată.')).toBeTruthy();
    const [receipt] = await listActive(app.db.receipts);
    cleanup();
    clearReviewSessions();
    const reopened = app.renderApp(`/bonuri/${receipt?.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Produse (5)' });
    expect(within(warnings()).getByText('Cifre corectate automat · linia 5')).toBeTruthy();

    // Looking at the line settles it; that sticks after saving and reopening.
    click('Am verificat linia 5');
    expect(within(warnings()).queryByText('Cifre corectate automat · linia 5')).toBeNull();
    expect(within(warnings()).getByText('Cota TVA 11,80% a fost corectată la 11%.')).toBeTruthy();
    click('Salvează ciorna');
    expect(await screen.findByText('Ciorna a fost salvată.')).toBeTruthy();
    await goTo(reopened, '/bonuri');
    await goTo(reopened, `/bonuri/${receipt?.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Produse (5)' });
    expect(within(warnings()).queryByText('Cifre corectate automat · linia 5')).toBeNull();
  });
});

describe('a receipt typed in by hand', () => {
  it('needs a date, a total and a line, then can be confirmed', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    fireEvent.click(await screen.findByRole('link', { name: 'Introdu bonul manual' }));
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    expect(router.state.location.pathname).toBe('/bonuri/nou');
    expect(field('Data').value).toBe('2026-11-20');
    expect(await listActive(app.db.receipts)).toEqual([]);

    click('Confirmă bonul');
    const summary = await screen.findByRole('alert');
    expect(
      within(summary).getByText('Totalul bonului: Totalul trebuie să fie mai mare ca 0.'),
    ).toBeTruthy();
    expect(within(summary).getByText('Adaugă cel puțin o linie.')).toBeTruthy();
    expect(document.activeElement).toBe(field('Total bon (lei)'));

    change('Magazin', 'lidl');
    change('Total bon (lei)', '12,5');
    fireEvent.blur(field('Total bon (lei)'));
    expect(field('Total bon (lei)').value).toBe('12,50');

    click('Adaugă linie');
    expect(document.activeElement).toBe(field('Denumire, linia 1'));
    change('Denumire, linia 1', 'Lapte');
    change('Total linie (lei), linia 1', '12,50');
    click('Confirmă bonul');

    expect(await screen.findByText('Bonul a fost confirmat.')).toBeTruthy();
    const [receipt] = await listActive(app.db.receipts);
    expect(receipt).toMatchObject({
      status: 'confirmed',
      totalBani: 1250,
      purchasedAt: '2026-11-20',
      source: { kind: 'manual' },
      extraction: { engine: 'manual' },
    });
    expect(await app.db.stores.get(receipt?.storeId ?? '')).toMatchObject({ chain: 'lidl' });
    expect((await getReceiptWithLines(app.db, receipt?.id ?? ''))?.lines).toMatchObject([
      { rawName: 'Lapte', lineTotalBani: 1250, paidUnitBani: 1250, baseUnit: 'buc' },
    ]);
  });

  it('moves to its own page once saved as a draft', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/bonuri/nou');
    await screen.findByRole('heading', { level: 2, name: 'Detalii bon' });
    change('Total bon (lei)', '5');
    click('Salvează ciorna');

    expect(await screen.findByText('Ciorna a fost salvată.')).toBeTruthy();
    expect(router.state.location.pathname).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
    expect(field('Total bon (lei)').value).toBe('5,00');
    expect((await listActive(app.db.receipts)).map((r) => r.status)).toEqual(['draft']);
  });
});

describe('unsaved edits', () => {
  it('are protected when leaving the screen, and free to leave when there are none', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);
    const reviewPath = router.state.location.pathname;

    change('Total linie (lei), linia 1', '15,60');
    click('Acasă', 'link');
    const dialog = await screen.findByRole('dialog', { name: 'Ai modificări nesalvate' });
    expect(router.state.location.pathname).toBe(reviewPath);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Rămân pe bon' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(field('Total linie (lei), linia 1').value).toBe('15,60');

    click('Acasă', 'link');
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Ai modificări nesalvate' })).getByRole(
        'button',
        { name: 'Ies fără să salvez' },
      ),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    // Nothing was saved behind the user's back.
    const [receipt] = await listActive(app.db.receipts);
    const stored = await getReceiptWithLines(app.db, receipt?.id ?? '');
    expect(stored?.lines[0]?.lineTotalBani).toBe(1557);

    await goTo(router, reviewPath);
    await screen.findByRole('heading', { level: 2, name: 'Produse (18)' });
    click('Acasă', 'link');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('survive a draft being saved and reopened', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);
    change('Denumire, linia 1', 'ROSII DECOJITE 425ML');
    change('Număr document', 'X-1');
    click('Salvează ciorna');
    expect(await screen.findByText('Ciorna a fost salvată.')).toBeTruthy();
    const [receipt] = await listActive(app.db.receipts);

    cleanup();
    app.renderApp(`/bonuri/${receipt?.id}`);
    await screen.findByRole('heading', { level: 2, name: 'Produse (18)' });
    expect(field('Denumire, linia 1').value).toBe('ROSII DECOJITE 425ML');
    expect(field('Număr document').value).toBe('X-1');
    expect(screen.getByText('Ciornă')).toBeTruthy();
  });
});

describe('every control has a name', () => {
  it('labels all fields of the review, so keyboard and screen-reader users can find them', async () => {
    app.install('kaufland-2026-11-07');
    const router = app.renderApp('/adauga');
    await importPdf(router);

    const unnamed = [...document.querySelectorAll('input, select, textarea')].filter((control) => {
      const element = control as HTMLInputElement;
      const hasLabel = (element.labels?.length ?? 0) > 0 || element.getAttribute('aria-label');
      return !hasLabel;
    });
    expect(unnamed).toEqual([]);
    const unlabelled = [...document.querySelectorAll('button')].filter(
      (button) => (button.textContent ?? '').trim() === '' && !button.getAttribute('aria-label'),
    );
    expect(unlabelled).toEqual([]);
  });
});
