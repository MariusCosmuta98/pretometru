const muted = 'text-sm text-slate-600 dark:text-slate-400';

export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className={muted}>
      Se încarcă {what}…
    </p>
  );
}

/** A failed load (usually IndexedDB being unavailable): the shell and navigation keep working. */
export function Failure({ children }: { children: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </div>
  );
}
