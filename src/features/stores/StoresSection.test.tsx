// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addReceipt, addStore, resetDb } from '@/admin/testing';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import type { PretometruDB } from '@/storage';

let db: PretometruDB;
beforeEach(async () => {
  db = await resetDb();
});
afterEach(cleanup);

describe('the Magazine card of Settings', () => {
  it('says how many stores and receipts there are, and follows changes', async () => {
    const kaufland = await addStore(db, { name: 'Kaufland' });
    await addReceipt(db, kaufland.id);
    await addReceipt(db, kaufland.id);
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole('heading', { level: 2, name: 'Magazine' });
    const card = heading.closest('section') as HTMLElement;
    expect(await within(card).findByText(/: 1 magazin, 2 bonuri\./)).toBeTruthy();

    await addStore(db, { chain: 'lidl', name: 'Lidl' });

    await waitFor(() => expect(within(card).getByText(/: 2 magazine, 2 bonuri\./)).toBeTruthy());
  });

  it('opens the screen that manages them, which leads back to Settings', async () => {
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Magazine' });

    fireEvent.click(
      within(heading.closest('section') as HTMLElement).getByRole('link', {
        name: 'Gestionează magazinele',
      }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Magazine' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Magazinele tale' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/setari/magazine');

    fireEvent.click(screen.getByRole('link', { name: '← Setări' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Setări' })).toBeTruthy();
  });
});
