// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addProductToList, archiveList, createList, setItemChecked } from '@/lists';
import { listActive } from '@/storage';
import { NOW, seedWorld } from './testing';

// uPlot draws on a canvas, which jsdom does not have: the chart itself is checked in a real browser.
vi.mock('./PriceChart', () => ({ default: () => <div data-testid="price-chart" /> }));

function renderProduct(productId: string) {
  const router = createMemoryRouter(
    [
      { path: '/liste/:listId', element: <p>Ecranul listei</p> },
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

async function openPanel() {
  await screen.findByRole('heading', { level: 2, name: 'Hârtie igienică' });
  const trigger = screen.getByRole('button', { name: 'Adaugă pe listă' });
  fireEvent.click(trigger);
  return { trigger, form: await screen.findByRole('form', { name: 'Adaugă pe listă' }) };
}

describe('Product screen: Adaugă pe listă', () => {
  it('puts the product on the newest list, which is preselected, and links to that list', async () => {
    const { db, paper } = await seedWorld();
    await createList(db, 'Veche');
    const fresh = await createList(db, 'Nouă');
    renderProduct(paper.id);
    const { trigger, form } = await openPanel();

    const select = within(form).getByLabelText<HTMLSelectElement>('Lista');
    expect(document.activeElement).toBe(select);
    expect(select.value).toBe(fresh.id);
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Nouă',
      'Veche',
      'Listă nouă…',
    ]);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă' }));

    const status = await screen.findByText(/Adăugat pe lista „Nouă”\./);
    expect(within(status).getByRole('link', { name: 'Deschide lista' }).getAttribute('href')).toBe(
      `/liste/${fresh.id}`,
    );
    expect(screen.queryByRole('form', { name: 'Adaugă pe listă' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const items = await listActive(db.listItems);
    expect(items).toMatchObject([
      { listId: fresh.id, productId: paper.id, label: 'Hârtie igienică' },
    ]);
  });

  it('adds it to the list the user picks, and offers only the lists that are in use', async () => {
    const { db, paper } = await seedWorld();
    const old = await createList(db, 'Veche');
    await createList(db, 'Nouă');
    const archived = await createList(db, 'Arhivată');
    await archiveList(db, archived.id);
    renderProduct(paper.id);
    const { form } = await openPanel();

    const select = within(form).getByLabelText<HTMLSelectElement>('Lista');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Nouă',
      'Veche',
      'Listă nouă…',
    ]);
    fireEvent.change(select, { target: { value: old.id } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă' }));

    expect(await screen.findByText(/Adăugat pe lista „Veche”\./)).toBeTruthy();
    expect(await listActive(db.listItems)).toMatchObject([{ listId: old.id, productId: paper.id }]);
  });

  it('starts a new list with the product when there is no list yet', async () => {
    const { db, paper } = await seedWorld();
    renderProduct(paper.id);
    const { form } = await openPanel();

    expect(within(form).queryByLabelText('Lista')).toBeNull();
    const name = within(form).getByLabelText('Numele listei noi');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: ' Cumpărături ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă' }));

    expect(await screen.findByText(/Adăugat pe lista „Cumpărături”\./)).toBeTruthy();
    const [list] = await listActive(db.lists);
    expect(list?.name).toBe('Cumpărături');
    expect(await listActive(db.listItems)).toMatchObject([
      { listId: list?.id, productId: paper.id },
    ]);
  });

  it('starts a new list from the "Listă nouă…" choice, and asks for its name first', async () => {
    const { db, paper } = await seedWorld();
    await createList(db, 'Veche');
    renderProduct(paper.id);
    const { form } = await openPanel();

    fireEvent.change(within(form).getByLabelText('Lista'), { target: { value: 'new' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă' }));

    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toBe('Scrie un nume pentru lista nouă.');
    expect(document.activeElement).toBe(within(form).getByLabelText('Numele listei noi'));
    expect(await db.lists.count()).toBe(1);

    fireEvent.change(within(form).getByLabelText('Numele listei noi'), {
      target: { value: 'Weekend' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă' }));

    expect(await screen.findByText(/Adăugat pe lista „Weekend”\./)).toBeTruthy();
    expect(await db.lists.count()).toBe(2);
  });

  it('says so when the product is already on the list, and when it was checked', async () => {
    const { db, paper } = await seedWorld();
    const list = await createList(db, 'Cumpărături');
    const { item } = await addProductToList(db, list.id, paper.id);
    renderProduct(paper.id);

    const first = await openPanel();
    fireEvent.click(within(first.form).getByRole('button', { name: 'Adaugă' }));
    expect(
      await screen.findByText(/„Hârtie igienică” e deja pe lista „Cumpărături”\./),
    ).toBeTruthy();
    expect(await db.listItems.count()).toBe(1);

    await setItemChecked(db, item.id, true);
    fireEvent.click(screen.getByRole('button', { name: 'Adaugă pe listă' }));
    const second = await screen.findByRole('form', { name: 'Adaugă pe listă' });
    fireEvent.click(within(second).getByRole('button', { name: 'Adaugă' }));
    expect(
      await screen.findByText(/era bifat pe lista „Cumpărături”: l-am pus din nou de cumpărat\./),
    ).toBeTruthy();
    expect((await db.listItems.get(item.id))?.checked).toBe(false);
  });

  it('closes with "Anulează" or Escape, adds nothing and gives the focus back to the button', async () => {
    const { db, paper } = await seedWorld();
    await createList(db, 'Cumpărături');
    renderProduct(paper.id);
    const { trigger, form } = await openPanel();

    fireEvent.click(within(form).getByRole('button', { name: 'Anulează' }));
    expect(screen.queryByRole('form', { name: 'Adaugă pe listă' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    const again = await screen.findByRole('form', { name: 'Adaugă pe listă' });
    fireEvent.keyDown(within(again).getByLabelText('Lista'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Adaugă pe listă' })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(await db.listItems.count()).toBe(0);
  });
});
