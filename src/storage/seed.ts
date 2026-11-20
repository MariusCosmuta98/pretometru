import { SEED_CATEGORIES } from '@/domain';
import type { PretometruDB } from './db';

/**
 * Inserts the built-in categories that are not in the database yet. Safe to run on every start:
 * a seed category the user edited or deleted (a tombstone is still a row) is left alone, and
 * categories added by a later app version appear on the next start.
 */
export function ensureSeed(db: PretometruDB): Promise<void> {
  return db.transaction('rw', db.categories, async () => {
    const existing = await db.categories.bulkGet(SEED_CATEGORIES.map((category) => category.id));
    const missing = SEED_CATEGORIES.filter((_category, index) => existing[index] === undefined);
    if (missing.length > 0) await db.categories.bulkAdd([...missing]);
  });
}
