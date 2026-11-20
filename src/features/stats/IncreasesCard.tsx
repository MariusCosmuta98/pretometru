import { useState } from 'react';
import type { PretometruDB } from '@/storage';
import { card } from '@/ui/controls';
import { formatCount } from '@/ui/insights/format';
import { PriceIncreaseList } from '@/ui/insights/PriceIncreaseList';
import { PriceSettings } from './PriceSettings';
import type { StatsData } from './queries';

/** Increases listed before "Arată toate". */
const SHOWN = 10;

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/**
 * Every price increase seen in the comparison window: the product, the store, the two prices with
 * their dates, the move in money and percent. The window and the sale filter are edited right here.
 */
export function IncreasesCard({ data, db }: { data: StatsData; db: PretometruDB | undefined }) {
  const { increases, windowDays, excludeSales } = data;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? increases : increases.slice(0, SHOWN);

  return (
    <section aria-labelledby="stats-increases" className={card}>
      <h2 id="stats-increases" className="text-base font-semibold">
        Creșteri de preț
      </h2>
      <p className={muted}>
        Văzute în ultimele {formatCount(windowDays, 'zi', 'zile')}, față de achiziția anterioară din
        același magazin, pe unitatea de măsură a produsului.
      </p>
      {db ? <PriceSettings db={db} windowDays={windowDays} excludeSales={excludeSales} /> : null}
      {increases.length === 0 ? (
        <p className={`${muted} py-2`}>
          Nicio creștere de preț în această perioadă. Apar după ce cumperi același produs de două
          ori din același magazin.
        </p>
      ) : (
        <>
          <PriceIncreaseList items={shown} label="Creșteri de preț" detailed />
          {increases.length > SHOWN ? (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={() => {
                setShowAll((open) => !open);
              }}
              className="mt-2 inline-flex min-h-10 items-center rounded-lg px-2 text-sm font-medium text-teal-800 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300 dark:hover:bg-slate-800"
            >
              {showAll ? 'Arată mai puține' : `Arată toate cele ${increases.length} creșteri`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
