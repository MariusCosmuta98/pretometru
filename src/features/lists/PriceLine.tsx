import type { PriceObservation } from '@/analytics';
import type { ItemQuote } from '@/lists';
import { formatDay, formatDays, formatPackPrice, formatUnitPrice } from './format';

/** Marks a sale price (the purchase carried a discount). */
function SaleTag() {
  return (
    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      reducere
    </span>
  );
}

/** `1,30 lei/rolă` with the shelf price of the pack when that helps, the date it was paid and the sale mark. */
function Price({ price }: { price: PriceObservation }) {
  const pack = formatPackPrice(price);
  return (
    <>
      <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">
        {formatUnitPrice(price.pricePerBaseMilliBani, price.baseUnit)}
      </span>
      {pack && <span> ({pack})</span>} · {formatDay(price.date)}
      {price.onSale && <SaleTag />}
    </>
  );
}

/**
 * Where an item is best bought, in words: the store with the price per base unit and the day it was
 * paid, "Doar la X" for a product bought at one store only (nothing to compare), and why there is no
 * store for the rest. Free text says nothing.
 */
export function PriceLine({
  quote,
  windowDays,
  excludeSales,
}: {
  quote: ItemQuote;
  windowDays: number;
  excludeSales: boolean;
}) {
  switch (quote.kind) {
    case 'cheapest':
      return (
        <p>
          Cel mai ieftin la <strong>{quote.store.name}</strong>: <Price price={quote.price} />
        </p>
      );
    case 'only-at':
      return (
        <p>
          Doar la <strong>{quote.store.name}</strong>: <Price price={quote.price} />
        </p>
      );
    case 'no-recent-price':
      return (
        <p>
          Niciun preț de comparat în ultimele {formatDays(windowDays)}
          {excludeSales && ', fără reduceri'}. Ultima achiziție: {quote.last.storeName},{' '}
          <Price price={quote.last} />
        </p>
      );
    case 'incomparable':
      return <p>Prețul nu se poate compara: achizițiile n-au mărimea ambalajului.</p>;
    case 'never-bought':
      return <p>Încă necumpărat: nu știm unde e mai ieftin.</p>;
    case 'unlinked':
      return null;
  }
}
