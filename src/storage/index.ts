// Public surface of the storage layer (Dexie/IndexedDB). Import from '@/storage'.
// `./testing` (in-memory test databases) is intentionally not re-exported.
export { exportBackup, importBackup } from './backup';
export type { BackupExport, ImportMode, ImportReport, SkippedRecord, TableReport } from './backup';
export { DEFAULT_DB_NAME, PretometruDB } from './db';
export { applyMigrations, MIGRATIONS, SCHEMA_V1 } from './migrations';
export type { Migration } from './migrations';
export { getDb, openDb } from './open';
export type { OpenDbOptions } from './open';
export {
  createRecord,
  getActive,
  listActive,
  purgeTombstones,
  softDelete,
  updateRecord,
} from './records';
export type { NewRecord, RecordPatch, StorageContext } from './records';
export {
  deleteReceipt,
  findDuplicateReceipts,
  getReceiptWithLines,
  reconcileReceiptLines,
  saveReceipt,
} from './receipts';
export type { DuplicateCandidate, LineInput, ReceiptInput } from './receipts';
export { ensureSeed } from './seed';
export { deleteKeyValue, getKeyValue, getSetting, setKeyValue, setSetting } from './settings';
