// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProduct } from '@/catalog';
import { saveTestReceipt } from '@/catalog/testing';
import {
  addProductToList,
  addTextItem,
  archiveList,
  createList,
  deleteList,
  setItemChecked,
  updateItem,
} from '@/lists';
import { FIXTURE_NOW, fixtureWorld, resetDb, type FixtureWorld } from '@/lists/testing';
import { listActive, setSetting, type PretometruDB } from '@/storage';

function renderList(listId: string) {
  const router = createMemoryRouter(
    [
      { path: '/liste', element: <p>Ecranul listelor</p> },
      { path: '/liste/:listId', lazy: () => import('./ListScreen') },
    ],
    { initialEntries: [`/liste/${listId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

let db: PretometruDB;
let world: FixtureWorld;
let listId: string;

/** The list the screen tests share: paper (2 packs), wipes, 500 g of chicken, coffee (never bought) and bread. */
async function fillList() {
  const added = {
    paper: (await addProductToList(db, listId, world.paper.id)).item,
    wipes: (await addProductToList(db, listId, world.wipes.id)).item,
    pork: (await addProductToList(db, listId, world.pork.id)).item,
    coffee: (await addProductToList(db, listId, world.coffee.id)).item,
    bread: await addTextItem(db, listId, 'Pâine'),
  };
  await updateItem(db, added.paper.id, { qty: 2, unit: 'buc' });
  await updateItem(db, added.pork.id, { qty: 0.5, unit: 'kg' });
  return added;
}
let items: Awaited<ReturnType<typeof fillList>>;

// The screens read the clock for "the last N days"; only Date is faked so IndexedDB keeps running.
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  db = await resetDb();
  world = await fixtureWorld(db);
  listId = (await createList(db, 'Cumpărături')).id;
  items = await fillList();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const store = (name: string) => screen.findByRole('region', { name });
const rowOf = (name: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`^${name}`) }).closest('li')!;
const names = (section: HTMLElement) =>
  within(section)
    .getAllByRole('checkbox')
    .map((box) => box.closest('label')?.textContent?.replace(/\s+/g, ' ').trim());
const openSettings = () => fireEvent.click(screen.getByText(/^Prețuri din ultimele/));

describe('List screen: where each item is cheapest', () => {
  it('groups the items by store with the price per unit, its date and a subtotal per store', async () => {
    await setSetting(db, 'priceWindowDays', 120); // METRO's invoice is 100 days old
    renderList(listId);

    const metro = await store('METRO');
    expect(within(metro).getByRole('heading', { level: 3 }).textContent).toBe('METRO');
    expect(names(metro)).toEqual(['Hârtie igienică 2 buc', 'Șervețele umede 120 buc']);
    expect(metro.textContent).toContain('2 articole · ≈ 24,82 lei');
    const paper = rowOf('Hârtie igienică');
    expect(paper.textContent).toContain(
      'Cel mai ieftin la METRO: 1,30 lei/rolă (10,42 lei / 8 role) · 12.08.2026',
    );
    expect(paper.textContent).toContain('reducere'); // METRO's price was a sale price
    // the name, the quantity and the sale tag are separate words for a screen reader
    expect(screen.getByRole('checkbox', { name: 'Hârtie igienică 2 buc' })).toBeTruthy();
    expect(paper.textContent).toContain('12.08.2026 reducere');
    expect(paper.textContent).toContain('≈ 20,84 lei'); // 2 packs of 10,42
    expect(rowOf('Șervețele umede 120 buc').textContent).toContain(
      '0,0332 lei/buc (3,98 lei / 120 buc) · 12.08.2026',
    );

    const kaufland = await store('Kaufland');
    expect(names(kaufland)).toEqual(['Pulpe de pui 0,5 kg']);
    expect(kaufland.textContent).toContain('1 articol · ≈ 12,49 lei');
    expect(rowOf('Pulpe de pui').textContent).toContain(
      'Doar la Kaufland: 24,99 lei/kg · 07.11.2026',
    );

    const nowhere = await store('Fără magazin');
    expect(names(nowhere)).toEqual(['Cafea măcinată', 'Pâine']);
    expect(nowhere.textContent).toContain('2 articole · nu știm încă unde sunt mai ieftine');
    expect(rowOf('Cafea măcinată').textContent).toContain('Încă necumpărat');
    expect(rowOf('Pâine').textContent).not.toMatch(/lei|necumpărat/);

    expect(screen.getByRole('heading', { level: 2, name: 'Cumpărături' })).toBeTruthy();
    expect(document.body.textContent).toContain('0 din 5 articole bifate');
    expect(document.body.textContent).toContain(
      'Total estimat: ≈ 37,31 lei · 2 articole fără preț',
    );
  });

  it('shows the stores in order and the groups in the same order as the plain list', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    await store('METRO');

    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Kaufland', 'METRO', 'Fără magazin']);
  });

  it('follows the price settings: a window of 90 days leaves METRO out, 120 brings it back', async () => {
    renderList(listId);
    const kaufland = await store('Kaufland');
    expect(names(kaufland)).toEqual([
      'Hârtie igienică 2 buc',
      'Șervețele umede 120 buc',
      'Pulpe de pui 0,5 kg',
    ]);
    expect(screen.queryByRole('region', { name: 'METRO' })).toBeNull();
    expect(rowOf('Hârtie igienică').textContent).toContain(
      'Cel mai ieftin la Kaufland: 1,45 lei/rolă (11,59 lei / 8 role) · 07.11.2026',
    );

    openSettings();
    fireEvent.change(screen.getByLabelText('Perioadă de comparație'), { target: { value: '180' } });

    const metro = await store('METRO');
    expect(names(metro)).toEqual(['Hârtie igienică 2 buc', 'Șervețele umede 120 buc']);
    expect(screen.getByText(/^Prețuri din ultimele 180 de zile, cu reduceri/)).toBeTruthy();
  });

  it('leaves sale prices out on request: METRO sold both products at a discount', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    await store('METRO');

    openSettings();
    fireEvent.click(screen.getByLabelText('Fără prețuri la reducere'));

    await waitFor(() => expect(screen.queryByRole('region', { name: 'METRO' })).toBeNull());
    const kaufland = await store('Kaufland');
    expect(names(kaufland)).toEqual([
      'Hârtie igienică 2 buc',
      'Șervețele umede 120 buc',
      'Pulpe de pui 0,5 kg',
    ]);
    expect(screen.getByText(/, fără reduceri$/)).toBeTruthy();
  });

  it('says why an item has no store when nothing was bought in the window', async () => {
    await setSetting(db, 'priceWindowDays', 10);
    renderList(listId);
    await store('Fără magazin');

    expect(rowOf('Hârtie igienică').textContent).toContain(
      'Niciun preț de comparat în ultimele 10 zile. Ultima achiziție: Kaufland, 1,45 lei/rolă',
    );
    // chicken was bought at one store only, so it stays there whatever the window
    expect(names(await store('Kaufland'))).toEqual(['Pulpe de pui 0,5 kg']);
  });

  it('switches to a plain list in list order and back to the stores', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    await store('METRO');

    fireEvent.click(screen.getByLabelText('Listă simplă'));

    const plain = screen.getByRole('region', { name: 'Articolele listei' });
    expect(names(plain)).toEqual([
      'Hârtie igienică 2 buc',
      'Șervețele umede 120 buc',
      'Pulpe de pui 0,5 kg',
      'Cafea măcinată',
      'Pâine',
    ]);
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);

    fireEvent.click(screen.getByLabelText('Pe magazine'));
    expect(await store('METRO')).toBeTruthy();
  });

  it('follows a new receipt without a reload: the list is live', async () => {
    renderList(listId);
    await store('Kaufland');
    expect(rowOf('Cafea măcinată').textContent).toContain('Încă necumpărat');

    await act(async () => {
      await saveTestReceipt(db, {
        chain: 'mega-image',
        purchasedAt: '2026-11-15T10:00',
        lines: [
          {
            rawName: 'CAFEA MACINATA 250G',
            lineTotalBani: 1250,
            pack: { qty: 250, unit: 'g' },
            productId: world.coffee.id,
          },
        ],
      });
    });

    await waitFor(() =>
      expect(rowOf('Cafea măcinată').textContent).toContain(
        'Doar la Mega Image: 50,00 lei/kg (12,50 lei / 250 g) · 15.11.2026',
      ),
    );
    expect(names(await store('Mega Image'))).toEqual(['Cafea măcinată']);
  });
});

describe('List screen: checking items', () => {
  it('checks an item, moves it behind the ones still to buy and stores when it was checked', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    const metro = await store('METRO');

    fireEvent.click(within(metro).getByRole('checkbox', { name: /^Hârtie igienică/ }));

    await waitFor(() =>
      expect(names(screen.getByRole('region', { name: 'METRO' }))).toEqual([
        'Șervețele umede 120 buc',
        'Hârtie igienică 2 buc',
      ]),
    );
    expect(document.body.textContent).toContain('1 din 5 articole bifate');
    const checkbox = screen.getByRole<HTMLInputElement>('checkbox', {
      name: /^Hârtie igienică/,
    });
    expect(checkbox.checked).toBe(true);
    expect(checkbox.closest('label')?.querySelector('.line-through')).toBeTruthy();
    const stored = await db.listItems.get(items.paper.id);
    expect(stored).toMatchObject({ checked: true, checkedAt: FIXTURE_NOW.toISOString() });

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(
        screen.getByRole<HTMLInputElement>('checkbox', { name: /^Hârtie igienică/ }).checked,
      ).toBe(false),
    );
    expect((await db.listItems.get(items.paper.id))?.checkedAt).toBeUndefined();
  });

  it('unchecks everything or removes what was bought, after asking', async () => {
    await setItemChecked(db, items.bread.id, true);
    await setItemChecked(db, items.coffee.id, true);
    renderList(listId);
    await screen.findByText('2 din 5 articole bifate', { exact: false });

    fireEvent.click(screen.getByRole('button', { name: 'Șterge bifatele (2)' }));
    const group = screen.getByRole('group', { name: /Ștergi/ });
    expect(group.textContent).toContain('Ștergi cele 2 articole bifate din listă?');
    expect(document.activeElement).toBe(within(group).getByRole('button', { name: 'Anulează' }));
    fireEvent.click(within(group).getByRole('button', { name: 'Anulează' }));
    expect(screen.queryByRole('group', { name: /Ștergi/ })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Șterge bifatele (2)' }),
    );
    expect(await db.listItems.count()).toBe(5);

    fireEvent.click(screen.getByRole('button', { name: 'Debifează tot' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Debifează tot' })).toBeNull());
    expect(document.body.textContent).toContain('0 din 5 articole bifate');
    expect(document.activeElement).toBe(screen.getByLabelText('Adaugă un articol'));

    await setItemChecked(db, items.bread.id, true);
    fireEvent.click(await screen.findByRole('button', { name: 'Șterge bifatele (1)' }));
    expect(screen.getByRole('group', { name: /Ștergi/ }).textContent).toContain(
      'Ștergi articolul bifat din listă?',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Șterge bifatele' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /^Pâine/ })).toBeNull());
    expect((await listActive(db.listItems)).map((item) => item.label)).toHaveLength(4);
  });
});

describe('List screen: adding items', () => {
  it('adds a catalog product by tapping its suggestion, and keeps the focus on the field', async () => {
    const lemon = await createProduct(db, {
      name: 'Lămâie',
      brand: 'Bio',
      categoryId: world.coffee.categoryId,
      baseUnit: 'kg',
    });
    renderList(listId);
    const field = await screen.findByLabelText<HTMLInputElement>('Adaugă un articol');

    fireEvent.change(field, { target: { value: 'lam' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Adaugă Lămâie, Bio' }));

    await waitFor(() => expect(screen.getByText('Adăugat: Lămâie.')).toBeTruthy());
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
    const added = (await listActive(db.listItems)).find((item) => item.productId === lemon.id);
    expect(added).toMatchObject({ listId, label: 'Lămâie', order: 5 });
    expect(await screen.findByRole('checkbox', { name: /^Lămâie/ })).toBeTruthy();
    expect(rowOf('Lămâie').textContent).toContain('Încă necumpărat');
  });

  it('adds what was typed as free text with Enter, and says what to do to get prices', async () => {
    renderList(listId);
    const field = await screen.findByLabelText('Adaugă un articol');

    fireEvent.change(field, { target: { value: '  baterii AA ' } });
    expect(screen.getByText(/Enter adaugă „baterii AA” ca articol/)).toBeTruthy();
    fireEvent.submit(field.closest('form')!);

    await waitFor(() => expect(screen.getByText('Adăugat: baterii AA.')).toBeTruthy());
    const item = (await listActive(db.listItems)).find((entry) => entry.label === 'baterii AA');
    expect(item?.productId).toBeUndefined();
    expect(await screen.findByRole('checkbox', { name: /^baterii AA/ })).toBeTruthy();
  });

  it('takes the exact name of a catalog product for the product, so it gets its prices', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    const { paper } = world;
    await db.listItems.where('productId').equals(paper.id).delete();
    renderList(listId);
    const field = await screen.findByLabelText('Adaugă un articol');

    fireEvent.change(field, { target: { value: 'hartie igienica' } });
    fireEvent.submit(field.closest('form')!);

    await waitFor(() => expect(screen.getByText('Adăugat: Hârtie igienică.')).toBeTruthy());
    expect(await db.listItems.where('productId').equals(paper.id).toArray()).toHaveLength(1);
    await waitFor(() =>
      expect(rowOf('Hârtie igienică').textContent).toContain('Cel mai ieftin la METRO'),
    );
  });

  it('says so when the product is already on the list, and when it comes back after being checked', async () => {
    renderList(listId);
    const field = await screen.findByLabelText('Adaugă un articol');

    fireEvent.change(field, { target: { value: 'Pulpe de pui' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(screen.getByText('„Pulpe de pui” e deja pe listă.')).toBeTruthy());
    expect(await db.listItems.where('productId').equals(world.pork.id).count()).toBe(1);

    await setItemChecked(db, items.pork.id, true);
    fireEvent.change(field, { target: { value: 'Pulpe de pui' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() =>
      expect(
        screen.getByText('„Pulpe de pui” era bifat: l-am pus din nou de cumpărat.'),
      ).toBeTruthy(),
    );
    expect((await db.listItems.get(items.pork.id))?.checked).toBe(false);
  });

  it('asks for something to add instead of adding nothing', async () => {
    renderList(listId);
    const field = await screen.findByLabelText('Adaugă un articol');

    fireEvent.submit(field.closest('form')!);

    expect((await screen.findByRole('alert')).textContent).toBe('Scrie ce vrei să adaugi.');
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(await db.listItems.count()).toBe(5);
  });
});

describe('List screen: editing an item', () => {
  it('sets the quantity, unit and note, and the estimate follows', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    await store('METRO');

    const edit = screen.getByRole('button', { name: 'Editează Șervețele umede 120 buc' });
    fireEvent.click(edit);
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    const form = screen.getByRole('form', { name: 'Editează Șervețele umede 120 buc' });
    expect(document.activeElement).toBe(within(form).getByLabelText('Cantitate'));

    fireEvent.change(within(form).getByLabelText('Cantitate'), { target: { value: '3' } });
    fireEvent.change(within(form).getByLabelText('Unitate'), { target: { value: 'buc' } });
    fireEvent.change(within(form).getByLabelText('Notă'), {
      target: { value: 'de la raftul de jos' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));

    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    await waitFor(() => expect(rowOf('Șervețele umede 120 buc').textContent).toContain('3 buc'));
    const row = rowOf('Șervețele umede 120 buc');
    expect(row.textContent).toContain('Notă: de la raftul de jos');
    expect(row.textContent).toContain('≈ 11,94 lei'); // 3 packs of 3,98
    expect(await db.listItems.get(items.wipes.id)).toMatchObject({
      qty: 3,
      unit: 'buc',
      note: 'de la raftul de jos',
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Editează Șervețele umede 120 buc' }),
      ),
    );
  });

  it('refuses a quantity that is not a positive number with up to 3 decimals', async () => {
    renderList(listId);
    await store('Kaufland');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Pulpe de pui' }));
    const form = screen.getByRole('form', { name: 'Editează Pulpe de pui' });
    const qty = within(form).getByLabelText('Cantitate');

    fireEvent.change(qty, { target: { value: 'doi' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));

    expect((await within(form).findByRole('alert')).textContent).toContain('număr pozitiv');
    expect(qty.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(qty);
    expect((await db.listItems.get(items.pork.id))?.qty).toBe(0.5);

    fireEvent.change(qty, { target: { value: '1,25' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect((await db.listItems.get(items.pork.id))?.qty).toBe(1.25);
  });

  it('renames a free-text item, and clears the quantity when the field is emptied', async () => {
    renderList(listId);
    await store('Fără magazin');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Pâine' }));
    const form = screen.getByRole('form', { name: 'Editează Pâine' });
    expect(document.activeElement).toBe(within(form).getByLabelText('Denumire'));

    fireEvent.change(within(form).getByLabelText('Denumire'), {
      target: { value: 'Pâine neagră' },
    });
    fireEvent.change(within(form).getByLabelText('Cantitate'), { target: { value: '2' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));
    expect(await screen.findByRole('checkbox', { name: /^Pâine neagră 2/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Editează Pâine neagră' }));
    fireEvent.change(screen.getByLabelText('Cantitate'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvează' }));
    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    expect((await db.listItems.get(items.bread.id))?.qty).toBeUndefined();
  });

  it('keeps the focus where the user is when an open editor appears again, e.g. after switching the view', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    renderList(listId);
    await store('METRO');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Hârtie igienică' }));
    const plainView = screen.getByLabelText('Listă simplă');
    plainView.focus();

    fireEvent.click(plainView);

    const plain = await screen.findByRole('region', { name: 'Articolele listei' });
    expect(within(plain).getByRole('form', { name: 'Editează Hârtie igienică' })).toBeTruthy();
    expect(document.activeElement).toBe(plainView);
  });

  it('does not offer to rename a product item: its name is the product', async () => {
    renderList(listId);
    await store('Kaufland');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Pulpe de pui' }));

    expect(screen.queryByLabelText('Denumire')).toBeNull();
  });

  it('closes the editor with Escape and returns focus to its button, without saving', async () => {
    renderList(listId);
    await store('Kaufland');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Pulpe de pui' }));
    const qty = screen.getByLabelText('Cantitate');
    fireEvent.change(qty, { target: { value: '9' } });

    fireEvent.keyDown(qty, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('form')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Editează Pulpe de pui' }),
      ),
    );
    expect((await db.listItems.get(items.pork.id))?.qty).toBe(0.5);
  });

  it('moves an item up or down among its neighbours and keeps focus on the button', async () => {
    renderList(listId);
    await store('Kaufland');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Șervețele umede 120 buc' }));
    const up = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Mută mai sus' });
    const down = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Mută mai jos' });
    const kaufland = () => names(screen.getByRole('region', { name: 'Kaufland' }));
    expect(kaufland()).toEqual([
      'Hârtie igienică 2 buc',
      'Șervețele umede 120 buc',
      'Pulpe de pui 0,5 kg',
    ]);
    expect(up().disabled).toBe(false);
    expect(down().disabled).toBe(false);

    fireEvent.click(up());
    await waitFor(() =>
      expect(kaufland()).toEqual([
        'Șervețele umede 120 buc',
        'Hârtie igienică 2 buc',
        'Pulpe de pui 0,5 kg',
      ]),
    );
    expect(up().disabled).toBe(true); // at the top of its store now
    await waitFor(() => expect(document.activeElement).toBe(down())); // so the other button has focus

    fireEvent.click(down());
    await waitFor(() =>
      expect(kaufland()).toEqual([
        'Hârtie igienică 2 buc',
        'Șervețele umede 120 buc',
        'Pulpe de pui 0,5 kg',
      ]),
    );
    await waitFor(() => expect(document.activeElement).toBe(down()));

    fireEvent.click(down());
    await waitFor(() =>
      expect(kaufland()).toEqual([
        'Hârtie igienică 2 buc',
        'Pulpe de pui 0,5 kg',
        'Șervețele umede 120 buc',
      ]),
    );
    expect(down().disabled).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(up()));
    expect(
      (await listActive(db.listItems))
        .filter((item) => item.listId === listId)
        .map((item) => item.order)
        .toSorted((a, b) => a - b),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it('does not move an item past the ones it has nothing in common with (checked or in another store)', async () => {
    await setSetting(db, 'priceWindowDays', 120);
    await setItemChecked(db, items.wipes.id, true);
    renderList(listId);
    await store('METRO');

    fireEvent.click(screen.getByRole('button', { name: 'Editează Hârtie igienică' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mută mai sus' }).disabled).toBe(
      true,
    );
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mută mai jos' }).disabled).toBe(
      true,
    );
  });

  it('removes an item from its editor and puts focus on the add field', async () => {
    renderList(listId);
    await store('Fără magazin');
    fireEvent.click(screen.getByRole('button', { name: 'Editează Pâine' }));

    fireEvent.click(screen.getByRole('button', { name: 'Șterge articolul' }));

    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /^Pâine/ })).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText('Adaugă un articol'));
    expect((await db.listItems.get(items.bread.id))?.deletedAt).toBeDefined();
    expect(screen.queryByRole('form')).toBeNull();
  });
});

describe('List screen: the list itself', () => {
  it('says the list is not found when it does not exist, with a way back', async () => {
    renderList('missing');

    expect(await screen.findByText('Lista nu a fost găsită.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Înapoi la liste' }).getAttribute('href')).toBe(
      '/liste',
    );
  });

  it('invites to add a first item to an empty list', async () => {
    const empty = await createList(db, 'Goală');
    renderList(empty.id);

    expect(await screen.findByText('Lista e goală.')).toBeTruthy();
    expect(screen.queryByLabelText('Pe magazine')).toBeNull();
    expect(screen.getByRole('link', { name: '← Liste' }).getAttribute('href')).toBe('/liste');
  });

  it('shows an archived list as such and restores it', async () => {
    await archiveList(db, listId);
    renderList(listId);

    expect(await screen.findByText('Lista e arhivată.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurează' }));

    await waitFor(() => expect(screen.queryByText('Lista e arhivată.')).toBeNull());
    expect((await db.lists.get(listId))?.archivedAt).toBeUndefined();
  });

  it('puts focus on the add field after "Restaurează", which removes the banner that had it', async () => {
    await archiveList(db, listId);
    renderList(listId);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurează' }));

    await waitFor(() => expect(screen.queryByText('Lista e arhivată.')).toBeNull());
    expect(document.activeElement).toBe(screen.getByLabelText('Adaugă un articol'));
  });

  it('turns into "not found" when the list is deleted elsewhere', async () => {
    renderList(listId);
    await screen.findByRole('heading', { level: 2, name: 'Cumpărături' });

    await deleteList(db, listId);

    expect(await screen.findByText('Lista nu a fost găsită.')).toBeTruthy();
  });
});
