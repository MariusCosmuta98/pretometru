import { createContext, useContext } from 'react';
import type { FeatureModule } from './feature';

export const FeaturesContext = createContext<readonly FeatureModule[]>([]);

/** The registered features, as given to `buildRoutes`. */
export function useFeatures(): readonly FeatureModule[] {
  return useContext(FeaturesContext);
}
