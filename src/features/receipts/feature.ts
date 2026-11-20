import { defineFeature } from '@/app/feature';

// A route module here is its screen (`Component`) plus its data (`loader`); they live in separate
// files so the screen files export components only (fast refresh).
const receiptsRoute = async () => {
  const [{ Component }, { loader }] = await Promise.all([
    import('./ReceiptsScreen'),
    import('./receiptsLoader'),
  ]);
  return { Component, loader };
};

const reviewRoute = async () => {
  const [{ Component }, { loader }] = await Promise.all([
    import('./ReviewScreen'),
    import('./reviewLoader'),
  ]);
  return { Component, loader };
};

export default defineFeature({
  id: 'receipts',
  nav: { to: '/bonuri', label: 'Bonuri', icon: 'receipt', order: 20 },
  routes: [
    { path: 'bonuri', handle: { title: 'Bonuri' }, lazy: receiptsRoute },
    // A receipt typed in by hand: nothing is stored until it is saved for the first time.
    { path: 'bonuri/nou', handle: { title: 'Bon nou' }, lazy: reviewRoute },
    { path: 'bonuri/:receiptId', handle: { title: 'Review bon' }, lazy: reviewRoute },
  ],
});
