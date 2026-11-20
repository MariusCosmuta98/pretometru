import { defineFeature } from '@/app/feature';
import { lazy } from 'react';

// No routes: the offline and storage controls are a card in Settings (docs/architecture.md §3).
export default defineFeature({
  id: 'offline',
  routes: [],
  settingsSections: [
    {
      id: 'offline',
      title: 'Offline și stocare',
      order: 600,
      Component: lazy(() => import('./OfflineSection')),
    },
  ],
});
