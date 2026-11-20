// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/catalog';
import { SEED_CATEGORIES, type Product } from '@/domain';
import { setSetting } from '@/storage';
import {
  resetAppDb,
  saveGroundTruth,
  savePurchase,
  saveRealReceipts,
} from '@/analytics/spending-testing';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAIRY = SEED_CATEGORIES[0]!.id;

function renderHome() {
  const router = createMemoryRouter(
    [
      { path: '/', lazy: () => import('./HomeScreen') },
      { path: '/adauga', element: <p>Ecran adăugare</p> },
      { path: '/bonuri', element: <p>Lista bonurilor</p> },
      { path: '/bonuri/:receiptId', element: <p>Verificarea bonului</p> },
      { path: '/produse/:productId', element: <p>Pagina produsului</p> },
      { path: '/statistici', element: <p>Statistici</p> },
    ],
    { initialEntries: ['/'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

// The screen reads the clock for "this month"; only Date is faked so IndexedDB keeps running.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** The Kaufland receipt of 07.11.2026, Mega Image's of 03.11, METRO's of 12.08 and Lidl's of 29.12.2026. */
async function withRealReceipts() {
  const db = await resetAppDb();
  const saved = await saveRealReceipts(db);
  return { db, saved };
}

describe('Home: first run', () => {
  it('invites to add the first receipt when there is nothing on the device', async () => {
    await resetAppDb();
    renderHome();

    expect(
      await screen.findByRole('heading', { name: 'Bine ai venit la Pretometru' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Adaugă primul bon' }).getAttribute('href')).toBe(
      '/adauga',
    );
    expect(screen.queryByRole('region', { name: /Luna aceasta/ })).toBeNull();
  });

  it('says it is loading before the data is there', async () => {
    await resetAppDb();
    renderHome();

    expect((await screen.findByRole('status')).textContent).toBe('Se încarcă datele…');
    await screen.findByRole('heading', { name: 'Bine ai venit la Pretometru' });
  });
});

describe('Home: the four real receipts', () => {
  it('shows what was paid this month: Kaufland after its voucher plus Mega Image', async () => {
    await withRealReceipts();
    renderHome();

    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('noiembrie 2026');
    expect(month.textContent).toContain('254,65 lei'); // 188,79 + 65,86; Lidl is dated in December
    expect(month.textContent).toContain('2 bonuri confirmate');
    expect(month.textContent).toContain(
      'Niciun bon confirmat în octombrie 2026: nu avem cu ce compara.',
    );
  });

  it('splits the month by category, keeping the visible buckets and the voucher', async () => {
    await withRealReceipts();
    renderHome();

    const card = await screen.findByRole('region', { name: 'Pe categorii' });
    const list = within(card).getByRole('list', {
      name: 'Cheltuieli pe categorii în noiembrie 2026',
    });
    const rows = within(list)
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');

    // Biggest first; the first five categories, and the two buckets that are not categories.
    expect(rows).toHaveLength(7);
    expect(rows[0]).toContain('Fără categorie');
    expect(rows[0]).toContain('69,35 lei'); // Mega Image's four lines and Kaufland's "Delicatese"
    expect(rows[1]).toContain('Bacanie');
    expect(rows[1]).toContain('43,86 lei');
    expect(rows.at(-1)).toContain('Non-produs');
    expect(rows.at(-1)).toContain('0,70 lei'); // the deposit and the carrier bag

    const totals = within(card).getByRole('list', { name: 'Ajustări și total' });
    expect(totals.textContent).toContain('Tichete folosite la plată');
    expect(totals.textContent).toContain('−20,00 lei');
    expect(totals.textContent).toContain('Total plătit254,65 lei');
  });

  it('shows the rest of the categories on request', async () => {
    await withRealReceipts();
    renderHome();
    const card = await screen.findByRole('region', { name: 'Pe categorii' });

    fireEvent.click(within(card).getByRole('button', { name: 'Arată toate categoriile (8)' }));

    const list = within(card).getByRole('list', {
      name: 'Cheltuieli pe categorii în noiembrie 2026',
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(list.textContent).toContain('Casă & bricolaj');
    expect(
      within(card).getByRole('button', { name: 'Arată mai puține' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });

  it('lists the last receipts, newest first, each opening its review', async () => {
    const { saved } = await withRealReceipts();
    const router = renderHome();

    const recent = await screen.findByRole('region', { name: 'Ultimele bonuri' });
    const links = within(recent)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/bonuri/'));

    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      `/bonuri/${saved.lidl!.receipt.id}`, // 29.12.2026: in the future, so first
      `/bonuri/${saved.kaufland!.receipt.id}`,
      `/bonuri/${saved.mega!.receipt.id}`,
      `/bonuri/${saved.metro!.receipt.id}`,
    ]);
    expect(links[0]?.textContent).toContain('29.12.2026');
    expect(links[1]?.textContent).toContain('Kaufland');
    expect(links[1]?.textContent).toContain('208,79 lei');
    expect(links[1]?.textContent).toContain('plătit 188,79 lei'); // the voucher
    expect(links[2]?.textContent).not.toContain('plătit');

    fireEvent.click(links[1]!);
    await screen.findByText('Verificarea bonului');
    expect(router.state.location.pathname).toBe(`/bonuri/${saved.kaufland!.receipt.id}`);
  });

  it('has no price increases to show yet, and says why', async () => {
    await withRealReceipts();
    renderHome();

    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    expect(card.textContent).toContain('ultimele 90 de zile');
    expect(card.textContent).toContain('Nicio creștere de preț în această perioadă');
  });
});

describe('Home: against the previous month', () => {
  it('compares the total and each category with October', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'mega-image-2026-11-03');
    await saveGroundTruth(db, 'kaufland-2026-11-07');
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-12T18:00',
      lines: [
        { lineTotalBani: 12_000, categoryId: DAIRY },
        { lineTotalBani: 8000, categoryId: SEED_CATEGORIES[1]!.id },
      ],
    });
    renderHome();

    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('↑ +54,65 lei (+27,3%)');
    expect(month.textContent).toContain('față de octombrie 2026 (200,00 lei)');

    const card = screen.getByRole('region', { name: 'Pe categorii' });
    const dairy = within(card)
      .getByText(/Lactate & ouă/)
      .closest('li');
    expect(dairy?.textContent).toContain('30,13 lei');
    expect(dairy?.textContent).toContain('octombrie 2026: 120,00 lei');
    const bacanie = within(card)
      .getByText(/Bacanie/)
      .closest('li');
    expect(bacanie?.textContent).toContain('Nimic în octombrie 2026');
  });

  it('reads a smaller month as a fall', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'mega-image-2026-11-03');
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-12T18:00',
      lines: [{ lineTotalBani: 10_000 }],
    });
    renderHome();

    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('↓ −34,14 lei (−34,1%)');
  });

  it('says so when this month has no receipt yet, and still shows the other cards', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'metro-invoice-2026-08-12');
    await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-02',
      status: 'draft',
      lines: [{ lineTotalBani: 500 }],
    });
    renderHome();

    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('0,00 lei');
    expect(month.textContent).toContain('Niciun bon confirmat luna aceasta');
    expect(screen.getByRole('region', { name: 'Pe categorii' }).textContent).toContain(
      'Niciun bon confirmat în noiembrie 2026.',
    );
    expect(screen.getByRole('region', { name: 'Ultimele bonuri' })).toBeTruthy();
  });
});

