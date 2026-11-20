import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { useEffect, useRef } from 'react';
import type { ChartData } from './chart-data';

const HEIGHT = 240;
// Mid-tone greys read on both the light and the dark theme.
const AXIS = '#64748b';
const GRID = 'rgba(148, 163, 184, 0.25)';

const dayFormat = new Intl.DateTimeFormat('ro-RO', {
  day: '2-digit',
  month: '2-digit',
  timeZone: 'UTC',
});
const priceFormat = new Intl.NumberFormat('ro-RO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 3,
});

function options(data: ChartData, width: number): uPlot.Options {
  return {
    width,
    height: HEIGHT,
    legend: { show: false },
    cursor: { drag: { x: false, y: false } },
    // Days are calendar days stored at 00:00 UTC, so ticks and labels must use UTC too.
    tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
    scales: { x: { time: true } },
    axes: [
      {
        stroke: AXIS,
        grid: { stroke: GRID, width: 1 },
        ticks: { stroke: GRID, width: 1 },
        values: (_plot, splits) => splits.map((ts) => dayFormat.format(new Date(ts * 1000))),
      },
      {
        stroke: AXIS,
        grid: { stroke: GRID, width: 1 },
        ticks: { stroke: GRID, width: 1 },
        size: 60,
        values: (_plot, splits) => splits.map((value) => priceFormat.format(value)),
      },
    ],
    series: [
      {},
      ...data.series.map((series): uPlot.Series => ({
        label: series.label,
        stroke: series.color,
        width: 2,
        spanGaps: true,
        points: { show: true, size: 7, fill: series.color, stroke: series.color },
      })),
    ],
  };
}

/** The price per base unit over time, one line per store. Loaded on demand (uPlot, canvas). */
export default function PriceChart({ data }: { data: ChartData }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return undefined;

    const plot = new uPlot(
      options(data, element.clientWidth || 320),
      [data.times, ...data.series.map((series) => series.values)],
      element,
    );
    const resize = new ResizeObserver(() => {
      plot.setSize({ width: element.clientWidth || 320, height: HEIGHT });
    });
    resize.observe(element);

    return () => {
      resize.disconnect();
      plot.destroy();
    };
  }, [data]);

  return <div ref={container} className="w-full" />;
}
