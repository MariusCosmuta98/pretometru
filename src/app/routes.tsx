import type { RouteObject } from 'react-router';
import { AppLayout } from './AppLayout';
import type { FeatureModule, RouteHandle } from './feature';
import { FeaturesContext } from './FeaturesContext';
import { Loading } from './Loading';
import { NotFound } from './NotFound';
import { assertValidFeatures } from './registry';
import { RouteError } from './RouteError';

/**
 * One layout route (app bar + navigation) around every feature's routes.
 * Screen errors are caught by the inner pathless route so the navigation stays usable.
 */
export function buildRoutes(features: readonly FeatureModule[]): RouteObject[] {
  assertValidFeatures(features);

  const notFoundHandle: RouteHandle = { title: 'Pagină negăsită' };

  return [
    {
      path: '/',
      element: (
        <FeaturesContext value={features}>
          <AppLayout />
        </FeaturesContext>
      ),
      ErrorBoundary: RouteError,
      children: [
        {
          ErrorBoundary: RouteError,
          HydrateFallback: Loading,
          children: [
            ...features.flatMap((feature) => feature.routes),
            { path: '*', Component: NotFound, handle: notFoundHandle },
          ],
        },
      ],
    },
  ];
}
