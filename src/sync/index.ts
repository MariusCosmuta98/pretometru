// Public surface of GitHub sync (React-free): a private repository of the user's own as the backup
// and the way to share data between devices. Import from '@/sync'. `./testing` (the in-memory
// GitHub the tests run against) is intentionally not re-exported.
export {
  disconnect,
  lockToken,
  readConnection,
  readTokenProtection,
  saveConnection,
  setAutoSync,
  unlockToken,
} from './connection';
export type { Connection, ConnectionInput, TokenProtection } from './connection';
export { syncNow } from './engine';
export type { SyncOptions, SyncResult } from './engine';
export { isAbortError, isBlockingCode, isSyncError, SYNC_ERROR_CODES, SyncError } from './errors';
export type { SyncErrorCode } from './errors';
export { isValidRepoRef, parseRepoRef, tokenKind } from './github';
export type { TokenKind } from './github';
export { runSync } from './run';
export { getSyncRuntime, resetSyncRuntime, subscribeSyncRuntime } from './runtime';
export type { SyncPhase, SyncRuntime } from './runtime';
export { getSyncServices, resetSyncServices, setSyncServices } from './services';
export type { SyncServices } from './services';
export { latestChange, loadSyncView, readStatus } from './status';
export type { SyncStatus, SyncView } from './status';
export { isPlausibleRepoInput, verifyConnection } from './verify';
export type { ConnectionCheck, RemoteSummary, VerifyInput, VerifyStep } from './verify';
