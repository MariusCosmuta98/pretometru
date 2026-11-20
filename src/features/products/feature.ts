import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'products',
  nav: { to: '/produse', label: 'Produse', icon: 'tag', order: 40 },
  routes: [
    { path: 'produse', handle: { title: 'Produse' }, lazy: () => import('./ProductsScreen') },
    {
      path: 'produse/:productId',
      handle: { title: 'Produs' },
      lazy: () => import('./ProductScreen'),
    },
  ],
});
