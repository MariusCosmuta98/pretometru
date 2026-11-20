import { Link } from 'react-router';
import { buttonQuiet, card } from '@/ui/controls';
import { lastDays } from '@/ui/insights/format';
import { PriceIncreaseList } from '@/ui/insights/PriceIncreaseList';
import { plural } from '@/ui/plural';
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
        Văzute în {lastDays(windowDays)}, față de achiziția anterioară din același magazin.
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
        <Link to="/statistici" className={`${buttonQuiet} mt-2`}>
          Toate cele {plural(increaseCount, 'creștere', 'creșteri')}
        </Link>
      ) : null}
    </section>
  );
}
