import type { SyncFailure } from './errors';

export type SyncPhase = 'checking' | 'downloading' | 'merging' | 'uploading';

/** How a sync ended: `failure` is absent when it succeeded. */
export interface SyncAttempt {
  /** When it ended (ISO). */
  readonly at: string;
  readonly failure: SyncFailure | undefined;
}

/** What a screen needs to know about the sync of this session, beyond what the database says. */
export interface SyncRuntime {
  readonly running: boolean;
  readonly phase: SyncPhase | undefined;
  /** The passphrase of a protected token was entered since the app started. */
  readonly unlocked: boolean;
  /**
   * How the sync that ended last in this session came out, whoever started it. A screen has it the
   * moment the sync ends, while the stored status reaches it through a live query a moment later:
   * `currentFailure` (status.ts) decides which of the two is the newer.
   */
  readonly lastAttempt: SyncAttempt | undefined;
}

const IDLE: SyncRuntime = {
  running: false,
  phase: undefined,
  unlocked: false,
  lastAttempt: undefined,
};

let state: SyncRuntime = IDLE;
const listeners = new Set<() => void>();

/** A stable snapshot: the same object until something changes (for `useSyncExternalStore`). */
export function getSyncRuntime(): SyncRuntime {
  return state;
}

export function subscribeSyncRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSyncRuntime(patch: Partial<SyncRuntime>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function resetSyncRuntime(): void {
  setSyncRuntime(IDLE);
}
