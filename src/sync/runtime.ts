export type SyncPhase = 'checking' | 'downloading' | 'merging' | 'uploading';

/** What a screen needs to know about the sync of this session, beyond what the database says. */
export interface SyncRuntime {
  readonly running: boolean;
  readonly phase: SyncPhase | undefined;
  /** The passphrase of a protected token was entered since the app started. */
  readonly unlocked: boolean;
}

const IDLE: SyncRuntime = { running: false, phase: undefined, unlocked: false };

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
