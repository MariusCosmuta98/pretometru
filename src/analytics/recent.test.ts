import { describe, expect, it } from 'vitest';
import { createIdGenerator } from '@/domain';
import { makeReceipt, makeStore } from '@/domain/testing';
import { UNKNOWN_STORE_NAME } from './spending';
import { recentReceipts } from './recent';

const kaufland = makeStore({ chain: 'kaufland', name: 'Kaufland Cluj' });
// An id made on 18.11.2026: a draft without a date is ordered by the day it was created.
const idOn18th = createIdGenerator({ now: () => Date.parse('2026-11-18T10:00:00Z') });

describe('recentReceipts', () => {
  const day17 = makeReceipt({ storeId: kaufland.id, purchasedAt: '2026-11-17T10:00' });
  const day19 = makeReceipt({
    storeId: kaufland.id,
    purchasedAt: '2026-11-19T18:30',
    totalBani: 2000,
    paidBani: 1800,
  });
  const undated = makeReceipt({
    id: idOn18th(),
    storeId: kaufland.id,
    status: 'draft',
    purchasedAt: undefined,
  });

  it('puts the newest first, a draft without a date where it was created, as the receipts list does', () => {
    const { items } = recentReceipts([day17, undated, day19], [kaufland], 10);

    expect(items.map((r) => r.id)).toEqual([day19.id, undated.id, day17.id]);
    expect(items[0]).toMatchObject({
      storeName: 'Kaufland Cluj',
      purchasedAt: '2026-11-19T18:30',
      status: 'confirmed',
      totalBani: 2000,
      paidBani: 1800,
    });
    expect(items[1]).toMatchObject({ status: 'draft', paidBani: 3666 });
    expect(items[1]).not.toHaveProperty('purchasedAt');
  });

  it('shows a receipt dated in the future first', () => {
    const future = makeReceipt({ storeId: kaufland.id, purchasedAt: '2026-12-29T17:12:30' });

    expect(recentReceipts([day19, future], [kaufland], 5).items[0]?.id).toBe(future.id);
  });

  it('counts every live receipt and the drafts among them, whatever the limit', () => {
    const deleted = makeReceipt({ deletedAt: '2026-11-20T10:00:00.000Z' });

    const result = recentReceipts([day17, day19, undated, deleted], [kaufland], 1);

    expect(result.items.map((r) => r.id)).toEqual([day19.id]);
    expect(result).toMatchObject({ count: 3, drafts: 1 });
  });

  it('names a store that is gone', () => {
    const lost = makeReceipt({ purchasedAt: '2026-11-20T10:00' });

    expect(recentReceipts([lost], [], 5).items[0]?.storeName).toBe(UNKNOWN_STORE_NAME);
  });

  it('is empty without receipts', () => {
    expect(recentReceipts([], [], 5)).toEqual({ items: [], count: 0, drafts: 0 });
  });
});
