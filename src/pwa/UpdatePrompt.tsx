import { useRegisterSW } from 'virtual:pwa-register/react';

/** Asks before swapping in a new service worker so an update never interrupts data entry. */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();

  if (!needRefresh && !offlineReady) return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:bottom-6 dark:border-slate-700 dark:bg-slate-900"
    >
      <p className="text-sm">
        {needRefresh
          ? 'Este disponibilă o versiune nouă a aplicației.'
          : 'Aplicația poate fi folosită și fără internet.'}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        {needRefresh ? (
          <button
            type="button"
            onClick={() => {
              void updateServiceWorker(true);
            }}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Actualizează
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setNeedRefresh(false);
            setOfflineReady(false);
          }}
          className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Închide
        </button>
      </div>
    </div>
  );
}
