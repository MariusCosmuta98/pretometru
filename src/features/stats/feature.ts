import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'stats',
  nav: { to: '/statistici', label: 'Statistici', icon: 'chart', order: 10, placement: 'header' },
  routes: [
    { path: 'statistici', handle: { title: 'Statistici' }, lazy: () => import('./StatsScreen') },
  ],
});
