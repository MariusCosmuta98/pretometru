import { describe, expect, it } from 'vitest';
import type { FeatureModule } from './feature';
import { assertValidFeatures, navItems, routePaths } from './registry';

const NavIcon = 'home' as const;

function feature(id: string, paths: string[], extra: Partial<FeatureModule> = {}): FeatureModule {
  return {
    id,
    routes: paths.map((path) => (path === '' ? { index: true } : { path })),
    ...extra,
  };
}

describe('routePaths', () => {
  it('flattens nested and index routes into absolute paths', () => {
    expect(
      routePaths([
        { index: true },
        { path: 'produse', children: [{ index: true }, { path: ':productId' }] },
        { path: 'setari' },
      ]),
    ).toEqual(['/', '/produse', '/produse/:productId', '/setari']);
  });
});

describe('assertValidFeatures', () => {
  it('accepts features with distinct ids and paths and resolvable nav targets', () => {
    expect(() =>
      assertValidFeatures([
        feature('home', [''], { nav: { to: '/', label: 'Acasă', icon: NavIcon, order: 1 } }),
        feature('receipts', ['bonuri', 'bonuri/:receiptId']),
      ]),
    ).not.toThrow();
  });

  it('rejects two features that claim the same path, even with different param names', () => {
    expect(() =>
      assertValidFeatures([
        feature('catalog', ['produse/:id']),
        feature('analytics', ['produse/:productId']),
      ]),
    ).toThrow(/catalog.*analytics|analytics.*catalog/);
  });

  it('rejects duplicate feature ids', () => {
    expect(() =>
      assertValidFeatures([feature('lists', ['liste']), feature('lists', ['x'])]),
    ).toThrow(/duplicate feature id "lists"/i);
  });

  it('rejects a nav item that points to no registered route', () => {
    expect(() =>
      assertValidFeatures([
        feature('lists', ['liste'], {
          nav: { to: '/liste-lipsa', label: 'Liste', icon: NavIcon, order: 1 },
        }),
      ]),
    ).toThrow(/\/liste-lipsa/);
  });

  it('rejects duplicate settings section ids across features', () => {
    const section = (id: string) => ({ id, title: 'Titlu', order: 1, Component: () => null });
    expect(() =>
      assertValidFeatures([
        feature('sync', ['sync'], { settingsSections: [section('sync')] }),
        feature('ai', ['ai'], { settingsSections: [section('sync')] }),
      ]),
    ).toThrow(/duplicate settings section id "sync"/i);
  });
});

describe('navItems', () => {
  const nav = (order: number, placement?: 'tab' | 'header') => ({
    to: '/',
    label: `n${order}`,
    icon: NavIcon,
    order,
    placement,
  });

  it('returns only the requested placement (tab by default), sorted by order', () => {
    const features = [
      feature('c', [''], { nav: nav(30) }),
      feature('a', ['a'], { nav: nav(10) }),
      feature('h', ['h'], { nav: nav(5, 'header') }),
      feature('b', ['b'], { nav: nav(20, 'tab') }),
      feature('none', ['n']),
    ];
    expect(navItems(features, 'tab').map((i) => i.label)).toEqual(['n10', 'n20', 'n30']);
    expect(navItems(features, 'header').map((i) => i.label)).toEqual(['n5']);
  });
});
