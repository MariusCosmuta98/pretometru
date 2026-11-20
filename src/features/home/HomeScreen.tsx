import { Link } from 'react-router';
import type { PretometruDB } from '@/storage';
import { noticeClass } from '@/ui/controls';
import { formatCount } from '@/ui/insights/format';
import { Failure, Loading } from '@/ui/insights/notices';
import { useDbQuery } from '@/ui/insights/useLive';
import { useToday } from '@/ui/insights/useToday';
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
        : `Ai ${formatCount(count, 'ciornă', 'ciorne')} de verificat.`}{' '}
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
