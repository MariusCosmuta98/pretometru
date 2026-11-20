import type { PriceObservation, ProductPriceSummary, StoreComparison } from '@/analytics';
import { formatLei } from '@/domain';
import { SaleTag, UnitPrice } from './badges';
import {
  formatDay,
  formatPack,
  formatPackPrice,
  formatPercent,
  formatUnitPrice,
  paidEach,
  unitLabel,
} from './format';
import { card, muted, sectionTitle } from './styles';

function LastPaid({ observation }: { observation: PriceObservation }) {
  return (
    <>
      {observation.unit === 'buc' ? formatLei(observation.paidUnitBani) : paidEach(observation)}
      {observation.pack && <span className={muted}> · {formatPack(observation.pack)}</span>}
      <br />
      <span className={muted}>{formatDay(observation.date)}</span>
    </>
  );
}

function Row({
  store,
  cheapest,
  summary,
}: {
  store: StoreComparison;
  cheapest: boolean;
  summary: ProductPriceSummary;
}) {
  const { baseUnit, windowDays } = summary;
  const { best, latest } = store;
  const shown = best ?? latest;
  const pack = formatPackPrice(shown);

  return (
    <tr className={best ? '' : 'text-slate-500 dark:text-slate-400'}>
      <th scope="row" className="py-2 pr-3 text-left align-top font-medium">
        {store.storeName}
        {cheapest && (
          <span className="ml-1 rounded bg-teal-100 px-1.5 py-0.5 text-xs font-medium text-teal-900 dark:bg-teal-900/40 dark:text-teal-200">
            cel mai ieftin
          </span>
        )}
        {!best && (
          <span className="block text-xs font-normal">mai vechi de {windowDays} de zile</span>
        )}
      </th>
      <td className="py-2 pr-3 align-top tabular-nums">
        {formatUnitPrice(shown.pricePerBaseMilliBani, baseUnit)}
        {shown.onSale && <SaleTag />}
        <span className={`${muted} block`}>
          {formatDay(shown.date)}
          {pack && ` · ${pack}`}
        </span>
      </td>
      <td className="py-2 pr-3 align-top tabular-nums">
        {store.overCheapestPct === undefined || store.overCheapestPct === 0
          ? '—'
          : formatPercent(store.overCheapestPct)}
      </td>
      <td className="hidden py-2 align-top tabular-nums sm:table-cell">
        <LastPaid observation={latest} />
      </td>
    </tr>
  );
}

/**
 * The comparison table: per store the best price in the window (date and sale mark included), how
 * much dearer it is than the cheapest store, and the last purchase. A product bought at one store
 * only says so instead (plan §7.6).
 */
export function PriceComparison({ summary }: { summary: ProductPriceSummary }) {
  const { stores, onlyAt, last, baseUnit } = summary;

  if (onlyAt && last) {
    return (
      <section className={card} aria-labelledby="comparison-title">
        <h2 id="comparison-title" className={sectionTitle}>
          Comparație pe magazine
        </h2>
        <p>
          Cumpărat doar la <strong>{onlyAt.storeName}</strong>, deci nu are încă cu ce să fie
          comparat.
        </p>
        <p className={muted}>
          Ultimul preț: <UnitPrice observation={last} baseUnit={baseUnit} />
          {last.onSale && <SaleTag />} · {formatDay(last.date)}
        </p>
      </section>
    );
  }

  return (
    <section className={card} aria-labelledby="comparison-title">
      <h2 id="comparison-title" className={sectionTitle}>
        Comparație pe magazine
      </h2>
      {stores.length === 0 ? (
        <p className={muted}>
          Nu există încă achiziții de comparat
          {summary.incomparable.length > 0 && ' (vezi mai jos achizițiile fără mărime)'}.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">
            Prețul pe {unitLabel(baseUnit)} la fiecare magazin, în ultimele {summary.windowDays} de
            zile
          </caption>
          <thead className="text-left text-xs text-slate-600 dark:text-slate-400">
            <tr>
              <th scope="col" className="pb-1 pr-3 font-medium">
                Magazin
              </th>
              <th scope="col" className="pb-1 pr-3 font-medium">
                Cel mai bun preț
              </th>
              <th scope="col" className="pb-1 pr-3 font-medium">
                Diferență<span className="sr-only"> față de cel mai ieftin</span>
              </th>
              <th scope="col" className="hidden pb-1 font-medium sm:table-cell">
                Ultima achiziție
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {stores.map((store) => (
              <Row
                key={store.storeId}
                store={store}
                summary={summary}
                cheapest={summary.cheapest?.storeId === store.storeId}
              />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
