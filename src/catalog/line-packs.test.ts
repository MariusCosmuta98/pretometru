import { describe, expect, it } from 'vitest';
import { SEED_CATEGORIES } from '@/domain';
import { ensureSeed } from '@/storage';
import { createTestDb } from '@/storage/testing';
import { rememberMappings, setAliasDefaultPack } from './aliases';
import { createProduct } from './products';
import { saveTestReceipt } from './testing';

const HOUSEHOLD = SEED_CATEGORIES[9]!.id;
const at = (iso: string) => ({ now: () => new Date(iso) });

async function setup() {
  const db = await createTestDb();
  await ensureSeed(db);
  const paper = await createProduct(db, {
    name: 'Hârtie igienică',
    categoryId: HOUSEHOLD,
    baseUnit: 'role',
  });
  // Mega prints no size: 16,00 lei for one pack of toilet paper
  const mega = await saveTestReceipt(db, {
    chain: 'mega-image',
    lines: [{ rawName: 'HARTIE IGIENICA', lineTotalBani: 1600, productId: paper.id }],
  });
  return { db, paper, megaLine: mega.lines[0]! };
}

const priceOf = async (db: Awaited<ReturnType<typeof setup>>['db'], id: string) => {
  const line = await db.lines.get(id);
  return [line?.baseUnit, line?.pricePerBaseMilliBani, line?.packQty];
};

describe('alias default pack and the stored lines', () => {
  it('prices the lines already stored once the alias learns the size', async () => {
    const { db, paper, megaLine } = await setup();
    expect(await priceOf(db, megaLine.id)).toEqual(['buc', 1_600_000, undefined]);

    await rememberMappings(db, 'mega-image', [
      { rawName: 'HARTIE IGIENICA', productId: paper.id, pack: { qty: 8, unit: 'role' } },
    ]);

    // 16,00 lei / 8 rolls = 2,00 lei per roll
    expect(await priceOf(db, megaLine.id)).toEqual(['role', 200_000, 8]);
  });

  it('re-derives only the lines that used the default when it changes', async () => {
    const { db, paper, megaLine } = await setup();
    const own = await saveTestReceipt(db, {
      chain: 'mega-image',
      purchasedAt: '2026-11-10T10:00',
      lines: [
        {
          rawName: 'HARTIE IGIENICA',
          lineTotalBani: 1800,
          productId: paper.id,
          pack: { qty: 6, unit: 'role' },
        },
      ],
    });
    const kaufland = await saveTestReceipt(db, {
      chain: 'kaufland',
      lines: [{ rawName: 'HARTIE IGIENICA', lineTotalBani: 1600, productId: paper.id }],
    });
    const weighed = await saveTestReceipt(db, {
      chain: 'mega-image',
      lines: [
        {
          rawName: 'HARTIE IGIENICA',
          lineTotalBani: 1000,
          qty: 0.5,
          unit: 'kg',
          productId: paper.id,
        },
      ],
    });
    await rememberMappings(db, 'mega-image', [
      { rawName: 'HARTIE IGIENICA', productId: paper.id, pack: { qty: 8, unit: 'role' } },
    ]);
    const [alias] = await db.aliases.toArray();

    await setAliasDefaultPack(db, alias!.id, { qty: 4, unit: 'role' });

    expect(await priceOf(db, megaLine.id)).toEqual(['role', 400_000, 4]); // 16,00 / 4
    expect(await priceOf(db, own.lines[0]!.id)).toEqual(['role', 300_000, 6]); // printed size wins
    expect(await priceOf(db, kaufland.lines[0]!.id)).toEqual(['buc', 1_600_000, undefined]); // other chain
    expect((await db.lines.get(weighed.lines[0]!.id))?.baseUnit).toBe('kg'); // a size means nothing here
  });

  it('takes the size back off when the default is cleared', async () => {
    const { db, paper, megaLine } = await setup();
    await rememberMappings(db, 'mega-image', [
      { rawName: 'HARTIE IGIENICA', productId: paper.id, pack: { qty: 8, unit: 'role' } },
    ]);
    const [alias] = await db.aliases.toArray();

    const cleared = await setAliasDefaultPack(db, alias!.id, undefined);

    expect(cleared?.defaultPack).toBeUndefined();
    expect(await priceOf(db, megaLine.id)).toEqual(['buc', 1_600_000, undefined]);
  });

  it('writes nothing when the default is confirmed again', async () => {
    const { db, paper, megaLine } = await setup();
    const choice = {
      rawName: 'HARTIE IGIENICA',
      productId: paper.id,
      pack: { qty: 8, unit: 'role' as const },
    };
    await rememberMappings(db, 'mega-image', [choice], at('2026-11-20T10:00:00.000Z'));
    const before = await db.lines.get(megaLine.id);

    await rememberMappings(db, 'mega-image', [choice], at('2026-11-20T11:00:00.000Z'));
    await setAliasDefaultPack(db, (await db.aliases.toArray())[0]!.id, { qty: 8, unit: 'role' });

    expect(await db.lines.get(megaLine.id)).toEqual(before);
  });

  it('answers undefined for an alias that does not exist', async () => {
    const { db } = await setup();
    expect(await setAliasDefaultPack(db, '0000000000000000000000000X', undefined)).toBeUndefined();
  });
});
