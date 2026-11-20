import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

// No screen of its own: the feature is a card of the Settings screen.
export default defineFeature({
  id: 'sync',
  routes: [],
  settingsSections: [
    {
      id: 'sync',
      title: 'Sincronizare GitHub',
      order: 500,
      Component: lazy(() => import('./SyncSection')),
    },
  ],
});
