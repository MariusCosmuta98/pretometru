import { Link } from 'react-router';
import type { PretometruDB } from '@/storage';
import { noticeClass } from '@/ui/controls';
import { formatFutureReceipts } from '@/ui/insights/format';
import { useToday } from '@/ui/insights/useToday';
import { useDbQuery } from '@/ui/live';
import { plural } from '@/ui/plural';
import { Failure, Loading } from '@/ui/states';
import { CategoryCard } from './CategoryCard';
import { FirstRun } from './FirstRun';
import { IncreasesCard } from './IncreasesCard';
import { MonthCard } from './MonthCard';
import { loadHome, type HomeData } from './queries';
import { RecentCard } from './RecentCard';

// A module-level function: the live query must keep its identity between renders.
const loadNow = (db: PretometruDB) => loadHome(db);

function Drafts({ count }: { count: number }) {
  return (
    <p className={noticeClass.warning}>
      {count === 1
        ? 'Ai o ciornă de verificat.'
        : `Ai ${plural(count, 'ciornă', 'ciorne')} de verificat.`}{' '}
      Ciornele nu intră în cheltuieli până nu sunt confirmate.{' '}
      <Link to="/bonuri" className="font-medium underline">
        Vezi bonurile
      </Link>
    </p>
  );
}

function Dashboard({ data }: { data: HomeData }) {
  return (
    <div className="space-y-4">
      {data.recent.drafts > 0 ? <Drafts count={data.recent.drafts} /> : null}
      <MonthCard data={data} />
      {data.later.count > 0 ? (
        <p className={noticeClass.info}>
          {`${formatFutureReceipts(data.later.count, data.later.months)} și nu intră în luna aceasta.`}
        </p>
      ) : null}
      <CategoryCard data={data} />
      <RecentCard recent={data.recent} />
      <IncreasesCard data={data} />
    </div>
  );
}

/** The dashboard of the day: a new day (the app came back after midnight) starts it over with a fresh clock. */
function Home() {
  const home = useDbQuery(loadNow);

  if (home.status === 'error') {
    return <Failure>Nu am putut deschide datele de pe acest dispozitiv.</Failure>;
  }
  if (home.status === 'loading') return <Loading what="datele" />;
  if (home.value.recent.count === 0) return <FirstRun />;
  return <Dashboard data={home.value} />;
}

/** Acasă: spending this month and per category, the last receipts and the biggest price increases. */
export function Component() {
  const day = useToday();
  return <Home key={day} />;
}
