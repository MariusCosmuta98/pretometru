import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'lists',
  nav: { to: '/liste', label: 'Liste', icon: 'list', order: 50 },
  routes: [
    { path: 'liste', handle: { title: 'Liste' }, lazy: () => import('./ListsScreen') },
    { path: 'liste/:listId', handle: { title: 'Listă' }, lazy: () => import('./ListScreen') },
  ],
});
