import { describe, expect, it } from 'vitest';
import { paid } from '@/analytics/testing';
import { buildChartData, SERIES_COLORS } from './chart-data';

describe('buildChartData', () => {
  it('puts every store on a shared day axis, with gaps where it was not used', () => {
    const data = buildChartData([
      paid('metro', '2026-08-12', 130_250),
      paid('kaufland', '2026-10-01', 160_000),
      paid('kaufland', '2026-11-07', 144_875),
    ]);

    expect(data.days).toEqual(['2026-08-12', '2026-10-01', '2026-11-07']);
    expect(data.series.map((s) => [s.label, s.values])).toEqual([
      ['Kaufland', [null, 1.6, 1.44875]],
      ['METRO', [1.3025, null, null]],
    ]);
  });

  it('measures days at 00:00 UTC, so a calendar day never shifts with the time zone', () => {
    const { times } = buildChartData([paid('metro', '2026-08-12', 130_250)]);
    expect(new Date(times[0]! * 1000).toISOString()).toBe('2026-08-12T00:00:00.000Z');
  });

  it('plots the lower price when a store was used twice in a day', () => {
    const { series } = buildChartData([
      paid('metro', '2026-08-12', 150_000),
      paid('metro', '2026-08-12', 130_000),
    ]);
    expect(series[0]?.values).toEqual([1.3]);
  });

  it('colours stores in alphabetical order and cycles when there are many', () => {
    const stores = ['kaufland', 'metro', 'mega-image'] as const;
    const data = buildChartData(stores.map((store) => paid(store, '2026-11-01', 100_000)));
    expect(data.series.map((s) => s.label)).toEqual(['Kaufland', 'Mega Image', 'METRO']);
    expect(data.series.map((s) => s.color)).toEqual(SERIES_COLORS.slice(0, 3));
  });

  it('is empty without observations', () => {
    expect(buildChartData([])).toEqual({ days: [], times: [], series: [] });
  });
});
