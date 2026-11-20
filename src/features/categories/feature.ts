import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

// A card in Settings that links to the screen where the categories are managed.
export default defineFeature({
  id: 'categories',
  routes: [
    {
      path: 'setari/categorii',
      handle: { title: 'Categorii' },
      lazy: () => import('./CategoriesScreen'),
    },
  ],
  settingsSections: [
    {
      id: 'categories',
      title: 'Categorii',
      order: 100,
      Component: lazy(() => import('./CategoriesSection')),
    },
  ],
});
