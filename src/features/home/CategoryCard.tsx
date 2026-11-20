import { useState } from 'react';
import { Link } from 'react-router';
import { buttonQuiet, card } from '@/ui/controls';
import { Adjustments } from '@/ui/insights/Adjustments';
import { BarList, type BarItem } from '@/ui/insights/BarList';
import { formatAmount, formatMonth } from '@/ui/insights/format';
import type { HomeData } from './queries';

/** Categories shown before "Arată toate"; the "Non-produs" and "Fără categorie" buckets always show. */
const TOP_CATEGORIES = 5;

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/** Spending this month by category, each against what the same category was the month before. */
export function CategoryCard({ data }: { data: HomeData }) {
  const { comparison, current, month, previous, previousMonth } = data;
  const [showAll, setShowAll] = useState(false);

  const rows = comparison.categories.filter((row) => row.amountBani !== 0);
  const regular = rows.filter((row) => row.kind === 'category');
  const top = new Set(regular.slice(0, TOP_CATEGORIES));
  const visible = showAll ? rows : rows.filter((row) => row.kind !== 'category' || top.has(row));

  const before = formatMonth(previousMonth);
  const items: BarItem[] = visible.map((row) => ({
    key: row.categoryId ?? row.kind,
    label: (
      <>
        <span aria-hidden="true">{row.icon}</span> {row.name}
      </>
    ),
    value: row.amountBani,
    valueText: formatAmount(row.amountBani),
    color: row.color,
    ...(previous.receiptCount === 0
      ? {}
      : {
          compare: row.previousBani,
          detail:
            row.previousBani === 0
              ? `Nimic în ${before}`
              : `${before}: ${formatAmount(row.previousBani)}`,
        }),
  }));

  return (
    <section aria-labelledby="home-categories" className={card}>
      <h2 id="home-categories" className="mb-3 text-base font-semibold">
        Pe categorii
      </h2>
      {rows.length === 0 ? (
        <p className={muted}>Niciun bon confirmat în {formatMonth(month)}.</p>
      ) : (
        <>
          <BarList items={items} label={`Cheltuieli pe categorii în ${formatMonth(month)}`} />
          {regular.length > TOP_CATEGORIES ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => setShowAll((open) => !open)}
              className={`${buttonQuiet} mt-2`}
            >
              {showAll ? 'Arată mai puține' : `Arată toate categoriile (${regular.length})`}
            </button>
          ) : null}
          <Adjustments adjustments={current.adjustments} totalBani={current.totalBani} />
        </>
      )}
      <Link to="/statistici" className={`${buttonQuiet} mt-2`}>
        Pe luni, categorii și magazine
      </Link>
    </section>
  );
}
