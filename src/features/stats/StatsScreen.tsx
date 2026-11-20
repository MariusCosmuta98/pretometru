import { useCallback } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, card, noticeClass } from '@/ui/controls';
import { formatCount, formatMonth } from '@/ui/insights/format';
import { Failure, Loading } from '@/ui/insights/notices';
import { useDb, useDbQuery } from '@/ui/insights/useLive';
import { IncreasesCard } from './IncreasesCard';
import { PeriodPicker } from './PeriodPicker';
import {
  DEFAULT_PERIOD,
  loadStats,
  parsePeriod,
  periodParam,
  type PeriodChoice,
  type StatsData,
} from './queries';
import { CategoriesCard, MonthsCard, StoresCard, SummaryCard } from './SpendingCards';

function FutureNote({ later }: { later: StatsData['later'] }) {
  const months = later.months.map(formatMonth).join(', ');
  const single = later.count === 1;
  const who = single ? 'Un bon are' : `${formatCount(later.count, 'bon', 'bonuri')} au`;
  const find = single ? 'Îl găsești' : 'Le găsești';
  return (
    <p className={noticeClass.info}>
      {`${who} data în viitor (${months}) și nu intră în această perioadă. ${find} la „Tot”.`}
    </p>
  );
}

function Empty() {
  return (
    <section className={`${card} space-y-3 text-center`}>
      <p className="font-medium">Nu ai încă bonuri confirmate.</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Statisticile apar după ce adaugi și confirmi primul bon.
      </p>
      <Link to="/adauga" className={buttonPrimary}>
        Adaugă un bon
      </Link>
    </section>
  );
}

/** Statistici: spending by month, category and store over a chosen period, and the price increases. */
export function Component() {
  const [params, setParams] = useSearchParams();
  const choice = parsePeriod(params.get('perioada'));
  const query = useCallback((db: PretometruDB) => loadStats(db, choice), [choice]);
  const database = useDb();
  const stats = useDbQuery(query);

  if (stats.status === 'error') {
    return <Failure>Nu am putut deschide datele de pe acest dispozitiv.</Failure>;
  }
  if (stats.status === 'loading') return <Loading what="statisticile" />;

  const data = stats.value;
  if (data.receiptCount === 0) return <Empty />;

  const choose = (next: PeriodChoice) => {
    setParams(next === DEFAULT_PERIOD ? {} : { perioada: periodParam(next) }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PeriodPicker value={choice} onChange={choose} />
      {data.later.count > 0 ? <FutureNote later={data.later} /> : null}
      {data.spending.receiptCount === 0 ? (
        <p className={noticeClass.info}>Niciun bon confirmat în perioada aleasă.</p>
      ) : (
        <>
          <SummaryCard spending={data.spending} />
          <MonthsCard spending={data.spending} />
          <CategoriesCard spending={data.spending} />
          <StoresCard spending={data.spending} />
        </>
      )}
      <IncreasesCard data={data} db={database.status === 'ready' ? database.value : undefined} />
    </div>
  );
}
