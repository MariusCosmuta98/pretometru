import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from '@/app/router';
import { PersistenceWatcher } from '@/pwa/PersistenceWatcher';
import { UpdatePrompt } from '@/pwa/UpdatePrompt';
import './styles/index.css';

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Missing #root element');

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
    <UpdatePrompt />
    <PersistenceWatcher />
  </StrictMode>,
);

// Syncs with the user's GitHub repository by itself, when that is set up (src/sync/auto.ts).
// Loaded after the first render, so that sync never slows the start of the app.
void import('@/sync').then(({ startAutoSync }) => startAutoSync()).catch(() => undefined);
