import { Link, NavLink } from 'react-router';
import { Icon } from '@/ui/icons';
import type { FeatureNavItem } from './feature';

const TAB_BASE =
  'flex flex-col items-center gap-0.5 px-1 py-2 text-xs font-medium outline-offset-[-2px] ' +
  'md:flex-row md:gap-3 md:rounded-lg md:px-3 md:py-2 md:text-sm';

/** Bottom tab bar on phones, sidebar from `md` up. */
export function MainNav({ items }: { items: readonly FeatureNavItem[] }) {
  return (
    <nav
      aria-label="Navigare principală"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0 md:border-t-0 md:border-r md:pb-0 dark:border-slate-800 dark:bg-slate-900/95"
    >
      <ul className="flex items-end md:flex-col md:items-stretch md:gap-1 md:p-3">
        {items.map((item) => (
          <li key={item.to} className="flex-1 md:flex-none">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `${TAB_BASE} ${
                  isActive
                    ? 'text-teal-700 md:bg-teal-50 dark:text-teal-300 md:dark:bg-teal-950'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100'
                }`
              }
            >
              {item.emphasis ? (
                <span className="-mt-5 flex size-11 items-center justify-center rounded-full bg-teal-700 text-white shadow-md md:mt-0 md:size-6 md:bg-transparent md:text-inherit md:shadow-none">
                  <Icon name={item.icon} className="size-6" />
                </span>
              ) : (
                <Icon name={item.icon} className="size-6" />
              )}
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Icon-only shortcuts shown in the app bar (e.g. Statistici, Setări). */
export function HeaderNav({ items }: { items: readonly FeatureNavItem[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Navigare secundară">
      <ul className="flex items-center gap-1">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              aria-label={item.label}
              title={item.label}
              className="flex size-10 items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Icon name={item.icon} className="size-6" />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
