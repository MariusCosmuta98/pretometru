import type { PriceObservation } from '@/analytics';

/** Distinguishable on light and dark backgrounds; stores keep their colour by alphabetical order. */
export const SERIES_COLORS = [
  '#0f766e',
  '#2563eb',
  '#d97706',
  '#9333ea',
  '#dc2626',
  '#475569',
  '#0891b2',
  '#be185d',
] as const;

export interface ChartSeries {
  storeId: string;
  label: string;
  color: string;
  /** Price per base unit in lei, one entry per `times` entry; `null` where the store was not used that day. */
  values: Array<number | null>;
}

export interface ChartData {
  days: string[];
  /** Unix seconds of each day at 00:00 UTC (a calendar day, not an instant). */
  times: number[];
  series: ChartSeries[];
}

/**
 * Lines for the price chart: one per store, on a shared day axis. When a store was used twice on
 * one day the lower price is plotted. Values are floats in lei for drawing only; money elsewhere
 * stays integer.
 */
export function buildChartData(observations: readonly PriceObservation[]): ChartData {
  const perStore = new Map<string, { label: string; byDay: Map<string, number> }>();
  const allDays = new Set<string>();

  for (const observation of observations) {
    allDays.add(observation.date);
    const store = perStore.get(observation.storeId) ?? {
      label: observation.storeName,
      byDay: new Map<string, number>(),
    };
    const known = store.byDay.get(observation.date);
    if (known === undefined || observation.pricePerBaseMilliBani < known) {
      store.byDay.set(observation.date, observation.pricePerBaseMilliBani);
    }
    perStore.set(observation.storeId, store);
  }

  const days = [...allDays].sort();
  const series = [...perStore.entries()]
    .sort(([, a], [, b]) => a.label.localeCompare(b.label, 'ro'))
    .map(([storeId, store], index): ChartSeries => ({
      storeId,
      label: store.label,
      color: SERIES_COLORS[index % SERIES_COLORS.length] ?? SERIES_COLORS[0],
      values: days.map((day) => {
        const milli = store.byDay.get(day);
        return milli === undefined ? null : milli / 100_000;
      }),
    }));

  return { days, times: days.map((day) => Date.parse(`${day}T00:00:00Z`) / 1000), series };
}
