import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@/storage/testing';
import { findOrCreateStore, findStore, matchesStoreSpec, storeNameFor } from './stores';

let db: Awaited<ReturnType<typeof createTestDb>>;
beforeEach(async () => {
  db = await createTestDb();
});

describe('storeNameFor', () => {
  it('names known chains by their label and city, unknown ones by the printed name', () => {
    expect(storeNameFor({ chain: 'kaufland' })).toBe('Kaufland');
    expect(storeNameFor({ chain: 'metro', city: ' Cluj-Napoca ' })).toBe('METRO Cluj-Napoca');
    expect(storeNameFor({ chain: 'unknown', name: 'S.C. Alfa S.R.L.' })).toBe('S.C. Alfa S.R.L.');
    expect(storeNameFor({ chain: 'unknown' })).toBe('Alt magazin');
    // The printed legal name does not rename a known chain.
    expect(storeNameFor({ chain: 'lidl', name: 'S.C. LIDL DISCOUNT S.R.L.' })).toBe('Lidl');
  });
});

describe('findOrCreateStore', () => {
  it('creates a store once per chain and branch', async () => {
    const first = await findOrCreateStore(db, {
      chain: 'kaufland',
      branchCode: '1234',
      city: 'Cluj',
    });
    const again = await findOrCreateStore(db, {
      chain: 'kaufland',
      branchCode: '1234',
      city: ' cluj ',
      name: 'ignored',
    });
    const otherBranch = await findOrCreateStore(db, { chain: 'kaufland', branchCode: '9' });
    expect(again.id).toBe(first.id);
    expect(otherBranch.id).not.toBe(first.id);
    expect(first).toMatchObject({ chain: 'kaufland', name: 'Kaufland Cluj', branchCode: '1234' });
    expect(await db.stores.count()).toBe(2);
  });

  it('keeps unknown shops apart by their name', async () => {
    const alfa = await findOrCreateStore(db, { chain: 'unknown', name: 'Alfa' });
    const beta = await findOrCreateStore(db, { chain: 'unknown', name: 'Beta' });
    const anonymous = await findOrCreateStore(db, { chain: 'unknown' });
    expect(new Set([alfa.id, beta.id, anonymous.id]).size).toBe(3);
    expect((await findOrCreateStore(db, { chain: 'unknown', name: 'alfa' })).id).toBe(alfa.id);
  });

  it('ignores deleted stores and finds nothing for an unseen chain', async () => {
    expect(await findStore(db, { chain: 'lidl' })).toBeUndefined();
    const store = await findOrCreateStore(db, { chain: 'lidl' });
    await db.stores.put({ ...store, deletedAt: '2026-11-20T10:00:00.000Z' });
    expect(await findStore(db, { chain: 'lidl' })).toBeUndefined();
    expect((await findOrCreateStore(db, { chain: 'lidl' })).id).not.toBe(store.id);
  });

  it('matches a store against a spec', async () => {
    const store = await findOrCreateStore(db, { chain: 'metro', branchCode: '7' });
    expect(matchesStoreSpec(store, { chain: 'metro', branchCode: '7' })).toBe(true);
    expect(matchesStoreSpec(store, { chain: 'metro' })).toBe(false);
    expect(matchesStoreSpec(store, { chain: 'lidl', branchCode: '7' })).toBe(false);
  });
});
