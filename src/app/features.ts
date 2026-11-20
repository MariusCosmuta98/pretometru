import type { FeatureModule } from './feature';

const modules = import.meta.glob<FeatureModule>('../features/*/feature.ts', {
  eager: true,
  import: 'default',
});

/** Every `src/features/<name>/feature.ts`, in path order. */
export const features: readonly FeatureModule[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, feature]) => feature);
