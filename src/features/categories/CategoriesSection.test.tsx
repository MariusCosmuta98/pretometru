// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addCategory } from '@/admin';
import { resetDb } from '@/admin/testing';
import { features } from '@/app/features';
import { buildRoutes } from '@/app/routes';
import type { PretometruDB } from '@/storage';

let db: PretometruDB;
beforeEach(async () => {
  db = await resetDb();
});
afterEach(cleanup);

describe('the Categorii card of Settings', () => {
  it('says how many categories there are, and follows changes', async () => {
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);

    const heading = await screen.findByRole('heading', { level: 2, name: 'Categorii' });
    const card = heading.closest('section') as HTMLElement;
    expect(await within(card).findByText(/: 15 categorii\./)).toBeTruthy();

    await addCategory(db, { name: 'Cafea', icon: '☕', color: '#aa5500' });

    await waitFor(() => expect(within(card).getByText(/: 16 categorii\./)).toBeTruthy());
  });

  it('opens the screen that manages them, which leads back to Settings', async () => {
    const router = createMemoryRouter(buildRoutes(features), { initialEntries: ['/setari'] });
    render(<RouterProvider router={router} />);
    const heading = await screen.findByRole('heading', { level: 2, name: 'Categorii' });

    fireEvent.click(
      within(heading.closest('section') as HTMLElement).getByRole('link', {
        name: 'Gestionează categoriile',
      }),
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Categorii' })).toBeTruthy();
    expect(await screen.findByRole('heading', { level: 2, name: 'Categoriile tale' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/setari/categorii');

    fireEvent.click(screen.getByRole('link', { name: '← Setări' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Setări' })).toBeTruthy();
  });
});