describe('Home: a new day', () => {
  it('reads "this month" again when the app comes back after the month changed', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'mega-image-2026-11-03');
    await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-12-02',
      lines: [{ lineTotalBani: 1000 }],
    });
    renderHome();
    const november = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(november.textContent).toContain('noiembrie 2026');
    expect(november.textContent).toContain('65,86 lei');

    vi.setSystemTime(new Date('2026-12-05T08:00:00Z')); // the installed app was open in the background
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => {
      const month = screen.getByRole('region', { name: /Luna aceasta/ });
      expect(month.textContent).toContain('decembrie 2026');
      expect(month.textContent).toContain('10,00 lei');
    });
  });
});

describe('Home: a receipt dated in the future', () => {
  it('says that it is not part of this month, and still lists it', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'lidl-2026-12-29');
    renderHome();

    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('0,00 lei');
    expect(month.textContent).toContain('Niciun bon confirmat luna aceasta');
    expect(
      screen.getByText('Un bon are data în viitor (decembrie 2026) și nu intră în luna aceasta.'),
    ).toBeTruthy();
    const recent = screen.getByRole('region', { name: 'Ultimele bonuri' });
    expect(within(recent).getByRole('link', { name: /Lidl/ }).textContent).toContain('29.12.2026');
  });

  it('keeps quiet when no receipt is dated after this month', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'metro-invoice-2026-08-12');
    await saveGroundTruth(db, 'kaufland-2026-11-07');
    renderHome();

    await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(screen.queryByText(/au data în viitor|Un bon are data în viitor/)).toBeNull();
  });
});

