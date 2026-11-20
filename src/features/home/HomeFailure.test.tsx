// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, it, vi } from 'vitest';

// IndexedDB is unavailable (private mode, blocked): the database never opens.
vi.mock('@/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/storage')>()),
  getDb: () => Promise.reject(new Error('IndexedDB is blocked')),
}));

afterEach(cleanup);

it('says that the data cannot be opened, instead of loading for ever', async () => {
  render(
    <RouterProvider
      router={createMemoryRouter([{ path: '/', lazy: () => import('./HomeScreen') }])}
    />,
  );

  const alert = await screen.findByRole('alert');

  expect(alert.textContent).toBe('Nu am putut deschide datele de pe acest dispozitiv.');
  expect(screen.queryByRole('status')).toBeNull();
});
