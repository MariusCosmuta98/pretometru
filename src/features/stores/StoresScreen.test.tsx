// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addReceipt, addStore, resetDb } from '@/admin/testing';
import { getActive, type PretometruDB } from '@/storage';

beforeAll(async () => {
  // Load the lazy route modules before the first test waits for them.
  await import('./StoresScreen');
});

let db: PretometruDB;
beforeEach(async () => {
  db = await resetDb();
});
afterEach(cleanup);

function renderScreen() {
  const router = createMemoryRouter(
    [
      { path: '/setari/magazine', lazy: () => import('./StoresScreen') },
      { path: '/setari', element: <p>Ecranul Setări</p> },
    ],
    { initialEntries: ['/setari/magazine'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const item = async (name: string) =>
  (await screen.findByRole('button', { name: `Redenumește magazinul „${name}”` })).closest('li')!;

const names = () =>
  screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent ?? '');

const expectFocus = (element: HTMLElement) =>
  waitFor(() => expect(document.activeElement).toBe(element));

/** The sentence is announced in the status region. */
async function expectStatus(text: string) {
  expect((await screen.findByText(text)).getAttribute('role')).toBe('status');
}

/** Kaufland Cluj with 3 receipts, a second Kaufland with 1, METRO with 1 and an unused Lidl. */
async function world() {
  const cluj = await addStore(db, {
    name: 'Kaufland Cluj',
    branchCode: '1234',
    city: 'Cluj-Napoca',
  });
  const other = await addStore(db, { name: 'Kaufland Oradea', city: 'Oradea' });
  const metro = await addStore(db, { chain: 'metro', name: 'METRO' });
  const lidl = await addStore(db, { chain: 'lidl', name: 'Lidl' });
  const clujReceipts = [
    await addReceipt(db, cluj.id),
    await addReceipt(db, cluj.id),
    await addReceipt(db, cluj.id, { status: 'draft' }),
  ];
  await addReceipt(db, other.id);
  await addReceipt(db, metro.id);
  return { cluj, other, metro, lidl, clujReceipts };
}

describe('stores screen', () => {
  it('lists the stores with chain, branch, city and how many receipts each has', async () => {
    await world();
    renderScreen();

    const cluj = await item('Kaufland Cluj');
    expect(within(cluj).getByText('Kaufland · Magazin 1234 · Cluj-Napoca')).toBeTruthy();
    expect(within(cluj).getByText('3 bonuri')).toBeTruthy();
    expect(within(await item('Kaufland Oradea')).getByText('1 bon')).toBeTruthy();
    expect(within(await item('Lidl')).getByText('Niciun bon')).toBeTruthy();
    expect(names()).toEqual(['Kaufland Cluj', 'Kaufland Oradea', 'Lidl', 'METRO']);
    expect(screen.getByRole('link', { name: '← Setări' }).getAttribute('href')).toBe('/setari');
  });

  it('says there is nothing to manage before the first receipt', async () => {
    renderScreen();

    expect(await screen.findByText(/Nu ai încă niciun magazin/)).toBeTruthy();
  });

  it('renames a store and puts focus back on the button that opened the form', async () => {
    const { cluj } = await world();
    renderScreen();
    const row = await item('Kaufland Cluj');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Redenumește magazinul „Kaufland Cluj”' }),
    );

    const field = within(row).getByLabelText<HTMLInputElement>('Numele magazinului');
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Kaufland Cluj');
    fireEvent.change(field, { target: { value: '  Kaufland Mărăști ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvează' }));

    await expectStatus('Magazinul a fost redenumit „Kaufland Mărăști”.');
    expect(await getActive(db.stores, cluj.id)).toMatchObject({
      name: 'Kaufland Mărăști',
      chain: 'kaufland',
      branchCode: '1234',
      city: 'Cluj-Napoca',
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Redenumește magazinul „Kaufland Mărăști”' }),
      ),
    );
  });

  it('refuses an empty name and keeps the form open', async () => {
    const { cluj } = await world();
    renderScreen();
    const row = await item('Kaufland Cluj');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Redenumește magazinul „Kaufland Cluj”' }),
    );
    const field = within(row).getByLabelText<HTMLInputElement>('Numele magazinului');

    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Salvează' }));

    expect((await within(row).findByRole('alert')).textContent).toBe(
      'Scrie un nume pentru magazin.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect((await getActive(db.stores, cluj.id))?.name).toBe('Kaufland Cluj');
  });

  it('leaves the name alone when the rename is cancelled with Escape', async () => {
    await world();
    renderScreen();
    const row = await item('Kaufland Cluj');
    const button = within(row).getByRole('button', {
      name: 'Redenumește magazinul „Kaufland Cluj”',
    });
    fireEvent.click(button);

    fireEvent.keyDown(within(row).getByLabelText('Numele magazinului'), { key: 'Escape' });

    expect(within(row).queryByLabelText('Numele magazinului')).toBeNull();
    await expectFocus(button);
  });

  it('merges a duplicate into the store that stays, moving its receipts', async () => {
    const { cluj, other, clujReceipts } = await world();
    renderScreen();
    const row = await item('Kaufland Cluj');
    fireEvent.click(
      within(row).getByRole('button', { name: 'Unește magazinul „Kaufland Cluj” cu altul' }),
    );

    const question = await within(row).findByRole('group', {
      name: 'Unești „Kaufland Cluj” cu alt magazin?',
    });
    expect(question.textContent).toContain(
      'Bonurile magazinului „Kaufland Cluj” (3 bonuri) trec la magazinul pe care îl păstrezi, iar „Kaufland Cluj” se șterge. Nu se poate anula.',
    );
    const select = within(question).getByLabelText<HTMLSelectElement>('Păstrează magazinul');
    await expectFocus(select);
    // Stores of the same chain come first; the store itself is not offered.
    expect([...select.options].map((option) => option.textContent)).toEqual([
      'Alege magazinul…',
      'Kaufland Oradea (Kaufland · Oradea; 1 bon)',
      'Lidl (Lidl; niciun bon)',
      'METRO (METRO; 1 bon)',
    ]);
    const confirm = within(question).getByRole<HTMLButtonElement>('button', {
      name: 'Unește magazinele',
    });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(select, { target: { value: other.id } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await expectStatus(
      'Magazinul „Kaufland Cluj” a fost unit cu „Kaufland Oradea”: 3 bonuri au trecut la „Kaufland Oradea”.',
    );
    expect(await getActive(db.stores, cluj.id)).toBeUndefined();
    expect((await db.stores.get(cluj.id))?.deletedAt).toBeDefined();
    for (const receipt of clujReceipts) {
      expect((await db.receipts.get(receipt.id))?.storeId).toBe(other.id);
    }
    await waitFor(() => expect(names()).toEqual(['Kaufland Oradea', 'Lidl', 'METRO']));
    expect(within(await item('Kaufland Oradea')).getByText('4 bonuri')).toBeTruthy();
    await expectFocus(screen.getByRole('heading', { name: 'Magazinele tale' }));
  });

  it('changes nothing when the merge is cancelled', async () => {
    const { cluj, clujReceipts } = await world();
    renderScreen();
    const row = await item('Kaufland Cluj');
    const button = within(row).getByRole('button', {
      name: 'Unește magazinul „Kaufland Cluj” cu altul',
    });
    fireEvent.click(button);
    const question = await within(row).findByRole('group', { name: /Unești/ });

    fireEvent.click(within(question).getByRole('button', { name: 'Anulează' }));

    expect(within(row).queryByRole('group')).toBeNull();
    await expectFocus(button);
    expect(await getActive(db.stores, cluj.id)).toBeDefined();
    expect((await db.receipts.get(clujReceipts[0]!.id))?.storeId).toBe(cluj.id);
  });

  it('merges a store without receipts too, and says so', async () => {
    const { lidl, metro } = await world();
    renderScreen();
    const row = await item('Lidl');
    fireEvent.click(within(row).getByRole('button', { name: 'Unește magazinul „Lidl” cu altul' }));
    const question = await within(row).findByRole('group', { name: /Unești/ });
    expect(question.textContent).toContain('„Lidl” nu are bonuri; se șterge.');

    fireEvent.change(within(question).getByLabelText('Păstrează magazinul'), {
      target: { value: metro.id },
    });
    fireEvent.click(within(question).getByRole('button', { name: 'Unește magazinele' }));

    await expectStatus('Magazinul „Lidl” a fost unit cu „METRO”.');
    expect(await getActive(db.stores, lidl.id)).toBeUndefined();
  });

  it('offers to delete only a store that has no receipts, after a confirmation', async () => {
    const { lidl } = await world();
    renderScreen();
    expect(
      within(await item('Kaufland Cluj')).queryByRole('button', { name: /Șterge/ }),
    ).toBeNull();
    expect(within(await item('METRO')).queryByRole('button', { name: /Șterge/ })).toBeNull();
    const row = await item('Lidl');
    const button = within(row).getByRole('button', { name: 'Șterge magazinul „Lidl”' });

    fireEvent.click(button);

    const question = await within(row).findByRole('group', { name: 'Ștergi magazinul „Lidl”?' });
    expect(question.textContent).toContain('Magazinul nu are niciun bon.');
    await expectFocus(within(question).getByRole('button', { name: 'Anulează' }));
    fireEvent.keyDown(within(question).getByRole('button', { name: 'Anulează' }), {
      key: 'Escape',
    });
    expect(within(row).queryByRole('group')).toBeNull();
    await expectFocus(button);
    expect(await getActive(db.stores, lidl.id)).toBeDefined();

    fireEvent.click(button);
    fireEvent.click(await within(row).findByRole('button', { name: 'Șterge magazinul' }));

    await expectStatus('Magazinul „Lidl” a fost șters.');
    expect(await getActive(db.stores, lidl.id)).toBeUndefined();
    await waitFor(() => expect(names()).not.toContain('Lidl'));
  });

  it('has nothing to merge a store with when it is the only one', async () => {
    await addStore(db, { name: 'Singurul' });
    renderScreen();

    const row = await item('Singurul');

    expect(within(row).queryByRole('button', { name: /Unește/ })).toBeNull();
  });
});
