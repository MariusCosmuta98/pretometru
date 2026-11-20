import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'add-receipt',
  nav: { to: '/adauga', label: 'Adaugă bon', icon: 'plus', order: 30, emphasis: true },
  routes: [
    {
      path: 'adauga',
      handle: { title: 'Adaugă bon' },
      lazy: () => import('./AddReceiptScreen'),
    },
  ],
});
