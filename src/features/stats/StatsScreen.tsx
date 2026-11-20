import { Link, useSearchParams } from 'react-router';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, card, noticeClass } from '@/ui/controls';
import { formatFutureReceipts } from '@/ui/insights/format';
import { useToday } from '@/ui/insights/useToday';
import { useDbQuery } from '@/ui/live';
import { Failure, Loading } from '@/ui/states';
import { IncreasesCard } from './IncreasesCard';
import { PeriodPicker } from './PeriodPicker';
import {
  DEFAULT_PERIOD,
  loadStats,
  parsePeriod,
  periodParam,
  viewPeriod,
  type PeriodChoice,
} from './queries';
import { CategoriesCard, MonthsCard, StoresCard, SummaryCard } from './SpendingCards';

// A module-level function: the live query must keep its identity between renders, and it does not
// depend on the chosen period (that is a view of what it returns), so a switch never reloads.
const loadNow = (db: PretometruDB) => loadStats(db);

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

/** Statistici of the day: a new day (the app came back after midnight) starts it over with a fresh clock. */
function Stats() {
  const [params, setParams] = useSearchParams();
  const choice = parsePeriod(params.get('perioada'));
  const stats = useDbQuery(loadNow);

  if (stats.status === 'error') {
    return <Failure>Nu am putut deschide datele de pe acest dispozitiv.</Failure>;
  }
  if (stats.status === 'loading') return <Loading what="statisticile" />;

  const data = stats.value;
  if (data.receipts.length === 0) return <Empty />;

  const { spending, later } = viewPeriod(data, choice);
  const choose = (next: PeriodChoice) => {
    setParams(next === DEFAULT_PERIOD ? {} : { perioada: periodParam(next) }, { replace: true });
  };

  return (
    <div className="space-y-4">
      <PeriodPicker value={choice} onChange={choose} />
      {later.count > 0 ? (
        <p className={noticeClass.info}>
          {`${formatFutureReceipts(later.count, later.months)} și nu intră în această perioadă. ${
            later.count === 1 ? 'Îl găsești' : 'Le găsești'
          } la „Tot”.`}
        </p>
      ) : null}
      {spending.receiptCount === 0 ? (
        <p className={noticeClass.info}>Niciun bon confirmat în perioada aleasă.</p>
      ) : (
        <>
          <SummaryCard spending={spending} />
          <MonthsCard spending={spending} />
          <CategoriesCard spending={spending} />
          <StoresCard spending={spending} />
        </>
      )}
      <IncreasesCard data={data} />
    </div>
  );
}

/** Statistici: spending by month, category and store over a chosen period, and the price increases. */
export function Component() {
  const day = useToday();
  return <Stats key={day} />;
}
