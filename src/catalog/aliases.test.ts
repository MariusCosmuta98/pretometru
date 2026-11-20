import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { ensureSeed } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { rememberMappings } from './aliases';
import { createProduct } from './products';

const at = (iso: string) => ({ now: () => new Date(iso) });
const T1 = '2026-11-20T10:00:00.000Z';
const T2 = '2026-11-20T11:00:00.000Z';

async function setup() {
  const db = await createTestDb();
  await ensureSeed(db);
  const category = SEED_CATEGORIES[0]!.id;
  const milk = await createProduct(db, { name: 'Lapte', categoryId: category, baseUnit: 'l' });
  const cream = await createProduct(db, { name: 'Smântână', categoryId: category, baseUnit: 'kg' });
  return { db, milk, cream };
}

describe('rememberMappings', () => {
  it('creates an alias per chain and normalised name with the EAN and pack size', async () => {
    const { db, milk } = await setup();
    await rememberMappings(
      db,
      'metro',
      [
        {
          rawName: ' LAPTE UHT 1,5% 1L ',
          ean: '5941234567890',
          productId: milk.id,
          pack: { qty: 1, unit: 'l' },
        },
      ],
      at(T1),
    );

    const aliases = await db.aliases.toArray();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      chain: 'metro',
      normName: 'lapte uht 1.5 1l',
      rawName: 'LAPTE UHT 1,5% 1L',
      ean: '5941234567890',
      productId: milk.id,
      defaultPack: { qty: 1, unit: 'l' },
      updatedAt: T1,
    });
  });

  it('writes nothing when a known receipt is confirmed again', async () => {
    const { db, milk } = await setup();
    const choice = { rawName: 'LAPTE', ean: '5941234567890', productId: milk.id };
    await rememberMappings(db, 'kaufland', [choice], at(T1));
    await rememberMappings(db, 'kaufland', [{ ...choice, rawName: 'Lapte' }], at(T2));

    const [alias] = await db.aliases.toArray();
    expect(await db.aliases.count()).toBe(1);
    expect(alias?.updatedAt).toBe(T1);
  });

  it('re-points a known name at the product the user chose now, keeping what it learned', async () => {
    const { db, milk, cream } = await setup();
    await rememberMappings(
      db,
      'kaufland',
      [{ rawName: 'LAPTE', productId: milk.id, pack: { qty: 1, unit: 'l' } }],
      at(T1),
    );
    await rememberMappings(
      db,
      'kaufland',
      [{ rawName: 'LAPTE', ean: '5941234567890', productId: cream.id }],
      at(T2),
    );

    const aliases = await db.aliases.toArray();
    expect(aliases).toHaveLength(1);
    expect(aliases[0]).toMatchObject({
      productId: cream.id,
      ean: '5941234567890',
      defaultPack: { qty: 1, unit: 'l' },
      updatedAt: T2,
    });
  });

  it('keeps the same printed name in two chains apart', async () => {
    const { db, milk, cream } = await setup();
    await rememberMappings(db, 'kaufland', [{ rawName: 'LAPTE', productId: milk.id }]);
    await rememberMappings(db, 'lidl', [{ rawName: 'LAPTE', productId: cream.id }]);
    expect((await db.aliases.toArray()).map((a) => [a.chain, a.productId]).sort()).toEqual(
      [
        ['kaufland', milk.id],
        ['lidl', cream.id],
      ].sort(),
    );
  });

  it('skips names that normalise to nothing', async () => {
    const { db, milk } = await setup();
    await rememberMappings(db, 'kaufland', [{ rawName: '***', productId: milk.id }]);
    expect(await db.aliases.count()).toBe(0);
  });

  it('is all or nothing: an unknown product undoes the earlier choices', async () => {
    const { db, milk } = await setup();
    await expect(
      rememberMappings(db, 'kaufland', [
        { rawName: 'LAPTE', productId: milk.id },
        { rawName: 'FANTOMA', productId: '0000000000000000000000000X' },
      ]),
    ).rejects.toThrow(RangeError);
    expect(await db.aliases.count()).toBe(0);
  });
});
