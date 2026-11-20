// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/catalog';
import { saveTestReceipt } from '@/catalog/testing';
import { NOW, HOUSEHOLD, seedWorld } from './testing';

// uPlot draws on a canvas, which jsdom does not have: the chart itself is checked in a real browser.
vi.mock('./PriceChart', () => ({ default: () => <div data-testid="price-chart" /> }));

function renderProduct(productId: string) {
  const router = createMemoryRouter(
    [
      { path: '/produse', element: <p>Lista de produse</p> },
      { path: '/produse/:productId', lazy: () => import('./ProductScreen') },
    ],
    { initialEntries: [`/produse/${productId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const heading = (name: string) => screen.findByRole('heading', { level: 2, name });

describe('Product screen', () => {
  it('compares the stores, cheapest first, and flags the sale price', async () => {
    const { paper } = await seedWorld();
    renderProduct(paper.id);
    await heading('Hârtie igienică');

    const highlight = screen.getByText(/Cel mai ieftin în ultimele 90 de zile/);
    expect(highlight.textContent).toContain('METRO, 1,30 lei/rolă');
    expect(highlight.textContent).toContain('reducere');
    expect(highlight.textContent).toContain('(20.09.2026)');

    const table = screen.getByRole('table', { name: /Prețul pe role la fiecare magazin/ });
    const rows = within(table).getAllByRole('row').slice(1); // after the header
    expect(rows.map((row) => within(row).getAllByRole('rowheader')[0]?.textContent)).toEqual([
      'METROcel mai ieftin',
      'Kaufland',
      'Mega Image',
    ]);
    expect(rows[1]?.textContent).toContain('1,45 lei/rolă');
    expect(rows[1]?.textContent).toContain('+11,3%'); // dearer than METRO's 1,30
    expect(rows[2]?.textContent).toContain('2,00 lei/rolă');
    expect(rows[2]?.textContent).toContain('+53,6%');
    expect(rows[0]?.textContent).toContain('—'); // the cheapest is not dearer than itself
  });

  it('shows the price over time on request and lists every purchase newest first', async () => {
    const { paper } = await seedWorld();
    renderProduct(paper.id);

    expect(await screen.findByTestId('price-chart')).toBeTruthy();
    const history = screen.getByRole('region', { name: /Istoric/ });
    const items = within(history).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('p')?.textContent)).toEqual([
      '07.11.2026 · Kaufland',
      '03.11.2026 · Mega Image',
      '01.10.2026 · Kaufland',
      '20.09.2026 · METRO',
    ]);
    expect(items[3]?.textContent).toContain('reducere 3,59 lei');
    const receipt = within(items[0]!).getByRole('link', { name: 'Vezi bonul' });
    expect(receipt.getAttribute('href')).toMatch(/^\/bonuri\/[0-9A-Z]{26}$/);
  });

  it('says "only at X" instead of comparing a product bought at one store', async () => {
    const { milk } = await seedWorld();
    renderProduct(milk.id);
    await heading('Lapte UHT');

    expect(screen.getByText(/Cumpărat doar la/).textContent).toContain('Kaufland');
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Graficul apare după a doua achiziție.')).toBeTruthy();
    expect(screen.queryByTestId('price-chart')).toBeNull();
  });

  it('sets purchases without a pack size aside instead of comparing them', async () => {
    const { db, paper } = await seedWorld();
    await saveTestReceipt(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-10T12:00',
      lines: [{ rawName: 'HARTIE IGIENICA', lineTotalBani: 1600, productId: paper.id }],
    });
    renderProduct(paper.id);

    const note = await screen.findByRole('region', { name: /nu intră în comparație \(1\)/ });
    expect(note.textContent).toContain('10.11.2026 · Lidl');
    expect(screen.queryByText('Lidl', { selector: 'th' })).toBeNull(); // not in the table
  });

  it('answers a product that does not exist', async () => {
    await seedWorld();
    renderProduct('0000000000000000000000000X');
    expect(await screen.findByText('Produsul nu a fost găsit.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Înapoi la produse' }).getAttribute('href')).toBe(
      '/produse',
    );
  });

  it('merges a duplicate into another product and opens the survivor', async () => {
    const { db, paper } = await seedWorld();
    const duplicate = await createProduct(db, {
      name: 'Hârtie igienică 8 role',
      categoryId: HOUSEHOLD,
      baseUnit: 'role',
    });
    const { lines } = await saveTestReceipt(db, {
      chain: 'lidl',
      purchasedAt: '2026-11-12T12:00',
      lines: [
        {
          rawName: 'HARTIE IGIENICA 8ROLE',
          lineTotalBani: 1200,
          pack: { qty: 8, unit: 'role' },
          productId: duplicate.id,
        },
      ],
    });
    renderProduct(duplicate.id);
    await heading('Hârtie igienică 8 role');

    fireEvent.click(screen.getByRole('button', { name: 'Îmbină cu alt produs' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Caută un produs' }), {
      target: { value: 'hartie igienica' },
    });
    fireEvent.click(await screen.findByRole('radio', { name: /^Hârtie igienică$/ }));
    expect(screen.getByText(/„Hârtie igienică 8 role” dispare/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Îmbină' }));

    // the survivor's page now lists the Lidl purchase too
    const history = await screen.findByRole('region', { name: /Istoric \(5\)/ });
    expect(history.textContent).toContain('12.11.2026 · Lidl');
    expect((await db.lines.get(lines[0]!.id))?.productId).toBe(paper.id);
    expect((await db.products.get(duplicate.id))?.deletedAt).toBeDefined();
  });

  it('splits chosen purchases into a new product and opens it', async () => {
    const { db, paper } = await seedWorld();
    renderProduct(paper.id);
    await heading('Hârtie igienică');

    fireEvent.click(screen.getByRole('button', { name: 'Separă achiziții' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Alege achiziția din 03.11.2026 de la Mega Image' }),
    );
    expect(screen.getByText(/1 achiziție aleasă/)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Numele noului produs' }), {
      target: { value: 'Hârtie igienică Mega' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mută achizițiile' }));

    await heading('Hârtie igienică Mega');
    const history = screen.getByRole('region', { name: /Istoric \(1\)/ });
    expect(history.textContent).toContain('03.11.2026 · Mega Image');
    const moved = await db.lines
      .filter(
        (line) =>
          line.rawName === 'HARTIE IGIENICA' && // the Mega line
          line.productId !== paper.id &&
          line.productId !== undefined,
      )
      .count();
    expect(moved).toBe(1);
  });

  it('does not offer to split a product that was never bought', async () => {
    const { db } = await seedWorld();
    const unused = await createProduct(db, { name: 'Nou', categoryId: HOUSEHOLD, baseUnit: 'buc' });
    renderProduct(unused.id);
    await heading('Nou');
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Separă achiziții' }).disabled,
    ).toBe(true);
  });
});
