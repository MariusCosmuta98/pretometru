import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { ProductPriceSummary } from '@/analytics';
import { formatLei } from '@/domain';
import type { PretometruDB } from '@/storage';
import { AddToList } from './AddToList';
import { SaleTag, UnitPrice } from './badges';
import { buildChartData } from './chart-data';
import { formatDay, paidEach, unitLabel } from './format';
import { MergePanel } from './MergePanel';
import { ChartBoundary, Failure, Loading } from './notices';
import { PriceComparison } from './PriceComparison';
import { PriceFilters } from './PriceFilters';
import { PriceHistory } from './PriceHistory';
import { loadProductPage } from './queries';
import { SplitPanel } from './SplitPanel';
import { button, card, muted, sectionTitle } from './styles';
import { useDb, useDbQuery } from './useLive';

// uPlot and its stylesheet load only when a product with a history is opened.
const PriceChart = lazy(() => import('./PriceChart'));

function Highlight({ summary }: { summary: ProductPriceSummary }) {
  const { cheapest, onlyAt, baseUnit, windowDays } = summary;
  if (!cheapest || onlyAt) return null; // one store only: nothing to compare (plan §7.6)
  return (
    <p className="mt-2 rounded-lg bg-teal-50 p-3 text-sm text-teal-950 dark:bg-teal-950 dark:text-teal-100">
      Cel mai ieftin în ultimele {windowDays} de zile: <strong>{cheapest.storeName}</strong>,{' '}
      <UnitPrice observation={cheapest.best} baseUnit={baseUnit} />
      {cheapest.best.onSale && <SaleTag />} ({formatDay(cheapest.best.date)})
    </p>
  );
}

function ChartSection({ summary }: { summary: ProductPriceSummary }) {
  const { observations, baseUnit } = summary;
  const data = useMemo(() => buildChartData(observations), [observations]);

  return (
    <section className={card} aria-labelledby="chart-title">
      <h2 id="chart-title" className={sectionTitle}>
        Evoluția prețului
      </h2>
      {observations.length < 2 ? (
        <p className={muted}>Graficul apare după a doua achiziție.</p>
      ) : (
        <>
          <figure
            role="img"
            aria-label={`Prețul pe ${unitLabel(baseUnit)} în timp, ${data.series.length} ${data.series.length === 1 ? 'magazin' : 'magazine'}`}
          >
            <ChartBoundary>
              <Suspense
                fallback={
                  <p role="status" className={muted}>
                    Se încarcă graficul…
                  </p>
                }
              >
                <PriceChart data={data} />
              </Suspense>
            </ChartBoundary>
          </figure>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {data.series.map((series) => (
              <li key={series.storeId} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-3 rounded-full"
                  style={{ backgroundColor: series.color }}
                />
                {series.label}
              </li>
            ))}
          </ul>
          <p className={`${muted} mt-1`}>Preț pe {unitLabel(baseUnit)}, în lei.</p>
        </>
      )}
    </section>
  );
}

function Incomparable({ summary }: { summary: ProductPriceSummary }) {
  const { incomparable, baseUnit } = summary;
  if (incomparable.length === 0) return null;
  return (
    <section className={card} aria-labelledby="incomparable-title">
      <h2 id="incomparable-title" className={sectionTitle}>
        Achiziții care nu intră în comparație ({incomparable.length})
      </h2>
      <p className={muted}>
        Nu au mărimea ambalajului, sau sunt într-o altă unitate decât „{unitLabel(baseUnit)}”. Dacă
        denumirea de pe bon nu are mărimea, o poți completa la verificarea bonului.
      </p>
      <ul className="mt-2 divide-y divide-slate-100 text-sm dark:divide-slate-800">
        {incomparable.map((o) => (
          <li key={o.lineId} className="py-2">
            <span className="font-medium">
              {formatDay(o.date)} · {o.storeName}
            </span>{' '}
            · {o.rawName} · {paidEach(o)} ({formatLei(o.lineTotalBani)})
          </li>
        ))}
      </ul>
    </section>
  );
}

function NotFound() {
  return (
    <section className={`${card} text-center`}>
      <p className="font-medium">Produsul nu a fost găsit.</p>
      <p className={muted}>Poate a fost îmbinat cu un altul.</p>
      <Link to="/produse" className={`${button} mt-3`}>
        Înapoi la produse
      </Link>
    </section>
  );
}

function ProductPage({ productId }: { productId: string }) {
  const database = useDb();
  const load = useCallback((db: PretometruDB) => loadProductPage(db, productId), [productId]);
  const page = useDbQuery(load);
  const [panel, setPanel] = useState<'merge' | 'split'>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const mergeButton = useRef<HTMLButtonElement>(null);
  const splitButton = useRef<HTMLButtonElement>(null);

  if (page.status === 'error') {
    return <Failure>Nu am putut deschide datele de pe acest dispozitiv.</Failure>;
  }
  if (page.status === 'loading' || database.status !== 'ready') {
    return <Loading what="produsul" />;
  }
  if (!page.value) return <NotFound />;

  const db = database.value;
  const { summary, category, categories, windowDays, excludeSales } = page.value;
  const { product } = summary;

  // The trigger buttons stay mounted, so closing a panel can hand the focus back to its button.
  const closePanel = () => {
    const trigger = panel === 'merge' ? mergeButton : splitButton;
    setPanel(undefined);
    setSelected(new Set());
    trigger.current?.focus();
  };
  const openPanel = (next: 'merge' | 'split') => {
    if (panel === next) closePanel();
    else {
      setPanel(next);
      setSelected(new Set());
    }
  };
  const toggle = (lineId: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (!next.delete(lineId)) next.add(lineId);
      return next;
    });

  return (
    <div className="space-y-4">
      <Link
        to="/produse"
        className="inline-block text-sm text-teal-700 underline dark:text-teal-300"
      >
        ← Produse
      </Link>

      <header className={card}>
        <h2 className="text-xl font-semibold">{product.name}</h2>
        <p className={muted}>
          {product.brand && `${product.brand} · `}
          {category ? `${category.icon} ${category.name}` : 'Fără categorie'} · preț pe{' '}
          {unitLabel(summary.baseUnit)}
        </p>
        <Highlight summary={summary} />
        <AddToList db={db} product={product} />
      </header>

      <PriceFilters db={db} windowDays={windowDays} excludeSales={excludeSales} />
      <PriceComparison summary={summary} />
      <ChartSection summary={summary} />
      <PriceHistory
        observations={summary.observations}
        baseUnit={summary.baseUnit}
        {...(panel === 'split' ? { selection: { selected, toggle } } : {})}
      />
      <Incomparable summary={summary} />

      <div className="flex flex-wrap gap-2">
        <button
          ref={mergeButton}
          type="button"
          className={button}
          aria-expanded={panel === 'merge'}
          onClick={() => openPanel('merge')}
        >
          Îmbină cu alt produs
        </button>
        <button
          ref={splitButton}
          type="button"
          className={button}
          aria-expanded={panel === 'split'}
          onClick={() => openPanel('split')}
          disabled={summary.observations.length === 0}
        >
          Separă achiziții
        </button>
      </div>
      {panel === 'merge' && <MergePanel db={db} product={product} onCancel={closePanel} />}
      {panel === 'split' && (
        <SplitPanel
          db={db}
          product={product}
          categories={categories}
          selected={selected}
          onCancel={closePanel}
        />
      )}
    </div>
  );
}

export function Component() {
  const { productId = '' } = useParams();
  // A new id (after a merge or split) starts a fresh page instead of reusing the old state.
  return <ProductPage key={productId} productId={productId} />;
}
