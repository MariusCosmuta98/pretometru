import { liveQuery } from 'dexie';
import { isBlockingCode } from './errors';
import { runSync } from './run';
import { getSyncRuntime } from './runtime';
import { getSyncServices } from './services';
import { latestChange, loadSyncView } from './status';

/**
 * Why an automatic sync is considered: the app started, the user came back to it, the device came
 * back online, or data changed on this device.
 */
export type AutoSyncReason = 'start' | 'visible' | 'online' | 'change';

/** What automatic sync watches and how it waits; the browser's own by default, fakes in tests. */
export interface AutoSyncEnvironment {
  now(): number;
  /** Runs `fn` after `ms` and returns what cancels it. */
  setTimer(fn: () => void, ms: number): () => void;
  /** Calls `callback` whenever the page becomes visible again. */
  onVisible(callback: () => void): () => void;
  onOnline(callback: () => void): () => void;
  /** Calls `callback` after every change of the data on this device (not for the current state). */
  watchChanges(callback: () => void): () => void;
}

export interface AutoSyncTuning {
  /** Lets the app finish loading before the first attempt. */
  startDelay: number;
  /** Waits for a burst of edits to end (a receipt being reviewed) before sending it. */
  changeDelay: number;
  /** No two automatic attempts closer than this. */
  minGap: number;
  /** Coming back to the app syncs only when the last attempt is older than this. */
  visibleGap: number;
}

export const AUTO_SYNC_TUNING: AutoSyncTuning = {
  startDelay: 3_000,
  changeDelay: 30_000,
  minGap: 10_000,
  visibleGap: 5 * 60_000,
};

/** What `startAutoSync` hands back. */
export interface AutoSync {
  /** Cancels every timer and listener; an attempt already running finishes. */
  stop(): void;
  /** Resolves when no automatic attempt is running (for tests). */
  idle(): Promise<void>;
}

export function browserEnvironment(): AutoSyncEnvironment {
  return {
    now: () => Date.now(),
    setTimer: (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    onVisible: (callback) => {
      const handler = () => {
        if (document.visibilityState === 'visible') callback();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
    onOnline: (callback) => {
      window.addEventListener('online', callback);
      return () => window.removeEventListener('online', callback);
    },
    watchChanges: (callback) => {
      let cancelled = false;
      let unsubscribe: (() => void) | undefined;
      getSyncServices()
        .getDb()
        .then(
          (db) => {
            if (cancelled) return;
            let initial = true;
            // The newest `updatedAt` moves with every local write (and every merge): a cheap signal.
            const subscription = liveQuery(async () => await latestChange(db)).subscribe({
              next: () => {
                if (initial) initial = false;
                else callback();
              },
              error: () => undefined,
            });
            unsubscribe = () => subscription.unsubscribe();
          },
          () => undefined,
        );
      return () => {
        cancelled = true;
        unsubscribe?.();
      };
    },
  };
}

/**
 * Syncs by itself, simply and predictably: once when the app starts, when the user comes back to
 * it, when the device is back online, and a little after data changed on this device. It only
 * runs when sync is set up with automatic sync on, the device is online and the token is usable
 * (a passphrase-protected one has to be unlocked first). After an error that retrying cannot fix
 * (a revoked token, a public repository) it stops until a manual sync succeeds; after a rate limit
 * it waits for the time GitHub gave. Everything else is left to the next trigger, never retried in
 * a loop.
 */
export function startAutoSync(
  environment: AutoSyncEnvironment = browserEnvironment(),
  tuning: Partial<AutoSyncTuning> = {},
): AutoSync {
  const settings = { ...AUTO_SYNC_TUNING, ...tuning };
  const timers = new Set<() => void>();
  const running = new Set<Promise<void>>();
  let changeTimer: (() => void) | undefined;
  let otherPending = false;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let stopped = false;

  function later(fn: () => void, ms: number): () => void {
    const cancel = environment.setTimer(() => {
      timers.delete(cancel);
      fn();
    }, ms);
    timers.add(cancel);
    return () => {
      timers.delete(cancel);
      cancel();
    };
  }

  // Attempts never reject; keeping them lets `idle` wait for the ones in flight.
  function launch(reason: AutoSyncReason): void {
    const promise: Promise<void> = attempt(reason).finally(() => running.delete(promise));
    running.add(promise);
  }

  async function mayRun(reason: AutoSyncReason): Promise<boolean> {
    const services = getSyncServices();
    const view = await loadSyncView(await services.getDb());
    const { connection, status, protection } = view;
    if (!connection?.auto || !services.isOnline()) return false;
    if (protection === 'passphrase' && !getSyncRuntime().unlocked) return false;

    if (status && !status.ok && status.error) {
      if (isBlockingCode(status.error.code)) return false;
      const retryAt = status.error.retryAt ? Date.parse(status.error.retryAt) : Number.NaN;
      if (retryAt > services.now().getTime()) return false;
    }
    if (reason === 'visible' && status) {
      const sinceLast = services.now().getTime() - Date.parse(status.at);
      if (sinceLast < settings.visibleGap) return false;
    }
    if (reason === 'change' && !view.unsynced) return false;
    return true;
  }

  async function attempt(reason: AutoSyncReason): Promise<void> {
    if (stopped) return;
    const waited = environment.now() - lastAttempt;
    if (waited < settings.minGap) {
      later(() => {
        launch(reason);
      }, settings.minGap - waited);
      return;
    }
    try {
      if (!(await mayRun(reason))) return;
      lastAttempt = environment.now();
      await runSync();
    } catch {
      // The outcome is in the sync status the Settings section shows; nothing to do here.
    }
  }

  function request(reason: AutoSyncReason): void {
    if (reason === 'change') {
      // A burst of edits is sent once, after it ends: each new change postpones the attempt.
      changeTimer?.();
      changeTimer = later(() => {
        changeTimer = undefined;
        launch('change');
      }, settings.changeDelay);
    } else if (!otherPending) {
      // One pending attempt is enough for the other reasons; the app starting is given a moment.
      otherPending = true;
      later(
        () => {
          otherPending = false;
          launch(reason);
        },
        reason === 'start' ? settings.startDelay : 0,
      );
    }
  }

  const stops = [
    environment.onVisible(() => request('visible')),
    environment.onOnline(() => request('online')),
    environment.watchChanges(() => request('change')),
  ];
  request('start');

  return {
    stop() {
      stopped = true;
      for (const cancel of [...timers]) cancel();
      for (const stop of stops) stop();
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running]);
    },
  };
}
