import { useEffect, useState } from 'react';
import { searchProducts } from '@/catalog';
import type { Product } from '@/domain';
import type { PretometruDB } from '@/storage';
import { field, muted } from './styles';

/** Type-ahead choice of an existing product (never the one in `exclude`). */
export function ProductPicker({
  db,
  exclude,
  value,
  onChange,
  legend,
}: {
  db: PretometruDB;
  exclude: string;
  value: Product | undefined;
  onChange: (product: Product) => void;
  legend: string;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);

  useEffect(() => {
    let cancelled = false;
    searchProducts(db, query, 9).then(
      (found) => {
        if (!cancelled) setResults(found.filter((product) => product.id !== exclude).slice(0, 8));
      },
      () => {
        if (!cancelled) setResults([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, query, exclude]);

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      <input
        type="search"
        className={field}
        placeholder="Caută după nume, marcă sau cod"
        aria-label="Caută un produs"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {results.length === 0 ? (
        <p className={muted}>Niciun produs găsit.</p>
      ) : (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {results.map((product) => (
            <li key={product.id}>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800">
                <input
                  type="radio"
                  name="product-picker"
                  className="size-4 accent-teal-700"
                  checked={value?.id === product.id}
                  onChange={() => onChange(product)}
                />
                <span>
                  {product.name}
                  {product.brand && <span className={muted}> · {product.brand}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}
