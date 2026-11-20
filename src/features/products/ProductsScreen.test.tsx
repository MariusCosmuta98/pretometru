// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, resetDb, seedWorld } from './testing';

function renderProducts() {
  const router = createMemoryRouter(
    [
      { path: '/produse', lazy: () => import('./ProductsScreen') },
      { path: '/produse/:productId', element: <p>Pagina produsului</p> },
      { path: '/adauga', element: <p>Ecran adăugare</p> },
    ],
    { initialEntries: ['/produse'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

// The screens read the clock for "the last N days"; only Date is faked so IndexedDB keeps running.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Products screen', () => {
  it('invites to add a receipt when there are no products yet', async () => {
    await resetDb();
    renderProducts();

    expect(await screen.findByText('Nu ai încă produse.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Adaugă un bon' }).getAttribute('href')).toBe(
      '/adauga',
    );
  });

  it('lists products by category with the last price, the cheapest store and the trend', async () => {
    const { paper, milk } = await seedWorld();
    renderProducts();

    const household = await screen.findByRole('region', { name: /Curățenie & menaj/ });
    const paperRow = within(household).getByRole('link', { name: /Hârtie igienică/ });
    expect(paperRow.getAttribute('href')).toBe(`/produse/${paper.id}`);
    const text = paperRow.textContent ?? '';
    expect(text).toContain('Ultimul preț: 1,45 lei/rolă (11,60 lei / 8 role)');
    expect(text).toContain('Kaufland · 07.11.2026');
    expect(text).toContain('Cel mai ieftin: METRO 1,30 lei/rolă');
    expect(text).toContain('reducere'); // METRO's price carried a discount
    expect(text).toContain('(20.09.2026)');
    expect(text).toContain('−9,4%'); // Kaufland: 1,60 -> 1,45
    expect(within(paperRow).getByText(/Prețul a scăzut/)).toBeTruthy();

    const dairy = screen.getByRole('region', { name: /Lactate & ouă/ });
    const milkRow = within(dairy).getByRole('link', { name: /Lapte UHT/ });
    expect(milkRow.getAttribute('href')).toBe(`/produse/${milk.id}`);
    expect(milkRow.textContent).toContain('Doar la Kaufland');
  });

  it('puts the categories in their usual order and hides the empty ones', async () => {
    await seedWorld();
    renderProducts();
    await screen.findByRole('region', { name: /Curățenie & menaj/ });

    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['🥛Lactate & ouă(1)', '🧽Curățenie & menaj(1)']);
  });

  it('narrows the list while typing and says so when nothing matches', async () => {
    await seedWorld();
    renderProducts();
    const search = await screen.findByRole('searchbox', { name: 'Caută un produs' });

    fireEvent.change(search, { target: { value: 'lapte' } });
    expect(screen.queryByRole('region', { name: /Curățenie/ })).toBeNull();
    expect(screen.getByRole('region', { name: /Lactate/ })).toBeTruthy();

    fireEvent.change(search, { target: { value: 'xyz' } });
    expect(screen.getByText(/Niciun produs nu se potrivește cu „xyz”/)).toBeTruthy();
  });

  it('follows the sale-price setting: without sale prices METRO is no longer the cheapest', async () => {
    await seedWorld();
    renderProducts();
    const household = await screen.findByRole('region', { name: /Curățenie & menaj/ });
    expect(household.textContent).toContain('Cel mai ieftin: METRO');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Fără prețuri la reducere' }));

    expect(
      await screen.findByText(
        (_content, element) =>
          element?.tagName === 'P' &&
          (element.textContent ?? '').startsWith('Cel mai ieftin: Kaufland'),
      ),
    ).toBeTruthy();
  });

  it('follows the window setting: a shorter window drops the older stores', async () => {
    await seedWorld();
    renderProducts();
    await screen.findByRole('region', { name: /Curățenie & menaj/ });

    fireEvent.change(screen.getByRole('combobox', { name: 'Perioadă de comparație' }), {
      target: { value: '30' },
    });

    const row = await screen.findByRole('link', {
      name: /Hârtie igienică.*Cel mai ieftin: Kaufland/s,
    });
    expect(row.textContent).toContain('1,45 lei/rolă');
  });
});
