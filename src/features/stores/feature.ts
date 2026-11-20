import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

// A card in Settings that links to the screen where the stores are managed.
export default defineFeature({
  id: 'stores',
  routes: [
    {
      path: 'setari/magazine',
      handle: { title: 'Magazine' },
      lazy: () => import('./StoresScreen'),
    },
  ],
  settingsSections: [
    {
      id: 'stores',
      title: 'Magazine',
      order: 200,
      Component: lazy(() => import('./StoresSection')),
    },
  ],
});
