import { useEffect } from 'react';
import { Outlet, useMatches } from 'react-router';
import type { RouteHandle } from './feature';
import { useFeatures } from './FeaturesContext';
import { HeaderNav, MainNav } from './MainNav';
import { navItems } from './registry';

const APP_NAME = 'Pretometru';

function useRouteTitle(): string | undefined {
  const matches = useMatches();
  for (const match of matches.toReversed()) {
    const title = (match.handle as RouteHandle | undefined)?.title;
    if (title) return title;
  }
  return undefined;
}

export function AppLayout() {
  const features = useFeatures();
  const title = useRouteTitle();

  useEffect(() => {
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;
  }, [title]);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 md:flex-row dark:bg-slate-950 dark:text-slate-100">
      <MainNav items={navItems(features, 'tab')} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
          <h1 className="truncate text-lg font-semibold">{title ?? APP_NAME}</h1>
          <HeaderNav items={navItems(features, 'header')} />
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-4 pb-28 md:pb-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
