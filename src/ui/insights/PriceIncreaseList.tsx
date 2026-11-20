import { Link } from 'react-router';
import type { PriceIncrease } from '@/analytics';
import {
  formatDay,
  formatPackPrice,
  formatPercent,
  formatUnitDelta,
  formatUnitPriceMove,
} from './format';

const muted = 'text-sm text-slate-600 dark:text-slate-400';

function Sale({ children }: { children: string }) {
  return (
    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      {children}
    </span>
  );
}

/**
 * Products that got dearer at a store, each a link to its product page. The compact form is the
 * Home card (store and the two prices, with a mark when either was a sale price: a promotion that
 * ended reads as an increase); `detailed` adds the move in money, the dates and the shelf price of
 * the pack.
 */
export function PriceIncreaseList({
  items,
  label,
  detailed = false,
}: {
  items: readonly PriceIncrease[];
  /** The accessible name of the list. */
  label: string;
  detailed?: boolean;
}) {
  return (
    <ul aria-label={label} className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map(({ product, baseUnit, change }) => {
        const { from, to } = change;
        const shelf = detailed ? formatPackPrice(to) : undefined;
        return (
          <li key={`${product.id}:${to.storeId}`}>
            <Link
              to={`/produse/${product.id}`}
              className="block rounded-lg px-3 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700 dark:hover:bg-slate-800"
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium">
                  {product.name}
                  {product.brand ? (
                    <span className="font-normal text-slate-600 dark:text-slate-400">
                      {' '}
                      · {product.brand}
                    </span>
                  ) : null}
                </p>
                <span className="whitespace-nowrap font-medium tabular-nums text-red-700 dark:text-red-400">
                  <span aria-hidden="true">↑</span> <span className="sr-only">Scumpire: </span>
                  {formatPercent(change.pct)}
                </span>
              </div>
              <p className={muted}>
                {to.storeName} ·{' '}
                {formatUnitPriceMove(
                  from.pricePerBaseMilliBani,
                  to.pricePerBaseMilliBani,
                  baseUnit,
                )}
                {detailed
                  ? ` (${formatUnitDelta(change.deltaMilliBani, to.pricePerBaseMilliBani, baseUnit)})`
                  : null}
                {from.onSale ? <Sale>preț anterior la reducere</Sale> : null}
                {to.onSale ? <Sale>preț actual la reducere</Sale> : null}
              </p>
              {detailed ? (
                <p className={muted}>
                  {formatDay(from.date)} → {formatDay(to.date)}
                  {shelf ? ` · ${shelf}` : null}
                </p>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
