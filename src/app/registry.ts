import type { RouteObject } from 'react-router';
import type { FeatureModule, FeatureNavItem, SettingsSection } from './feature';

function joinPath(prefix: string, path: string): string {
  const joined = path.startsWith('/') ? path : `${prefix}/${path}`;
  const normalized = `/${joined.split('/').filter(Boolean).join('/')}`;
  return normalized;
}

/** Absolute paths matched by a route tree (index routes resolve to their parent's path). */
export function routePaths(routes: readonly RouteObject[], prefix = ''): string[] {
  const paths = routes.flatMap((route) => {
    const own = route.index
      ? prefix || '/'
      : route.path === undefined
        ? undefined
        : joinPath(prefix, route.path);
    const nested = route.children ? routePaths(route.children, own ?? prefix) : [];
    return own === undefined ? nested : [own, ...nested];
  });
  return [...new Set(paths)];
}

// `/produse/:id` and `/produse/:productId` are the same route as far as matching goes.
const withoutParamNames = (path: string) => path.replace(/:[^/?]+/g, ':');

/** Fails fast on mistakes that React Router would otherwise swallow (shadowed routes, dead nav links). */
export function assertValidFeatures(features: readonly FeatureModule[]): void {
  const featureIds = new Set<string>();
  const pathOwners = new Map<string, string>();
  const sectionOwners = new Map<string, string>();

  for (const feature of features) {
    if (featureIds.has(feature.id)) throw new Error(`Duplicate feature id "${feature.id}"`);
    featureIds.add(feature.id);

    for (const path of routePaths(feature.routes)) {
      const owner = pathOwners.get(withoutParamNames(path));
      if (owner !== undefined && owner !== feature.id) {
        throw new Error(`Route ${path} is declared by both "${owner}" and "${feature.id}"`);
      }
      pathOwners.set(withoutParamNames(path), feature.id);
    }

    for (const section of feature.settingsSections ?? []) {
      const owner = sectionOwners.get(section.id);
      if (owner !== undefined) {
        throw new Error(
          `Duplicate settings section id "${section.id}" (features "${owner}" and "${feature.id}")`,
        );
      }
      sectionOwners.set(section.id, feature.id);
    }
  }

  for (const feature of features) {
    if (feature.nav && !pathOwners.has(withoutParamNames(feature.nav.to))) {
      throw new Error(
        `Feature "${feature.id}": nav target ${feature.nav.to} does not match any registered route`,
      );
    }
  }
}

export function navItems(
  features: readonly FeatureModule[],
  placement: 'tab' | 'header',
): FeatureNavItem[] {
  return features
    .flatMap((feature) => (feature.nav ? [feature.nav] : []))
    .filter((item) => (item.placement ?? 'tab') === placement)
    .sort((a, b) => a.order - b.order);
}

export function settingsSections(features: readonly FeatureModule[]): SettingsSection[] {
  return features
    .flatMap((feature) => feature.settingsSections ?? [])
    .sort((a, b) => a.order - b.order);
}
