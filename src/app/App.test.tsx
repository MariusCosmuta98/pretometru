// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FeatureModule } from './feature';
import { features } from './features';
import { navItems } from './registry';
import { buildRoutes } from './routes';

afterEach(cleanup);

function renderAt(path: string, extraFeatures: FeatureModule[] = []) {
  const router = createMemoryRouter(buildRoutes([...features, ...extraFeatures]), {
    initialEntries: [path],
  });
  return render(<RouterProvider router={router} />);
}

describe('app shell', () => {
  const destinations = [...navItems(features, 'tab'), ...navItems(features, 'header')];

  it.each(destinations.map((item) => [item.label, item.to]))(
    'renders every nav destination inside the layout: "%s" at %s',
    async (label, to) => {
      renderAt(to);
      expect(await screen.findByRole('heading', { level: 1, name: label })).toBeTruthy();
    },
  );

  it('lists the tab destinations in the main navigation, in registry order', async () => {
    renderAt('/');
    await screen.findByRole('heading', { level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Navigare principală' });
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(labels).toEqual(navItems(features, 'tab').map((item) => item.label));
  });

  it('shows a Romanian not-found page with a way back for unknown paths', async () => {
    renderAt('/nu-exista');
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagină negăsită' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Înapoi la Acasă' }).getAttribute('href')).toBe('/');
  });

  it('keeps the navigation visible when a screen throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const crashing: FeatureModule = {
      id: 'crashing',
      routes: [
        {
          path: 'crash',
          Component: () => {
            throw new Error('boom');
          },
        },
      ],
    };
    renderAt('/crash', [crashing]);
    expect(await screen.findByText('A apărut o eroare')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Navigare principală' })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it('renders settings sections contributed by any feature, ordered by `order`', async () => {
    const section = (
      id: string,
      order: number,
    ): NonNullable<FeatureModule['settingsSections']>[number] => ({
      id,
      title: `Secțiunea ${id}`,
      order,
      Component: () => <p>conținut {id}</p>,
    });
    const contributor: FeatureModule = {
      id: 'contributor',
      routes: [],
      settingsSections: [section('b', 2000), section('a', 1000)],
    };
    renderAt('/setari', [contributor]);

    const first = await screen.findByRole('heading', { level: 2, name: 'Secțiunea a' });
    const second = screen.getByRole('heading', { level: 2, name: 'Secțiunea b' });
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(await screen.findByText('conținut a')).toBeTruthy();
  });
});
