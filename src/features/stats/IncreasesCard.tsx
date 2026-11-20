import { useState } from 'react';
import { Link } from 'react-router';
import { buttonQuiet, card } from '@/ui/controls';
import { lastDays } from '@/ui/insights/format';
import { PriceIncreaseList } from '@/ui/insights/PriceIncreaseList';
import { plural } from '@/ui/plural';
import type { StatsData } from './queries';

/** Increases listed before "Arată toate". */
const SHOWN = 10;

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/**
 * Every price increase seen in the comparison window: the product, the store, the two prices with
 * their dates, the move in money and percent, the shelf price of the pack and sale marks. The window
 * and the sale filter are the settings of the product screens, which is where they are changed.
 */
export function IncreasesCard({ data }: { data: StatsData }) {
  const { increases, windowDays, excludeSales } = data;
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? increases : increases.slice(0, SHOWN);

  return (
    <section aria-labelledby="stats-increases" className={card}>
      <h2 id="stats-increases" className="text-base font-semibold">
        Creșteri de preț
      </h2>
      <p className={`${muted} mb-1`}>
        Văzute în {lastDays(windowDays)}, față de achiziția anterioară din același magazin, pe
        unitatea de măsură a produsului.
        {excludeSales ? ' Prețurile la reducere nu sunt luate în calcul.' : ''} Perioada de
        comparație și filtrul pentru reduceri se schimbă în{' '}
        <Link to="/produse" className="font-medium underline">
          Produse
        </Link>
        .
      </p>
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
              className={`${buttonQuiet} mt-2`}
            >
              {showAll
                ? 'Arată mai puține'
                : `Arată toate cele ${plural(increases.length, 'creștere', 'creșteri')}`}
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
