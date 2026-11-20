// Page-side surface of the PWA module. Safe to import from features and tests: it has no
// `virtual:pwa-register` (that is `UpdatePrompt`, imported by `main.tsx` only) and nothing runs on import.
// The service worker (`sw.ts`) and its helpers are bundled separately and are not exported here.
export type { EngineStatus, PrepareProgress } from './engine-cache';
export type { EngineId } from './offline-rules';
export {
  browserStorageEnv,
  readPersistence,
  requestPersistence,
  type PersistenceState,
  type StorageEnv,
} from './persistence';
export {
  createEnginesClient,
  enginesClient,
  readOfflineReadiness,
  type EnginesClient,
  type OfflineReadiness,
} from './sw-client';
export { useSharedFiles } from './useSharedFiles';
