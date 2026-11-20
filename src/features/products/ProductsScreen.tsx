import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ProductPriceSummary } from '@/analytics';
import { rankProducts } from '@/catalog';
import { ChangeBadge, SaleTag, UnitPrice } from './badges';
import { formatDay, formatVersusLast } from './format';
import { Failure, Loading } from './notices';
import { PriceFilters } from './PriceFilters';
import { loadOverview, type ProductsOverview } from './queries';
import { card, field, muted } from './styles';
import { useDb, useDbQuery } from './useLive';

function PriceLine({ summary }: { summary: ProductPriceSummary }) {
  const { last, cheapest, cheapestVsLastPct, onlyAt, incomparable, baseUnit } = summary;
  const versusLast =
    cheapestVsLastPct === undefined ? undefined : formatVersusLast(cheapestVsLastPct);

  if (!last) {
    return (
      <p className={muted}>
        {incomparable.length > 0
          ? `${incomparable.length} achiziții fără mărime cunoscută: nu se pot compara`
          : 'Nicio achiziție încă'}
      </p>
    );
  }
  return (
    <div className={muted}>
      <p>
        Ultimul preț: <UnitPrice observation={last} baseUnit={baseUnit} />
        {last.onSale && <SaleTag />} · {last.storeName} · {formatDay(last.date)}
      </p>
      {onlyAt ? (
        <p>Doar la {onlyAt.storeName}</p>
      ) : cheapest ? (
        <p>
          Cel mai ieftin: {cheapest.storeName}{' '}
          <UnitPrice observation={cheapest.best} baseUnit={baseUnit} />
          {cheapest.best.onSale && <SaleTag />} ({formatDay(cheapest.best.date)})
          {versusLast && <> · {versusLast}</>}
        </p>
      ) : (
        <p>Niciun preț în perioada aleasă</p>
      )}
    </div>
  );
}

function ProductRow({ summary }: { summary: ProductPriceSummary }) {
  const { product, change } = summary;
  return (
    <li>
      <Link
        to={`/produse/${product.id}`}
        className="block rounded-lg px-3 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700 dark:hover:bg-slate-800"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium">
            {product.name}
            {product.brand && (
              <span className="font-normal text-slate-600 dark:text-slate-400">
                {' '}
                · {product.brand}
              </span>
            )}
          </p>
          {change && <ChangeBadge change={change} />}
        </div>
        <PriceLine summary={summary} />
      </Link>
    </li>
  );
}

function Groups({ overview, query }: { overview: ProductsOverview; query: string }) {
  const matching = useMemo(() => {
    const all = overview.groups.flatMap((group) => group.products.map((s) => s.product));
    return new Set(rankProducts(all, query).map((product) => product.id));
  }, [overview, query]);

  const groups = overview.groups
    .map((group) => ({
      ...group,
      products: group.products.filter((s) => matching.has(s.product.id)),
    }))
    .filter((group) => group.products.length > 0);

  if (groups.length === 0) {
    return <p className={muted}>Niciun produs nu se potrivește cu „{query.trim()}”.</p>;
  }
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const id = `category-${group.category?.id ?? 'none'}`;
        return (
          <section key={id} aria-labelledby={id} className={card}>
            <h2 id={id} className="mb-1 flex items-center gap-2 text-base font-semibold">
              <span aria-hidden="true">{group.category?.icon ?? '📦'}</span>
              {group.category?.name ?? 'Fără categorie'}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                ({group.products.length})
              </span>
            </h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {group.products.map((summary) => (
                <ProductRow key={summary.product.id} summary={summary} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

export function Component() {
  const database = useDb();
  const overview = useDbQuery(loadOverview);
  const [query, setQuery] = useState('');

  if (overview.status === 'error') {
    return <Failure>Nu am putut deschide datele de pe acest dispozitiv.</Failure>;
  }
  if (overview.status === 'loading' || database.status !== 'ready') {
    return <Loading what="produsele" />;
  }

  const { value } = overview;
  if (value.groups.length === 0) {
    return (
      <section className={`${card} text-center`}>
        <p className="font-medium">Nu ai încă produse.</p>
        <p className={`${muted} mt-1`}>
          Adaugă un bon și confirmă-l: produsele și prețurile lor apar aici.
        </p>
        <Link
          to="/adauga"
          className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
        >
          Adaugă un bon
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <PriceFilters
        db={database.value}
        windowDays={value.windowDays}
        excludeSales={value.excludeSales}
      />
      <label className="block">
        <span className="sr-only">Caută un produs</span>
        <input
          type="search"
          className={field}
          placeholder="Caută un produs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <Groups overview={value} query={query} />
    </div>
  );
}
