import { describe, expect, it } from 'vitest';
import { cheapestPerStore, windowStart } from './cheapest';
import { observation, paid } from './testing';

// Fixed "today": 2026-11-20 (UTC midday, so the Bucharest calendar day is the same).
const now = new Date('2026-11-20T12:00:00Z');
const roll = { baseUnit: 'role' as const, now };

describe('windowStart', () => {
  it('counts back from the calendar day, a purchase exactly N days ago still included', () => {
    expect(windowStart(now, 90)).toBe('2026-08-22');
    expect(windowStart(now, 1)).toBe('2026-11-19');
  });

  it('uses the Bucharest day: just after midnight there it is already tomorrow in UTC terms', () => {
    // 22:30 UTC on the 19th is 00:30 on the 20th in Bucharest (UTC+2 in November)
    expect(windowStart(new Date('2026-11-19T22:30:00Z'), 1)).toBe('2026-11-19');
  });
});

describe('cheapestPerStore', () => {
  it('picks the lowest price per store with its date, cheapest store first', () => {
    const result = cheapestPerStore(
      [
        paid('kaufland', '2026-10-01', 160_000),
        paid('kaufland', '2026-11-07', 145_000),
        paid('kaufland', '2026-11-14', 170_000),
        paid('metro', '2026-11-01', 130_000),
        paid('mega-image', '2026-11-03', 200_000),
      ],
      roll,
    );

    expect(result.map((s) => [s.storeName, s.best.pricePerBaseMilliBani, s.best.date])).toEqual([
      ['METRO', 130_000, '2026-11-01'],
      ['Kaufland', 145_000, '2026-11-07'],
      ['Mega Image', 200_000, '2026-11-03'],
    ]);
    const kaufland = result[1]!;
    expect(kaufland.count).toBe(3);
    expect(kaufland.latest.date).toBe('2026-11-14');
  });

  it('only looks at the last N days: the day N days ago counts, the day before does not', () => {
    const observations = [
      paid('metro', '2026-08-22', 100_000), // exactly 90 days ago
      paid('kaufland', '2026-08-21', 90_000), // 91 days ago
      paid('mega-image', '2026-11-03', 200_000),
    ];
    const names = (days: number) =>
      cheapestPerStore(observations, { ...roll, days }).map((s) => s.storeName);

    expect(names(90)).toEqual(['METRO', 'Mega Image']);
    expect(names(91)).toEqual(['Kaufland', 'METRO', 'Mega Image']);
  });

  it('defaults to 90 days', () => {
    const old = paid('metro', '2026-08-21', 100_000);
    expect(cheapestPerStore([old], roll)).toEqual([]);
    expect(cheapestPerStore([paid('metro', '2026-08-22', 100_000)], roll)).toHaveLength(1);
  });

  it('counts a purchase dated in the future as recent', () => {
    expect(cheapestPerStore([paid('metro', '2026-12-29', 100_000)], roll)).toHaveLength(1);
  });

  it('marks sale prices and can leave them out', () => {
    const regular = paid('metro', '2026-11-01', 150_000);
    const sale = paid('metro', '2026-11-10', 130_000, { onSale: true, discountBani: 200 });
    const saleOnly = paid('kaufland', '2026-11-05', 120_000, { onSale: true, discountBani: 100 });

    const withSales = cheapestPerStore([regular, sale, saleOnly], roll);
    expect(withSales.map((s) => s.storeName)).toEqual(['Kaufland', 'METRO']);
    expect(withSales[1]!.best.onSale).toBe(true);

    const withoutSales = cheapestPerStore([regular, sale, saleOnly], {
      ...roll,
      excludeSales: true,
    });
    expect(withoutSales.map((s) => [s.storeName, s.best.pricePerBaseMilliBani])).toEqual([
      ['METRO', 150_000], // Kaufland only ever had a sale price: nothing to compare
    ]);
    expect(withoutSales[0]!.count).toBe(1);
  });

  it('shows the most recent purchase when two cost the same', () => {
    const [store] = cheapestPerStore(
      [paid('metro', '2026-10-01', 130_000), paid('metro', '2026-11-01', 130_000)],
      roll,
    );
    expect(store?.best.date).toBe('2026-11-01');
  });

  it('breaks a tie between stores alphabetically', () => {
    const result = cheapestPerStore(
      [paid('metro', '2026-11-01', 130_000), paid('kaufland', '2026-11-01', 130_000)],
      roll,
    );
    expect(result.map((s) => s.storeName)).toEqual(['Kaufland', 'METRO']);
  });

  it('never compares different base units', () => {
    const perPiece = observation({ baseUnit: 'buc', pricePerBaseMilliBani: 1, date: '2026-11-07' });
    expect(cheapestPerStore([perPiece], roll)).toEqual([]);
    expect(cheapestPerStore([perPiece], { ...roll, baseUnit: 'buc' })).toHaveLength(1);
  });

  it('is empty without observations', () => {
    expect(cheapestPerStore([], roll)).toEqual([]);
  });
});
