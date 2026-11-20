/*
 * Shared Tailwind class strings for buttons, fields and notices, so every screen looks and
 * behaves alike: 44 px touch targets, a visible keyboard focus ring and dark-mode colours.
 */

const FOCUS =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 dark:focus-visible:outline-teal-400';

const BUTTON =
  `inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium ` +
  `transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;

export const card =
  'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900';

export const buttonPrimary = `${BUTTON} bg-teal-700 text-white hover:bg-teal-800 disabled:hover:bg-teal-700`;

export const buttonSecondary =
  `${BUTTON} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 ` +
  `dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;

export const buttonDanger = `${BUTTON} bg-red-700 text-white hover:bg-red-800`;

export const buttonQuiet = `${BUTTON} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`;

export const labelClass = 'mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300';

// 16 px text keeps iOS from zooming the page when a field gets focus.
export const inputClass =
  `block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base ` +
  `text-slate-900 placeholder:text-slate-400 disabled:opacity-60 aria-[invalid=true]:border-red-600 ` +
  `dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 ${FOCUS}`;

export const noticeClass = {
  info: 'rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-100',
  success:
    'rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-100',
  warning:
    'rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
  error:
    'rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-100',
} as const;
