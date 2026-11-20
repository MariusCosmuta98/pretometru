import type { ReactNode } from 'react';

export interface BarItem {
  key: string;
  /** What the bar stands for: a name, with its icon. */
  label: ReactNode;
  /** The amount in bani the bar is drawn for; zero or less draws no bar. */
  value: number;
  /** The amount as text, e.g. `254,65 lei`: the bar is decoration, the numbers are the content. */
  valueText: string;
  /** CSS colour of the bar (`#rrggbb`). */
  color?: string;
  /** A second, thinner bar under the first: what the same thing was in the period before. */
  compare?: number;
  /** A line under the bar: the share, the earlier amount. */
  detail?: ReactNode;
}

/** The width of a bar in percent: a small amount still gets a sliver, nothing gets none. */
function widthOf(value: number, scale: number): number {
  if (!(scale > 0) || !(value > 0)) return 0;
  return Math.max(2, Math.min(100, Math.round((value * 100) / scale)));
}

/**
 * Horizontal bars in plain HTML and CSS (no chart library, nothing to load, works offline): one row
 * per item with its amount as text, so the numbers are readable without the bar.
 * `scale` is the amount a full bar stands for; by default the biggest one in the list.
 */
export function BarList({
  items,
  label,
  scale,
}: {
  items: readonly BarItem[];
  /** The accessible name of the list. */
  label: string;
  scale?: number;
}) {
  const full = scale ?? Math.max(0, ...items.flatMap((item) => [item.value, item.compare ?? 0]));
  return (
    <ul aria-label={label} className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 font-medium">{item.label}</span>
            <span className="shrink-0 font-semibold tabular-nums">{item.valueText}</span>
          </div>
          <div
            aria-hidden="true"
            className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div
              className="h-full rounded-full bg-teal-600"
              style={{
                width: `${widthOf(item.value, full)}%`,
                ...(item.color === undefined ? {} : { backgroundColor: item.color }),
              }}
            />
          </div>
          {item.compare === undefined ? null : (
            <div
              aria-hidden="true"
              className="mt-1 h-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
            >
              <div
                className="h-full rounded-full bg-slate-400 dark:bg-slate-500"
                style={{ width: `${widthOf(item.compare, full)}%` }}
              />
            </div>
          )}
          {item.detail ? (
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{item.detail}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
