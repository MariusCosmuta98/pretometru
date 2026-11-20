import Dexie, { type DexieOptions, type Table } from 'dexie';
import type {
  Alias,
  Category,
  KeyValue,
  Line,
  List,
  ListItem,
  Product,
  Receipt,
  Store,
} from '@/domain';
import { applyMigrations, MIGRATIONS, type Migration } from './migrations';

export const DEFAULT_DB_NAME = 'pretometru';

/**
 * The whole IndexedDB model of plan §6. Records carry `id` (ULID), `updatedAt` and `deletedAt`;
 * `settings` and `syncState` are key-value tables. Write through the helpers in this folder, not
 * with raw `put`, so ids, timestamps, validation and tombstones stay consistent.
 */
export class PretometruDB extends Dexie {
  declare stores: Table<Store, string>;
  declare receipts: Table<Receipt, string>;
  declare lines: Table<Line, string>;
  declare products: Table<Product, string>;
  declare aliases: Table<Alias, string>;
  declare categories: Table<Category, string>;
  declare lists: Table<List, string>;
  declare listItems: Table<ListItem, string>;
  /** Preferences (see `SETTING_DEFINITIONS`); only portable keys are backed up. */
  declare settings: Table<KeyValue, string>;
  /** Device-local sync bookkeeping and credentials; never exported. */
  declare syncState: Table<KeyValue, string>;

  constructor(
    name: string = DEFAULT_DB_NAME,
    migrations: readonly Migration[] = MIGRATIONS,
    options?: DexieOptions,
  ) {
    super(name, options);
    applyMigrations(this, migrations);
  }
}
