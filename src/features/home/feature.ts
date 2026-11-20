import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'home',
  nav: { to: '/', label: 'Acasă', icon: 'home', order: 10 },
  routes: [{ index: true, handle: { title: 'Acasă' }, lazy: () => import('./HomeScreen') }],
});
