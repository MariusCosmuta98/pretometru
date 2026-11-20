import { lazy } from 'react';
import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'settings',
  nav: { to: '/setari', label: 'Setări', icon: 'sliders', order: 20, placement: 'header' },
  routes: [{ path: 'setari', handle: { title: 'Setări' }, lazy: () => import('./SettingsScreen') }],
  settingsSections: [
    {
      id: 'about',
      title: 'Despre aplicație',
      order: 1000,
      Component: lazy(() => import('./AboutSection')),
    },
  ],
});
