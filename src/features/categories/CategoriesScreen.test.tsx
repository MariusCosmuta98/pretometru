// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addCategory, deleteCategory, listCategories } from '@/admin';
import { addProduct, addReceipt, addStore, resetDb, SEED } from '@/admin/testing';
import { getActive, type PretometruDB } from '@/storage';

beforeAll(async () => {
  // Load the lazy route modules before the first test waits for them.
  await import('./CategoriesScreen');
  await import('./CategoriesSection');
});

let db: PretometruDB;
beforeEach(async () => {
  db = await resetDb();
});
afterEach(cleanup);

function renderScreen() {
  const router = createMemoryRouter(
    [
      { path: '/setari/categorii', lazy: () => import('./CategoriesScreen') },
      { path: '/setari', element: <p>Ecranul Setări</p> },
    ],
    { initialEntries: ['/setari/categorii'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

const item = async (name: string) =>
  (await screen.findByRole('button', { name: `Editează categoria „${name}”` })).closest('li')!;

const names = () =>
  screen.getAllByRole('listitem').map((row) => row.querySelector('p')?.textContent ?? '');

const expectFocus = (element: HTMLElement) =>
  waitFor(() => expect(document.activeElement).toBe(element));

/** The sentence is announced in the status region. */
async function expectStatus(text: string) {
  expect((await screen.findByText(text)).getAttribute('role')).toBe('status');
}

describe('categories screen', () => {
  it('lists the categories with what uses each, the system one last and marked', async () => {
    await addProduct(db, 'Lapte', SEED.dairy.id);
    await addProduct(db, 'Iaurt', SEED.dairy.id);
    renderScreen();

    expect((await item('Lactate & ouă')).textContent).toContain('2 produse');
    expect(names()[0]).toBe('Lactate & ouă');
    expect(names().at(-1)).toBe('Non-produs');
    expect((await item('Non-produs')).textContent).toContain('Categorie de sistem');
    expect(screen.getByRole('link', { name: '← Setări' }).getAttribute('href')).toBe('/setari');
  });

  it('adds a category with a name, an emoji and a colour', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Adaugă o categorie' }));

    const form = screen.getByRole('form', { name: 'Categorie nouă' });
    const name = within(form).getByLabelText<HTMLInputElement>('Nume');
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: '  Cafea și ceai ' } });
    fireEvent.change(within(form).getByLabelText('Emoji'), { target: { value: '☕' } });
    fireEvent.change(within(form).getByLabelText('Culoare'), { target: { value: '#aa5500' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Adaugă categoria' }));

    await expectStatus('Categoria „Cafea și ceai” a fost adăugată.');
    const added = (await listCategories(db)).find((row) => row.category.name === 'Cafea și ceai');
    expect(added?.category).toMatchObject({ icon: '☕', color: '#aa5500', order: 160 });
    expect(names().slice(-2)).toEqual(['Cafea și ceai', 'Non-produs']);
    await expectFocus(screen.getByRole('button', { name: 'Adaugă o categorie' }));
  });

  it('explains what is wrong with a new category and puts focus on that field', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Adaugă o categorie' }));
    const form = screen.getByRole('form', { name: 'Categorie nouă' });
    const name = within(form).getByLabelText<HTMLInputElement>('Nume');
    const emoji = within(form).getByLabelText<HTMLInputElement>('Emoji');
    const submit = () =>
      fireEvent.click(within(form).getByRole('button', { name: 'Adaugă categoria' }));

    submit();
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Scrie un nume pentru categorie.',
    );
    expect(document.activeElement).toBe(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');

    fireEvent.change(name, { target: { value: 'bauturi nealcoolice' } });
    expect(within(form).queryByRole('alert')).toBeNull();
    submit();
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Există deja o categorie cu acest nume.',
    );

    fireEvent.change(name, { target: { value: 'Dulciuri' } });
    fireEvent.change(emoji, { target: { value: 'abc' } });
    submit();
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Alege un singur emoji, de exemplu 🥛.',
    );
    expect(document.activeElement).toBe(emoji);
    expect(await db.categories.count()).toBe(16);

    fireEvent.click(within(form).getByRole('button', { name: 'Alege emoji 🍫' }));
    submit();
    expect(await screen.findByText('Categoria „Dulciuri” a fost adăugată.')).toBeTruthy();
    expect(await db.categories.count()).toBe(17);
  });

  it('cancels a new category with Escape and puts focus back on the button', async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole('button', { name: 'Adaugă o categorie' }));

    fireEvent.keyDown(screen.getByLabelText('Nume'), { key: 'Escape' });

    expect(screen.queryByRole('form', { name: 'Categorie nouă' })).toBeNull();
    await expectFocus(screen.getByRole('button', { name: 'Adaugă o categorie' }));
    expect(await db.categories.count()).toBe(16);
  });

  it('edits the name, emoji and colour of a built-in category', async () => {
    renderScreen();
    const row = await item('Bacanie');
    fireEvent.click(within(row).getByRole('button', { name: 'Editează categoria „Bacanie”' }));

    const form = within(row).getByRole('form', { name: 'Editează categoria „Bacanie”' });
    expect(within(form).getByLabelText<HTMLInputElement>('Nume').value).toBe('Bacanie');
    fireEvent.change(within(form).getByLabelText('Nume'), {
      target: { value: 'Alimente de bază' },
    });
    fireEvent.change(within(form).getByLabelText('Emoji'), { target: { value: '🥣' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Alege culoarea #0ea5e9' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));

    await expectStatus('Categoria „Alimente de bază” a fost salvată.');
    expect((await getActive(db.categories, SEED.grocery.id))!).toMatchObject({
      name: 'Alimente de bază',
      icon: '🥣',
      color: '#0ea5e9',
    });
    // The list is read again after the save: the button keeps its place, its name follows.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Editează categoria „Alimente de bază”' }),
      ),
    );
  });

  it('lets only the look of the system category change', async () => {
    renderScreen();
    const row = await item('Non-produs');

    expect(within(row).queryByRole('button', { name: /Șterge/ })).toBeNull();
    expect(within(row).queryByRole('button', { name: /Mută/ })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Editează categoria „Non-produs”' }));
    const form = within(row).getByRole('form');
    expect(within(form).getByLabelText<HTMLInputElement>('Nume').disabled).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: 'Alege culoarea #ef4444' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Salvează' }));

    expect(await screen.findByText('Categoria „Non-produs” a fost salvată.')).toBeTruthy();
    expect((await getActive(db.categories, SEED.nonProduct.id))!).toMatchObject({
      name: 'Non-produs',
      color: '#ef4444',
      system: true,
    });
  });

  it('moves a category up and down and says where it is now', async () => {
    renderScreen();
    const row = await item('Bacanie');

    fireEvent.click(within(row).getByRole('button', { name: 'Mută „Bacanie” mai sus' }));

    expect(await screen.findByText('„Bacanie” este acum pe locul 4 din 15.')).toBeTruthy();
    await waitFor(() =>
      expect(names().slice(2, 5)).toEqual(['Fructe & legume', 'Bacanie', 'Panificație & cereale']),
    );
    await expectFocus(screen.getByRole('button', { name: 'Mută „Bacanie” mai sus' }));

    fireEvent.click(screen.getByRole('button', { name: 'Mută „Bacanie” mai jos' }));
    expect(await screen.findByText('„Bacanie” este acum pe locul 5 din 15.')).toBeTruthy();
    await waitFor(() => expect(names().slice(3, 5)).toEqual(['Panificație & cereale', 'Bacanie']));
  });

  it('cannot move the first category up or the last one down, and focus follows the end it reached', async () => {
    renderScreen();
    const first = await item('Lactate & ouă');
    const second = await item('Carne & mezeluri');
    expect(within(first).getByRole<HTMLButtonElement>('button', { name: /mai sus/ }).disabled).toBe(
      true,
    );
    expect(
      within(await item('Altele')).getByRole<HTMLButtonElement>('button', { name: /mai jos/ })
        .disabled,
    ).toBe(true);

    fireEvent.click(
      within(second).getByRole('button', { name: 'Mută „Carne & mezeluri” mai sus' }),
    );

    await waitFor(() => expect(names()[0]).toBe('Carne & mezeluri'));
    // It reached the top, so the button it was using is disabled: focus goes to the other one.
    await expectFocus(screen.getByRole('button', { name: 'Mută „Carne & mezeluri” mai jos' }));
  });

  it('asks where the products and lines go before deleting a category that is used', async () => {
    const store = await addStore(db);
    const rice = await addProduct(db, 'Orez', SEED.grocery.id);
    await addProduct(db, 'Făină', SEED.grocery.id);
    await addReceipt(db, store.id, {
      lines: [{ productId: rice.id, categoryId: SEED.grocery.id }],
    });
    renderScreen();
    const row = await item('Bacanie');

    fireEvent.click(within(row).getByRole('button', { name: 'Șterge categoria „Bacanie”' }));

    const question = await within(row).findByRole('group', { name: 'Ștergi categoria „Bacanie”?' });
    expect(question.textContent).toContain(
      '2 produse și 1 linie de bon folosesc această categorie.',
    );
    const select = within(question).getByLabelText<HTMLSelectElement>('Mută în');
    await expectFocus(select);
    expect(select.value).toBe('');
    expect(
      [...select.options]
        .map((option) => option.textContent)
        .filter((text) => /Bacanie|Non-produs/.test(text)),
    ).toEqual([]);
    const confirm = within(question).getByRole<HTMLButtonElement>('button', {
      name: 'Șterge și mută',
    });
    expect(confirm.disabled).toBe(true);

    fireEvent.change(select, { target: { value: SEED.other.id } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await expectStatus(
      'Categoria „Bacanie” a fost ștearsă; 2 produse și 1 linie de bon au trecut la „Altele”.',
    );
    expect(await getActive(db.categories, SEED.grocery.id)).toBeUndefined();
    expect((await db.products.toArray()).map((product) => product.categoryId)).toEqual([
      SEED.other.id,
      SEED.other.id,
    ]);
    expect((await db.lines.toArray()).map((line) => line.categoryId)).toEqual([SEED.other.id]);
    await waitFor(() => expect(names()).not.toContain('Bacanie'));
    await expectFocus(screen.getByRole('heading', { name: 'Categoriile tale' }));
  });

  it('only asks for a confirmation when nothing uses the category, and Escape backs out', async () => {
    renderScreen();
    const row = await item('Animale');
    const button = within(row).getByRole('button', { name: 'Șterge categoria „Animale”' });
    fireEvent.click(button);

    const question = await within(row).findByRole('group', { name: 'Ștergi categoria „Animale”?' });
    expect(question.textContent).toContain('Nimic nu folosește această categorie.');
    expect(within(question).queryByLabelText('Mută în')).toBeNull();
    await expectFocus(within(question).getByRole('button', { name: 'Anulează' }));

    fireEvent.keyDown(within(question).getByRole('button', { name: 'Anulează' }), {
      key: 'Escape',
    });

    expect(within(row).queryByRole('group')).toBeNull();
    await expectFocus(button);
    expect(await getActive(db.categories, SEED.meat.id)).toBeDefined();

    fireEvent.click(button);
    fireEvent.click(await within(row).findByRole('button', { name: 'Șterge categoria' }));
    expect(await screen.findByText('Categoria „Animale” a fost ștearsă.')).toBeTruthy();
    await waitFor(() => expect(names()).not.toContain('Animale'));
  });

  it('follows changes made elsewhere, such as a sync or another tab', async () => {
    renderScreen();
    await item('Altele');

    await deleteCategory(db, SEED.other.id);
    await addCategory(db, { name: 'Din altă parte', icon: '🌍', color: '#112233' });

    await waitFor(() => expect(names()).not.toContain('Altele'));
    await waitFor(() => expect(names().slice(-2)).toEqual(['Din altă parte', 'Non-produs']));
  });
});
