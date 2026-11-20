import type { PeriodSpending } from '@/analytics';
import { formatLei, roundDiv } from '@/domain';
import { card } from '@/ui/controls';
import { Adjustments } from '@/ui/insights/Adjustments';
import { BarList, type BarItem } from '@/ui/insights/BarList';
import { formatCount, formatMonth } from '@/ui/insights/format';

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/** `noiembrie 2026`, or `iunie 2026 – noiembrie 2026` for a longer period. */
function periodLabel({ from, to }: PeriodSpending): string {
  if (from === undefined || to === undefined) return '';
  return from === to ? formatMonth(from) : `${formatMonth(from)} – ${formatMonth(to)}`;
}

/** A whole-percent share of `part` in `whole`, as the text of a detail line; nothing for a part that is not a share. */
function share(part: number, whole: number): string | undefined {
  return part > 0 && whole > 0 ? `${roundDiv(part * 100, whole)}%` : undefined;
}

/** What was paid in the period, and in how many receipts. */
export function SummaryCard({ spending }: { spending: PeriodSpending }) {
  return (
    <section aria-labelledby="stats-total" className={card}>
      <h2 id="stats-total" className="text-sm font-medium text-slate-600 dark:text-slate-400">
        Perioada <span className="font-normal">· {periodLabel(spending)}</span>
      </h2>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{formatLei(spending.totalBani)}</p>
      <p className={muted}>
        {formatCount(spending.receiptCount, 'bon confirmat', 'bonuri confirmate')}
      </p>
    </section>
  );
}

/** Spending by month, the newest first; a period with both ends lists the empty months too. */
export function MonthsCard({ spending }: { spending: PeriodSpending }) {
  const items: BarItem[] = spending.months.toReversed().map((entry) => ({
    key: entry.month,
    label: formatMonth(entry.month),
    value: entry.totalBani,
    valueText: formatLei(entry.totalBani),
    detail:
      entry.receiptCount === 0 ? 'Niciun bon' : formatCount(entry.receiptCount, 'bon', 'bonuri'),
  }));
  return (
    <section aria-labelledby="stats-months" className={card}>
      <h2 id="stats-months" className="mb-3 text-base font-semibold">
        Pe luni
      </h2>
      <BarList items={items} label="Cheltuieli pe luni" />
    </section>
  );
}

/** Spending by category with its share, the "Non-produs" and "Fără categorie" buckets among them, then what makes it add up. */
export function CategoriesCard({ spending }: { spending: PeriodSpending }) {
  const rows = spending.categories.filter((category) => category.amountBani !== 0);
  const goods = rows.reduce((sum, category) => sum + category.amountBani, 0);
  const items: BarItem[] = rows.map((category) => {
    const percent = share(category.amountBani, goods);
    return {
      key: category.categoryId ?? category.kind,
      label: (
        <>
          <span aria-hidden="true">{category.icon}</span> {category.name}
        </>
      ),
      value: category.amountBani,
      valueText: formatLei(category.amountBani),
      color: category.color,
      ...(percent === undefined ? {} : { detail: `${percent} din cheltuieli` }),
    };
  });
  return (
    <section aria-labelledby="stats-categories" className={card}>
      <h2 id="stats-categories" className="mb-3 text-base font-semibold">
        Pe categorii
      </h2>
      <BarList items={items} label="Cheltuieli pe categorii" />
      <Adjustments adjustments={spending.adjustments} totalBani={spending.totalBani} />
    </section>
  );
}

/** Spending by store, the biggest first. */
export function StoresCard({ spending }: { spending: PeriodSpending }) {
  const items: BarItem[] = spending.stores.map((store) => {
    const percent = share(store.totalBani, spending.totalBani);
    return {
      key: store.storeId,
      label: store.name,
      value: store.totalBani,
      valueText: formatLei(store.totalBani),
      detail: [formatCount(store.receiptCount, 'bon', 'bonuri'), percent && `${percent} din total`]
        .filter(Boolean)
        .join(' · '),
    };
  });
  return (
    <section aria-labelledby="stats-stores" className={card}>
      <h2 id="stats-stores" className="mb-3 text-base font-semibold">
        Pe magazine
      </h2>
      <BarList items={items} label="Cheltuieli pe magazine" />
    </section>
  );
}
