import { describe, expect, it } from 'vitest';
import type { SpendingReceipt } from '@/analytics';
import { DEFAULT_PERIOD, parsePeriod, periodParam, viewPeriod } from './queries';

const now = new Date('2026-11-20T12:00:00Z');

function receipt(month: string, paidBani: number): SpendingReceipt {
  return {
    id: `${month}-${paidBani}`,
    storeId: 'store',
    storeName: 'Kaufland',
    chain: 'kaufland',
    month,
    date: `${month}-10`,
    purchasedAt: `${month}-10T10:00`,
    paidBani,
    totalBani: paidBani,
    voucherBani: 0,
    differenceBani: 0,
    parts: [],
  };
}

const receipts = [
  receipt('2025-12', 100),
  receipt('2026-06', 200),
  receipt('2026-09', 300),
  receipt('2026-11', 400),
  receipt('2026-12', 500), // in the future
  receipt('2027-02', 600), // in the future
];

describe('viewPeriod', () => {
  it.each([
    [3, '2026-09', '2026-11', 700],
    [6, '2026-06', '2026-11', 900],
    [12, '2025-12', '2026-11', 1000],
  ] as const)(
    'the last %i months end with the current one and leave the future out',
    (choice, from, to, total) => {
      const { spending, later } = viewPeriod({ now, receipts }, choice);

      expect(spending).toMatchObject({ from, to, totalBani: total });
      expect(later).toEqual({ count: 2, months: ['2026-12', '2027-02'] });
    },
  );

  it('counts everything, the future included, under "Tot", with nothing left over', () => {
    const { spending, later } = viewPeriod({ now, receipts }, 'all');

    expect(spending).toMatchObject({ from: '2025-12', to: '2027-02', totalBani: 2100 });
    expect(later).toEqual({ count: 0, months: [] });
  });

  it('follows the Bucharest calendar for "now"', () => {
    // 00:30 on 1 December in Bucharest: December is the current month and November is behind it.
    const midnight = new Date('2026-11-30T22:30:00Z');

    const { spending, later } = viewPeriod({ now: midnight, receipts }, 3);

    expect(spending).toMatchObject({ from: '2026-10', to: '2026-12', totalBani: 900 });
    expect(later).toEqual({ count: 1, months: ['2027-02'] });
  });
});

describe('the period of the address', () => {
  it('reads ?perioada= and falls back to the default', () => {
    expect(parsePeriod('3')).toBe(3);
    expect(parsePeriod('12')).toBe(12);
    expect(parsePeriod('tot')).toBe('all');
    expect(parsePeriod(null)).toBe(DEFAULT_PERIOD);
    expect(parsePeriod('banane')).toBe(DEFAULT_PERIOD);
    expect(parsePeriod('all')).toBe(DEFAULT_PERIOD);
  });

  it('writes it back', () => {
    expect([3, 6, 12, 'all'].map((choice) => periodParam(choice as 3))).toEqual([
      '3',
      '6',
      '12',
      'tot',
    ]);
  });
});
