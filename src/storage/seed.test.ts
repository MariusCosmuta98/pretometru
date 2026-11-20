import { describe, expect, it } from 'vitest';
import { NON_PRODUCT_CATEGORY_ID, SEED_CATEGORIES } from '@/domain';
import { listActive, softDelete, updateRecord } from './records';
import { ensureSeed } from './seed';
import { createTestDb } from './testing';

describe('ensureSeed', () => {
  it('creates the plan §6 categories in an empty database', async () => {
    const db = await createTestDb();
    await ensureSeed(db);
    expect(await db.categories.toArray()).toEqual(SEED_CATEGORIES);
    expect(await db.categories.get(NON_PRODUCT_CATEGORY_ID)).toMatchObject({ system: true });
  });

  it('can run on every start: a second run changes nothing', async () => {
    const db = await createTestDb();
    await ensureSeed(db);
    await ensureSeed(db);
    expect(await db.categories.count()).toBe(SEED_CATEGORIES.length);
  });

  it('never overwrites a seed category the user edited', async () => {
    const db = await createTestDb();
    await ensureSeed(db);
    const first = SEED_CATEGORIES[0]!;
    await updateRecord(db.categories, first.id, { name: 'Lactate' });

    await ensureSeed(db);
    expect((await db.categories.get(first.id))?.name).toBe('Lactate');
  });

  it('never brings back a seed category the user deleted', async () => {
    const db = await createTestDb();
    await ensureSeed(db);
    const first = SEED_CATEGORIES[0]!;
    await softDelete(db.categories, first.id);

    await ensureSeed(db);
    expect((await listActive(db.categories)).some((c) => c.id === first.id)).toBe(false);
  });
});
