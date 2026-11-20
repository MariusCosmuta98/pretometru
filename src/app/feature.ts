import type { ComponentType } from 'react';
import type { RouteObject } from 'react-router';
import type { IconName } from '@/ui/icons';

/** Typed shape of `RouteObject.handle` used by the app shell. */
export interface RouteHandle {
  /** Romanian page title, shown in the app bar and in `document.title`. */
  title?: string;
}

export interface FeatureNavItem {
  /** Absolute path that must match one of the feature's (or another feature's) routes. */
  to: string;
  /** Romanian label. */
  label: string;
  icon: IconName;
  /** Ascending order inside the placement. */
  order: number;
  /** `tab`: bottom bar on phones, sidebar on wide screens (default). `header`: icon in the app bar. */
  placement?: 'tab' | 'header';
  /** Highlight as the main call to action (e.g. "Adaugă bon"). */
  emphasis?: boolean;
}

/** A card rendered by the Settings screen. Lets features add settings without editing that screen. */
export interface SettingsSection {
  id: string;
  /** Romanian title. */
  title: string;
  order: number;
  /** May be a `React.lazy` component. */
  Component: ComponentType;
}

/**
 * Everything a feature contributes to the app shell. Each folder under `src/features/<name>/`
 * default-exports one of these from `feature.ts`; the shell discovers them with `import.meta.glob`,
 * so adding a feature never requires editing a shared file.
 */
export interface FeatureModule {
  /** Unique, kebab-case, matches the folder name. */
  id: string;
  nav?: FeatureNavItem;
  /** Children of the layout route: paths are relative to the app root ('bonuri', 'bonuri/:receiptId'). */
  routes: RouteObject[];
  settingsSections?: SettingsSection[];
}

export function defineFeature(feature: FeatureModule): FeatureModule {
  return feature;
}
