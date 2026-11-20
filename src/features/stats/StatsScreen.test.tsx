// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetAppDb,
  saveGroundTruth,
  savePurchase,
  saveRealReceipts,
} from '@/analytics/spending-testing';
import { createProduct } from '@/catalog';
import { SEED_CATEGORIES, type Product } from '@/domain';
import { getSetting } from '@/storage';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAIRY = SEED_CATEGORIES[0]!.id;

function renderStats(path = '/statistici') {
  const router = createMemoryRouter(
    [
      { path: '/statistici', lazy: () => import('./StatsScreen') },
      { path: '/adauga', element: <p>Ecran adăugare</p> },
      { path: '/produse/:productId', element: <p>Pagina produsului</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

// The screen reads the clock for "the last N months"; only Date is faked so IndexedDB keeps running.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const rowsOf = (list: HTMLElement) =>
  within(list)
    .getAllByRole('listitem')
    .map((row) => row.textContent ?? '');

describe('Statistics: nothing to show', () => {
  it('invites to add a receipt when none is confirmed, drafts do not count', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'kaufland-2026-11-07', { status: 'draft' });
    renderStats();

    expect(await screen.findByText('Nu ai încă bonuri confirmate.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Adaugă un bon' }).getAttribute('href')).toBe(
      '/adauga',
    );
    expect(screen.queryByRole('group', { name: 'Perioadă' })).toBeNull();
  });

  it('says it is loading before the data is there', async () => {
    await resetAppDb();
    renderStats();

    expect((await screen.findByRole('status')).textContent).toBe('Se încarcă statisticile…');
    await screen.findByText('Nu ai încă bonuri confirmate.');
  });
});

describe('Statistics: the four real receipts', () => {
  async function seed() {
    const db = await resetAppDb();
    const saved = await saveRealReceipts(db);
    return { db, saved };
  }

  it('covers the last six months by default: METRO and November, not the Lidl receipt of December', async () => {
    await seed();
    renderStats();

    const summary = await screen.findByRole('region', { name: /Perioada/ });
    expect(summary.textContent).toContain('iunie 2026 – noiembrie 2026');
    expect(summary.textContent).toContain('618,06 lei'); // 363,41 + 188,79 + 65,86
    expect(summary.textContent).toContain('3 bonuri confirmate');
    expect(screen.getByRole('button', { name: '6 luni' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('says that a receipt dated in the future is left out of a "last N months" period', async () => {
    await seed();
    renderStats();

    expect(
      await screen.findByText(
        'Un bon are data în viitor (decembrie 2026) și nu intră în această perioadă. Îl găsești la „Tot”.',
      ),
    ).toBeTruthy();
  });

  it('lists the months newest first, the empty ones too', async () => {
    await seed();
    renderStats();

    const card = await screen.findByRole('region', { name: 'Pe luni' });
    const rows = rowsOf(within(card).getByRole('list', { name: 'Cheltuieli pe luni' }));

    expect(rows).toEqual([
      'noiembrie 2026254,65 lei2 bonuri',
      'octombrie 20260,00 leiNiciun bon',
      'septembrie 20260,00 leiNiciun bon',
      'august 2026363,41 lei1 bon',
      'iulie 20260,00 leiNiciun bon',
      'iunie 20260,00 leiNiciun bon',
    ]);
  });

  it('splits the period by category, with the shares and what makes the list add up', async () => {
    await seed();
    renderStats();

    const card = await screen.findByRole('region', { name: 'Pe categorii' });
    const rows = rowsOf(within(card).getByRole('list', { name: 'Cheltuieli pe categorii' }));

    expect(rows[0]).toContain('Fără categorie'); // all of METRO, Mega Image and a part of Kaufland
    expect(rows[0]).toContain('432,77 lei');
    expect(rows[0]).toContain('68% din cheltuieli');
    expect(rows).toHaveLength(10);
    expect(rows.at(-1)).toContain('Non-produs');
    expect(rows.at(-1)).toContain('0,70 lei');
    expect(rows.at(-1)).toContain('<1% din cheltuieli'); // 0,1 %: a share that rounds to nothing is not "0%"

    const totals = within(card).getByRole('list', { name: 'Ajustări și total' });
    expect(totals.textContent).toContain('Tichete folosite la plată−20,00 lei');
    expect(totals.textContent).toContain('Rotunjiri și diferențe−0,01 lei'); // METRO's 363,42 against 363,41
    expect(totals.textContent).toContain('Total plătit618,06 lei');
  });

  it('splits the period by store, the biggest first', async () => {
    await seed();
    renderStats();

    const card = await screen.findByRole('region', { name: 'Pe magazine' });
    const rows = rowsOf(within(card).getByRole('list', { name: 'Cheltuieli pe magazine' }));

    expect(rows).toEqual([
      'METRO363,41 lei1 bon · 59% din total',
      'Kaufland188,79 lei1 bon · 31% din total',
      'Mega Image65,86 lei1 bon · 11% din total',
    ]);
  });

  it('shows everything under "Tot", the December receipt in its own month', async () => {
    await seed();
    const router = renderStats();
    await screen.findByRole('region', { name: /Perioada/ });

    fireEvent.click(screen.getByRole('button', { name: 'Tot' }));

    const summary = await screen.findByRole('region', { name: /august 2026 – decembrie 2026/ });
    expect(summary.textContent).toContain('679,73 lei');
    expect(summary.textContent).toContain('4 bonuri confirmate');
    expect(router.state.location.search).toBe('?perioada=tot');
    expect(screen.queryByText(/au data în viitor|Un bon are data în viitor/)).toBeNull();

    const months = screen.getByRole('list', { name: 'Cheltuieli pe luni' });
    expect(rowsOf(months)).toEqual([
      'decembrie 202661,67 lei1 bon',
      'noiembrie 2026254,65 lei2 bonuri',
      'august 2026363,41 lei1 bon',
    ]);
  });

  it('opens on the period of the address and goes back to the default without a parameter', async () => {
    await seed();
    const router = renderStats('/statistici?perioada=3');

    const summary = await screen.findByRole('region', { name: /Perioada/ });
    expect(summary.textContent).toContain('septembrie 2026 – noiembrie 2026');
    expect(summary.textContent).toContain('254,65 lei');

    fireEvent.click(screen.getByRole('button', { name: '6 luni' }));

    await waitFor(() => {
      expect(screen.getByRole('region', { name: /Perioada/ }).textContent).toContain(
        'iunie 2026 – noiembrie 2026',
      );
    });
    expect(router.state.location.search).toBe('');
  });

  it('falls back to the default period for a parameter it does not know', async () => {
    await seed();
    renderStats('/statistici?perioada=banane');

    const summary = await screen.findByRole('region', { name: /Perioada/ });
    expect(summary.textContent).toContain('iunie 2026 – noiembrie 2026');
  });

  it('moves the period to the new month when the app comes back after midnight', async () => {
    await seed();
    renderStats();
    const summary = await screen.findByRole('region', { name: /Perioada/ });
    expect(summary.textContent).toContain('iunie 2026 – noiembrie 2026');

    vi.setSystemTime(new Date('2026-12-05T08:00:00Z')); // the installed app was open in the background
    window.dispatchEvent(new Event('focus'));

    await waitFor(() => {
      const next = screen.getByRole('region', { name: /Perioada/ });
      expect(next.textContent).toContain('iulie 2026 – decembrie 2026');
      expect(next.textContent).toContain('679,73 lei'); // the Lidl receipt is no longer in the future
    });
    expect(screen.queryByText(/Un bon are data în viitor/)).toBeNull();
  });

  it('says so when the chosen period has no receipt, and keeps the picker', async () => {
    const db = await resetAppDb();
    await saveGroundTruth(db, 'metro-invoice-2026-08-12');
    renderStats('/statistici?perioada=3');

    expect(await screen.findByText('Niciun bon confirmat în perioada aleasă.')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Perioadă' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Pe luni' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Creșteri de preț' })).toBeTruthy();
  });
});

describe('Statistics: price increases in detail', () => {
  /**
   * `count` products bought twice at Kaufland, 5,00 lei per litre and then 5,10, 5,20, ... (+2 %,
   * +4 %, ...). The purchases are on 01.10 and 07.11 unless said otherwise.
   */
  async function seedIncreases(count = 1, dates: [string, string] = ['2026-10-01', '2026-11-07']) {
    const db = await resetAppDb();
    const products: Product[] = [];
    for (let i = 0; i < count; i += 1) {
      products.push(
        await createProduct(db, {
          name: `Produs ${String(i + 1).padStart(2, '0')}`,
          categoryId: DAIRY,
          baseUnit: 'l',
        }),
      );
    }
    const lines = (total: (i: number) => number) =>
      products.map((product, i) => ({
        rawName: `ARTICOL ${i + 1}`,
        lineTotalBani: total(i),
        productId: product.id,
        pack: { qty: 1, unit: 'l' as const },
      }));
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: `${dates[0]}T09:00`,
      lines: lines(() => 500),
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: `${dates[1]}T09:00`,
      lines: lines((i) => 500 + 10 * (i + 1)),
    });
    return { db, products };
  }

  it('shows both prices with their dates, the move in money and in percent', async () => {
    const { products } = await seedIncreases();
    renderStats();

    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    const link = within(card).getByRole('link', { name: /Produs 01/ });
    expect(link.getAttribute('href')).toBe(`/produse/${products[0]!.id}`);
    expect(link.textContent).toContain('+2,0%');
    expect(link.textContent).toContain('Kaufland · 5,00 → 5,10 lei/l (+0,10 lei/l)');
    expect(link.textContent).toContain('01.10.2026 → 07.11.2026');
    expect(card.textContent).toContain('ultimele 90 de zile');
  });

  it('lists ten increases and the rest on request, the biggest first', async () => {
    await seedIncreases(12);
    renderStats();
    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    const list = within(card).getByRole('list', { name: 'Creșteri de preț' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toContain('Produs 12');

    fireEvent.click(within(card).getByRole('button', { name: 'Arată toate cele 12 creșteri' }));

    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    expect(within(card).getByRole('button', { name: 'Arată mai puține' })).toBeTruthy();
  });

  it('changes the comparison window, which every screen shares, and follows it', async () => {
    // The later purchase is 61 days old: inside the default window of 90 days, outside 30.
    const { db } = await seedIncreases(1, ['2026-08-01', '2026-09-20']);
    renderStats();
    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    expect(within(card).getByRole('link', { name: /Produs 01/ })).toBeTruthy();

    fireEvent.change(within(card).getByRole('combobox', { name: 'Perioadă de comparație' }), {
      target: { value: '30' },
    });

    await waitFor(() => {
      expect(card.textContent).toContain('ultimele 30 de zile');
      expect(card.textContent).toContain('Nicio creștere de preț în această perioadă');
    });
    expect(await getSetting(db, 'priceWindowDays')).toBe(30);
  });

  it('can leave sale prices out', async () => {
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
      lines: [line(400, 100)], // a sale price
    });
    await savePurchase(db, {
      chain: 'kaufland',
      purchasedAt: '2026-11-07T09:00',
      lines: [line(500)],
    });
    renderStats();
    const card = await screen.findByRole('region', { name: 'Creșteri de preț' });
    expect(within(card).getByRole('link', { name: /Lapte UHT/ }).textContent).toContain(
      'preț anterior la reducere',
    );

    fireEvent.click(within(card).getByRole('checkbox', { name: 'Fără prețuri la reducere' }));

    await waitFor(() => {
      expect(card.textContent).toContain('Nicio creștere de preț în această perioadă');
    });
    expect(await getSetting(db, 'excludeDiscountedPrices')).toBe(true);
  });
});
