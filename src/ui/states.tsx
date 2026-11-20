import { noticeClass } from './controls';

/** `Se încarcă categoriile…`, for a screen that waits for the database. */
export function Loading({ what }: { what: string }) {
  return (
    <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
      Se încarcă {what}…
    </p>
  );
}

/** A failed load (usually IndexedDB being unavailable): the shell and navigation keep working. */
export function Failure({ children }: { children: string }) {
  return (
    <div role="alert" className={noticeClass.error}>
      {children}
    </div>
  );
}
