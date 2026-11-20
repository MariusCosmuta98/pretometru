import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

// No screen of its own: the feature is a card of the Settings screen (after the backup, before the
// offline card). The "Citește cu AI" action lives in the review of a receipt.
export default defineFeature({
  id: 'ai',
  routes: [],
  settingsSections: [
    {
      id: 'ai',
      title: 'Gemini (opțional)',
      order: 590,
      Component: lazy(() => import('./AiSection')),
    },
  ],
});
