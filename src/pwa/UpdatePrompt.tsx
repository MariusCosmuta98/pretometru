import { useEffect } from 'react';
import { useRegisterSW } from './register';

/**
 * How long "works offline" stays when nobody touches the page: a few words, read in a couple of seconds.
 * The same information stays in Settings, under "Offline și stocare".
 */
export const OFFLINE_NOTICE_MS = 8_000;

const CARD =
  'fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg md:bottom-6 dark:border-slate-700 dark:bg-slate-900';

/**
 * Two different things share this corner of the screen.
 *
 * The new-version prompt is a question: it waits for the user's answer however long that takes, and nothing
 * but "Actualizează" activates the new version, so an update never interrupts data entry.
 *
 * "Works offline" is only information, and it is fixed over the bottom of the page, where the last controls
 * of a long screen end up. So it must never be in their way: it ignores taps (they reach what is under it),
 * has nothing to press or to focus, and goes away after a few seconds or at the first tap or key press.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW();
  const informing = offlineReady && !needRefresh;

  useEffect(() => {
    if (!informing) return undefined;
    const done = () => {
      setOfflineReady(false);
    };
    const timer = setTimeout(done, OFFLINE_NOTICE_MS);
    // Capturing, so the notice is gone before the page reacts to the tap or the key.
    document.addEventListener('pointerdown', done, true);
    document.addEventListener('keydown', done, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', done, true);
      document.removeEventListener('keydown', done, true);
    };
  }, [informing, setOfflineReady]);

  if (!needRefresh && !offlineReady) return null;

  return (
    <div role="status" className={informing ? `${CARD} pointer-events-none` : CARD}>
      <p className="text-sm">
        {needRefresh
          ? 'Este disponibilă o versiune nouă a aplicației.'
          : 'Aplicația poate fi folosită și fără internet.'}
      </p>
      {needRefresh ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              void updateServiceWorker(true);
            }}
            className="rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800"
          >
            Actualizează
          </button>
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
      ) : null}
    </div>
  );
}