describe('Home: drafts', () => {
  it('marks a draft, offers to review it and does not count it', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'mega-image-2026-11-03');
    const draft = await saveGroundTruth(db, 'kaufland-2026-11-07', { status: 'draft' });
    renderHome();

    expect(await screen.findByText(/Ai o ciornă de verificat\./)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Vezi bonurile' }).getAttribute('href')).toBe(
      '/bonuri',
    );
    const month = screen.getByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('65,86 lei');
    expect(month.textContent).toContain('1 bon confirmat');

    const recent = screen.getByRole('region', { name: 'Ultimele bonuri' });
    const link = within(recent).getByRole('link', { name: /Kaufland/ });
    expect(link.getAttribute('href')).toBe(`/bonuri/${draft.receipt.id}`);
    expect(link.textContent).toContain('Ciornă');
  });
});

describe('Home: price increases', () => {
  async function withIncrease() {
    const db = await resetAppDb();
    const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: DAIRY, baseUnit: 'l' });
    const line = (lineTotalBani: number) => ({
      rawName: 'LAPTE UHT 1L',
      lineTotalBani,
      productId: milk.id,
      pack: { qty: 1, unit: 'l' as const },
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-01T09:00',
      lines: [line(500)],
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T09:00',
      lines: [line(600)],
    });
    return { db, milk };
  }

  it('lists the products that got dearer in the window, biggest first', async () => {
    const { milk } = await withIncrease();
    renderHome();

    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    const link = within(card).getByRole('link', { name: /Lapte UHT/ });
    expect(link.getAttribute('href')).toBe(`/produse/${milk.id}`);
    expect(link.textContent).toContain('+20,0%');
    expect(link.textContent).toContain('Kaufland · 5,00 → 6,00 lei/l');
  });

  it('follows the comparison window of the settings', async () => {
    const { db } = await withIncrease();
    renderHome();
    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    expect(within(card).getByRole('link', { name: /Lapte UHT/ })).toBeTruthy();

    await setSetting(db, 'priceWindowDays', 10); // the later purchase is 13 days old

    await waitFor(() => {
      expect(card.textContent).toContain('ultimele 10 zile');
      expect(card.textContent).toContain('Nicio creștere de preț în această perioadă');
    });
  });

  it('marks a price that was only reduced: a promotion that ended reads as an increase', async () => {
    const db = await resetAppDb();
    const milk = await createProduct(db, { name: 'Lapte UHT', categoryId: DAIRY, baseUnit: 'l' });
    const line = (lineTotalBani: number, discountBani = 0) => ({
      rawName: 'LAPTE UHT 1L',
      lineTotalBani,
      discountBani,
      productId: milk.id,
      pack: { qty: 1, unit: 'l' as const },
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-01T09:00',
      lines: [line(400, 100)],
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T09:00',
      lines: [line(500)],
    });
    renderHome();

    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    const link = within(card).getByRole('link', { name: /Lapte UHT/ });
    expect(link.textContent).toContain('+25,0%');
    expect(link.textContent).toContain('preț anterior la reducere');

    await setSetting(db, 'excludeDiscountedPrices', true);
    await waitFor(() => {
      expect(card.textContent).toContain('Nicio creștere de preț în această perioadă');
    });
  });

  it('writes the window in Romanian, a single day included', async () => {
    const { db } = await withIncrease();
    renderHome();
    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    expect(card.textContent).toContain('ultimele 90 de zile');

    await setSetting(db, 'priceWindowDays', 1);

    await waitFor(() => {
      expect(card.textContent).toContain('Văzute în ultima zi,');
    });
  });

  it('lists the five biggest and counts all of them, with the "de" Romanian wants from 20', async () => {
    const db = await resetAppDb();
    const products: Product[] = [];
    for (let i = 0; i < 21; i += 1) {
      products.push(
        await createProduct(db, {
          name: `Produs ${String(i + 1).padStart(2, '0')}`,
          categoryId: DAIRY,
          baseUnit: 'l',
        }),
      );
    }
    const lines = (price: (i: number) => number) =>
      products.map((product, i) => ({
        rawName: `ARTICOL ${i + 1}`,
        lineTotalBani: price(i),
        productId: product.id,
        pack: { qty: 1, unit: 'l' as const },
      }));
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-10-01T09:00',
      lines: lines(() => 500),
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T09:00',
      lines: lines((i) => 510 + 10 * i),
    });
    renderHome();

    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    const list = within(card).getByRole('list', { name: 'Cele mai mari creșteri de preț' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toContain('Produs 21');
    expect(
      within(card).getByRole('link', { name: 'Toate cele 21 de creșteri' }).getAttribute('href'),
    ).toBe('/statistici');
  });

  it('follows new receipts while it is open', async () => {
    const { db } = await withIncrease();
    renderHome();
    const month = await screen.findByRole('region', { name: /Luna aceasta/ });
    expect(month.textContent).toContain('6,00 lei');

    await savePurchase(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-18T10:00',
      lines: [{ lineTotalBani: 10_000 }],
    });

    await waitFor(() => {
      expect(month.textContent).toContain('106,00 lei');
    });
  });
});
