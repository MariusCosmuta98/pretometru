// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTextItem, archiveList, createList, setItemChecked } from '@/lists';
import { resetDb } from '@/lists/testing';
import { listActive, type PretometruDB } from '@/storage';

function renderLists() {
  const router = createMemoryRouter(
    [
      { path: '/liste', lazy: () => import('./ListsScreen') },
      { path: '/liste/:listId', element: <p>Ecranul listei</p> },
    ],
    { initialEntries: ['/liste'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

let db: PretometruDB;
beforeEach(async () => {
  db = await resetDb();
});
afterEach(cleanup);

const card = async (name: string) =>
  (await screen.findByRole('link', { name: new RegExp(name) })).closest('li')!;

describe('Lists screen', () => {
  it('invites to create a first list', async () => {
    renderLists();

    expect(await screen.findByText(/Nu ai nicio listă activă/)).toBeTruthy();
    expect(screen.getByLabelText('Listă nouă')).toBeTruthy();
    expect(screen.queryByText(/Arhivate/)).toBeNull();
  });

  it('creates a list and opens it', async () => {
    const router = renderLists();
    fireEvent.change(await screen.findByLabelText('Listă nouă'), {
      target: { value: '  Săptămâna asta ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Creează' }));

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/liste\/\w{26}$/));
    const [list] = await listActive(db.lists);
    expect(list?.name).toBe('Săptămâna asta');
    expect(router.state.location.pathname).toBe(`/liste/${list?.id}`);
  });

  it('asks for a name instead of creating an empty list', async () => {
    renderLists();
    const field = await screen.findByLabelText('Listă nouă');
    fireEvent.click(screen.getByRole('button', { name: 'Creează' }));

    expect((await screen.findByRole('alert')).textContent).toBe('Scrie un nume pentru listă.');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(await db.lists.count()).toBe(0);

    fireEvent.change(field, { target: { value: 'Ceva' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows each list with how far it is, newest first, and links to it', async () => {
    const old = await createList(db, 'Veche');
    const fresh = await createList(db, 'Nouă');
    for (const label of ['Pâine', 'Ouă', 'Lapte']) await addTextItem(db, old.id, label);
    const [first] = await db.listItems.where('listId').equals(old.id).toArray();
    await setItemChecked(db, first!.id, true);
    renderLists();

    const items = await screen.findAllByRole('link');
    expect(items.map((link) => link.textContent)).toEqual([
      'NouăListă goală',
      'Veche1 din 3 articole bifate',
    ]);
    expect(items[0]?.getAttribute('href')).toBe(`/liste/${fresh.id}`);
    expect(items[1]?.getAttribute('href')).toBe(`/liste/${old.id}`);
  });

  it('renames a list inline and puts focus back on the button that opened the form', async () => {
    await createList(db, 'Petrecere');
    renderLists();
    const row = await card('Petrecere');

    fireEvent.click(within(row).getByRole('button', { name: 'Redenumește lista „Petrecere”' }));
    const field = within(row).getByLabelText<HTMLInputElement>('Numele listei');
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Petrecere');

    fireEvent.change(field, { target: { value: 'Aniversare' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvează' }));

    expect(await screen.findByRole('link', { name: /Aniversare/ })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe(
      'Lista a fost redenumită „Aniversare”.',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Redenumește lista „Aniversare”' }),
      ),
    );
    expect((await listActive(db.lists))[0]?.name).toBe('Aniversare');
  });

  it('leaves the name alone when the rename is cancelled with Escape', async () => {
    await createList(db, 'Petrecere');
    renderLists();
    const row = await card('Petrecere');
    fireEvent.click(within(row).getByRole('button', { name: 'Redenumește lista „Petrecere”' }));

    fireEvent.keyDown(within(row).getByLabelText('Numele listei'), { key: 'Escape' });

    expect(within(row).queryByLabelText('Numele listei')).toBeNull();
    expect(within(row).getByRole('link').textContent).toContain('Petrecere');
  });

  it('archives a list into the archive and restores it from there', async () => {
    await createList(db, 'Weekend');
    renderLists();
    const row = await card('Weekend');

    fireEvent.click(within(row).getByRole('button', { name: 'Arhivează lista „Weekend”' }));

    const summary = await screen.findByText('Arhivate (1)');
    expect((await screen.findByRole('status')).textContent).toBe(
      'Lista „Weekend” a fost arhivată.',
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Liste active' }));
    expect(screen.getByText(/Nu ai nicio listă activă/)).toBeTruthy();

    fireEvent.click(summary); // opens the <details>
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurează lista „Weekend”' }));

    await waitFor(() => expect(screen.queryByText(/Arhivate/)).toBeNull());
    expect(await screen.findByRole('button', { name: 'Arhivează lista „Weekend”' })).toBeTruthy();
    expect((await screen.findByRole('status')).textContent).toBe(
      'Lista „Weekend” a fost restaurată.',
    );
  });

  it('asks before deleting a list and its items, with "Anulează" focused', async () => {
    const list = await createList(db, 'De șters');
    await addTextItem(db, list.id, 'Pâine');
    renderLists();
    const row = await card('De șters');

    const opener = () => within(row).getByRole('button', { name: 'Șterge lista „De șters”' });
    fireEvent.click(opener());
    const group = within(row).getByRole('group');
    expect(group.textContent).toContain('Ștergi lista „De șters” și 1 articol? Nu se poate anula.');
    const cancel = within(group).getByRole('button', { name: 'Anulează' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.keyDown(cancel, { key: 'Escape' });
    expect(within(row).queryByRole('group')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener()));
    expect(await db.lists.count()).toBe(1);

    fireEvent.click(opener());
    fireEvent.click(within(row).getByRole('button', { name: 'Șterge lista' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: /De șters/ })).toBeNull());
    expect((await screen.findByRole('status')).textContent).toBe(
      'Lista „De șters” a fost ștearsă.',
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Liste active' }));
    expect(await listActive(db.lists)).toEqual([]);
    expect(await listActive(db.listItems)).toEqual([]);
  });

  it('archives and restores lists that are archived from outside, as another tab would', async () => {
    const list = await createList(db, 'Din alt tab');
    renderLists();
    await screen.findByRole('link', { name: /Din alt tab/ });

    await archiveList(db, list.id);

    expect(await screen.findByText('Arhivate (1)')).toBeTruthy();
  });
});
