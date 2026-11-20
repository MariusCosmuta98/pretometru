import { Link } from 'react-router';
import type { PriceObservation } from '@/analytics';
import { formatLei, type BaseUnit } from '@/domain';
import { SaleTag } from './badges';
import { formatDay, formatPack, formatQuantity, formatUnitPrice, paidEach } from './format';
import { card, muted, sectionTitle } from './styles';

export interface Selection {
  selected: ReadonlySet<string>;
  toggle: (lineId: string) => void;
}

/** Every comparable purchase, newest first; with `selection` each one can be ticked (split mode). */
export function PriceHistory({
  observations,
  baseUnit,
  selection,
}: {
  observations: readonly PriceObservation[];
  baseUnit: BaseUnit;
  selection?: Selection;
}) {
  const newestFirst = observations.toReversed();
  return (
    <section className={card} aria-labelledby="history-title">
      <h2 id="history-title" className={sectionTitle}>
        Istoric ({observations.length})
      </h2>
      {newestFirst.length === 0 ? (
        <p className={muted}>Nicio achiziție confirmată încă.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {newestFirst.map((o) => (
            <li key={o.lineId} className="flex gap-3 py-3">
              {selection && (
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-teal-700"
                  aria-label={`Alege achiziția din ${formatDay(o.date)} de la ${o.storeName}`}
                  checked={selection.selected.has(o.lineId)}
                  onChange={() => selection.toggle(o.lineId)}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-medium">
                    {formatDay(o.date)} · {o.storeName}
                  </p>
                  <p className="tabular-nums">
                    {formatUnitPrice(o.pricePerBaseMilliBani, baseUnit)}
                    {o.onSale && <SaleTag />}
                  </p>
                </div>
                <p className={`${muted} truncate`} title={o.rawName}>
                  {o.rawName}
                </p>
                <p className={muted}>
                  {formatQuantity(o.qty, o.unit)} × {paidEach(o)} = {formatLei(o.lineTotalBani)}
                  {o.pack && ` · ${formatPack(o.pack)}`}
                  {o.onSale && ` · reducere ${formatLei(o.discountBani)}`} ·{' '}
                  <Link
                    to={`/bonuri/${o.receiptId}`}
                    className="text-teal-700 underline dark:text-teal-300"
                  >
                    Vezi bonul
                  </Link>
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
