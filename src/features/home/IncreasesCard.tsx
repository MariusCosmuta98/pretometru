import { Link } from 'react-router';
import { card } from '@/ui/controls';
import { formatCount } from '@/ui/insights/format';
import { PriceIncreaseList } from '@/ui/insights/PriceIncreaseList';
import type { HomeData } from './queries';

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/** The biggest price increases seen in the user's comparison window (the `priceWindowDays` setting). */
export function IncreasesCard({ data }: { data: HomeData }) {
  const { increases, increaseCount, windowDays } = data;
  return (
    <section aria-labelledby="home-increases" className={card}>
      <h2 id="home-increases" className="text-base font-semibold">
        Creșteri de preț
      </h2>
      <p className={`${muted} mb-1`}>
        Văzute în ultimele {formatCount(windowDays, 'zi', 'zile')}, față de achiziția anterioară din
        același magazin.
      </p>
      {increases.length === 0 ? (
        <p className={`${muted} py-2`}>
          Nicio creștere de preț în această perioadă. Apar după ce cumperi același produs de două
          ori din același magazin.
        </p>
      ) : (
        <PriceIncreaseList items={increases} label="Cele mai mari creșteri de preț" />
      )}
      {increaseCount > increases.length ? (
        <Link
          to="/statistici"
          className="mt-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-teal-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300 dark:hover:bg-slate-800"
        >
          Toate cele {increaseCount} creșteri
        </Link>
      ) : null}
    </section>
  );
}
