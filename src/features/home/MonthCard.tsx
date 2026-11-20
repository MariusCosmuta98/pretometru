import { formatLei } from '@/domain';
import { card } from '@/ui/controls';
import { formatCount, formatMonth, formatPercent, formatSignedLei } from '@/ui/insights/format';
import type { HomeData } from './queries';

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/** This month against the previous one: the change in money and percent, or why there is none. */
function Versus({ data }: { data: HomeData }) {
  const { comparison, previous, previousMonth } = data;
  const before = formatMonth(previousMonth);

  if (previous.receiptCount === 0) {
    return (
      <p className={`${muted} mt-2`}>Niciun bon confirmat în {before}: nu avem cu ce compara.</p>
    );
  }
  if (comparison.deltaBani === 0) {
    return (
      <p className={`${muted} mt-2`}>
        La fel ca în {before} ({formatLei(previous.totalBani)}).
      </p>
    );
  }

  const tone =
    comparison.deltaBani > 0
      ? 'text-red-700 dark:text-red-400'
      : 'text-green-700 dark:text-green-400';
  return (
    <p className="mt-2 text-sm">
      <span className={`font-medium tabular-nums ${tone}`}>
        <span aria-hidden="true">{comparison.deltaBani > 0 ? '↑' : '↓'}</span>{' '}
        {formatSignedLei(comparison.deltaBani)}
        {comparison.pct === undefined ? '' : ` (${formatPercent(comparison.pct)})`}
      </span>{' '}
      <span className={muted}>
        față de {before} ({formatLei(previous.totalBani)})
      </span>
    </p>
  );
}

/** What was paid this month, and how that compares with the previous month. */
export function MonthCard({ data }: { data: HomeData }) {
  const { current, month } = data;
  return (
    <section aria-labelledby="home-month" className={card}>
      <h2 id="home-month" className="text-sm font-medium text-slate-600 dark:text-slate-400">
        Luna aceasta <span className="font-normal">· {formatMonth(month)}</span>
      </h2>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{formatLei(current.totalBani)}</p>
      <p className={muted}>
        {current.receiptCount === 0
          ? 'Niciun bon confirmat luna aceasta'
          : formatCount(current.receiptCount, 'bon confirmat', 'bonuri confirmate')}
      </p>
      <Versus data={data} />
    </section>
  );
}
