import { useEffect, useState, type FormEvent } from 'react';
import { baseUnitOf, BASE_UNITS, type BaseUnit, type Category, type Product } from '@/domain';
import { parseEanInput, type LineForm, type NewProductInput } from '@/import';
import { buttonPrimary, buttonQuiet, buttonSecondary, noticeClass } from '@/ui/controls';
import { BASE_UNIT_LABELS } from '../labels';
import { Dialog } from './Dialog';
import { SelectField, TextField } from './fields';

interface ProductPickerProps {
  line: LineForm;
  /** 1-based position of the line on screen. */
  number: number;
  /** Likely products the catalog proposed for this line, best first. */
  candidates: ReadonlyArray<{ product: Product; score: number }>;
  categories: readonly Category[];
  /** Must keep its identity between renders. */
  search: (query: string) => Promise<Product[]>;
  create: (input: NewProductInput) => Promise<Product>;
  onPick: (product: Product) => void;
  /** The line stays without a product. */
  onClear: () => void;
  onClose: () => void;
}

const baseUnitOptions = BASE_UNITS.map((unit) => ({ value: unit, label: BASE_UNIT_LABELS[unit] }));

function ProductButton({
  product,
  label,
  onPick,
}: {
  product: Product;
  label: string;
  onPick: (product: Product) => void;
}) {
  return (
    <button
      type="button"
      className={`${buttonSecondary} w-full justify-start text-left`}
      aria-label={`${label} „${product.name}”`}
      onClick={() => {
        onPick(product);
      }}
    >
      <span className="min-w-0">
        <span className="block truncate">{product.name}</span>
        {product.brand ? (
          <span className="block truncate text-xs font-normal opacity-70">{product.brand}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Choose the product a printed line stands for: a suggestion, a search hit, or a new product. */
export function ProductPicker({
  line,
  number,
  candidates,
  categories,
  search,
  create,
  onPick,
  onClear,
  onClose,
}: ProductPickerProps) {
  const productCategories = categories.filter((category) => category.system !== true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);

  const [name, setName] = useState(line.rawName);
  const [categoryId, setCategoryId] = useState(
    productCategories.some((category) => category.id === line.categoryId)
      ? (line.categoryId ?? '')
      : '',
  );
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(
    baseUnitOf(line.packQty.trim() === '' ? line.qtyUnit : line.packUnit),
  );
  const [ean, setEan] = useState(line.ean);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(
      () => {
        search(query).then(
          (found) => {
            if (cancelled) return;
            setResults(found);
            setSearchFailed(false);
          },
          () => {
            if (!cancelled) setSearchFailed(true);
          },
        );
      },
      query === '' ? 0 : 150,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, search]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === '') return setCreateError('Completează numele produsului.');
    if (categoryId === '') return setCreateError('Alege categoria produsului.');
    const parsedEan = ean.trim() === '' ? undefined : parseEanInput(ean);
    if (ean.trim() !== '' && parsedEan === undefined) {
      return setCreateError('EAN invalid: 4 până la 14 cifre.');
    }

    setCreating(true);
    setCreateError(undefined);
    try {
      onPick(
        await create({
          name: trimmed,
          categoryId,
          baseUnit,
          ...(parsedEan ? { ean: parsedEan } : {}),
        }),
      );
    } catch {
      setCreateError('Produsul nu a putut fi creat. Încearcă din nou.');
      setCreating(false);
    }
  }

  const suggested = new Set(candidates.map((candidate) => candidate.product.id));

  return (
    <Dialog title={`Produs pentru linia ${number}`} onClose={onClose}>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Linia tipărită: <span className="font-medium">„{line.rawName}”</span>
      </p>

      {candidates.length > 0 ? (
        <section aria-labelledby="picker-suggestions" className="space-y-2">
          <h3 id="picker-suggestions" className="font-semibold">
            Sugestii
          </h3>
          <ul className="space-y-2">
            {candidates.map(({ product }) => (
              <li key={product.id}>
                <ProductButton product={product} label="Alege sugestia" onPick={onPick} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="picker-search" className="space-y-2">
        <h3 id="picker-search" className="font-semibold">
          Caută un produs existent
        </h3>
        <TextField
          id="picker-query"
          type="search"
          label="Caută produs"
          value={query}
          onChange={setQuery}
          placeholder="Nume, marcă sau EAN"
        />
        {searchFailed ? (
          <p role="alert" className={noticeClass.error}>
            Căutarea nu a funcționat. Încearcă din nou.
          </p>
        ) : results.filter((product) => !suggested.has(product.id)).length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {query === '' ? 'Nu există încă produse.' : 'Niciun produs găsit.'}
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Rezultate">
            {results
              .filter((product) => !suggested.has(product.id))
              .map((product) => (
                <li key={product.id}>
                  <ProductButton product={product} label="Alege" onPick={onPick} />
                </li>
              ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="picker-new" className="space-y-2">
        <h3 id="picker-new" className="font-semibold">
          Produs nou
        </h3>
        <form
          onSubmit={(event) => {
            void submit(event);
          }}
          className="space-y-3"
          noValidate
        >
          <TextField id="new-product-name" label="Nume produs" value={name} onChange={setName} />
          <SelectField
            id="new-product-category"
            label="Categorie"
            value={categoryId}
            onChange={setCategoryId}
            options={[
              { value: '', label: 'Alege categoria' },
              ...productCategories.map((category) => ({
                value: category.id,
                label: `${category.icon} ${category.name}`,
              })),
            ]}
          />
          <SelectField
            id="new-product-unit"
            label="Preț comparat pe"
            value={baseUnit}
            onChange={setBaseUnit}
            options={baseUnitOptions}
          />
          <TextField
            id="new-product-ean"
            label="EAN (opțional)"
            value={ean}
            onChange={setEan}
            inputMode="numeric"
          />
          {createError ? (
            <p role="alert" className={noticeClass.error}>
              {createError}
            </p>
          ) : null}
          <button type="submit" className={buttonPrimary} disabled={creating}>
            Creează produsul
          </button>
        </form>
      </section>

      <div className="flex flex-wrap justify-between gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
        <button type="button" className={buttonQuiet} onClick={onClear}>
          Fără produs
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Renunță
        </button>
      </div>
    </Dialog>
  );
}
