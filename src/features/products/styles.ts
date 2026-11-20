// Shared Tailwind class strings for the product screens (the shell's slate/teal palette, light and dark).
export const card =
  'rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900';

const buttonBase =
  'inline-flex min-h-10 items-center justify-center rounded-lg px-3 py-2 text-sm font-medium ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50';

export const button = `${buttonBase} border border-slate-300 bg-white text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800`;

export const primaryButton = `${buttonBase} bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-500`;

export const dangerButton = `${buttonBase} bg-red-700 text-white hover:bg-red-800`;

export const field =
  'min-h-10 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

export const muted = 'text-sm text-slate-600 dark:text-slate-400';

export const sectionTitle = 'mb-2 text-base font-semibold';
