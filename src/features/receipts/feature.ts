import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'receipts',
  nav: { to: '/bonuri', label: 'Bonuri', icon: 'receipt', order: 20 },
  routes: [
    { path: 'bonuri', handle: { title: 'Bonuri' }, lazy: () => import('./ReceiptsScreen') },
    {
      path: 'bonuri/:receiptId',
      handle: { title: 'Review bon' },
      lazy: () => import('./ReviewScreen'),
    },
  ],
});
