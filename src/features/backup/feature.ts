import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

// No screen of its own: export and import are a card of the Settings screen (after sync, before offline).
export default defineFeature({
  id: 'backup',
  routes: [],
  settingsSections: [
    {
      id: 'backup',
      title: 'Copie de siguranță',
      order: 580,
      Component: lazy(() => import('./BackupSection')),
    },
  ],
});
