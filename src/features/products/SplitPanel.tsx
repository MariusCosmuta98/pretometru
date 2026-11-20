import { useState } from 'react';
import { useNavigate } from 'react-router';
import { splitProduct } from '@/catalog';
import { BASE_UNITS, type BaseUnit, type Category, type Product } from '@/domain';
import type { PretometruDB } from '@/storage';
import { unitLabel } from './format';
import { ProductPicker } from './ProductPicker';
import { button, card, field, muted, primaryButton } from './styles';

/**
 * Moves the selected purchases to a new or an existing product. A printed name follows its
 * purchases (the catalog moves the alias when every purchase of that name moves).
 */
export function SplitPanel({
  db,
  product,
  categories,
  selected,
  onCancel,
}: {
  db: PretometruDB;
  product: Product;
  categories: readonly Category[];
  selected: ReadonlySet<string>;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [name, setName] = useState(product.name);
  const [categoryId, setCategoryId] = useState(product.categoryId);
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(product.baseUnit);
  const [existing, setExisting] = useState<Product>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const ready = selected.size > 0 && (mode === 'new' ? name.trim() !== '' : existing !== undefined);

  const split = async () => {
    const target =
      mode === 'new'
        ? { create: { name, categoryId, baseUnit } }
        : existing && { productId: existing.id };
    if (!target || selected.size === 0) return;
    setBusy(true);
    setFailed(false);
    try {
      const result = await splitProduct(db, product.id, { lineIds: [...selected], target });
      await navigate(`/produse/${result.product.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <section className={`${card} space-y-3`} aria-labelledby="split-title">
      <h2 id="split-title" className="text-base font-semibold">
        Separă achiziții
      </h2>
      <p className={muted}>
        {selected.size === 0
          ? 'Bifează în istoric achizițiile care sunt de fapt alt produs.'
          : `${selected.size} ${selected.size === 1 ? 'achiziție aleasă' : 'achiziții alese'}. Denumirea de pe bon le urmează la următorul import.`}
      </p>

      <div role="radiogroup" aria-label="Unde se mută" className="flex flex-wrap gap-4 text-sm">
        <label className="flex min-h-10 items-center gap-2">
          <input
            type="radio"
            name="split-mode"
            className="size-4 accent-teal-700"
            checked={mode === 'new'}
            onChange={() => setMode('new')}
          />
          Produs nou
        </label>
        <label className="flex min-h-10 items-center gap-2">
          <input
            type="radio"
            name="split-mode"
            className="size-4 accent-teal-700"
            checked={mode === 'existing'}
            onChange={() => setMode('existing')}
          />
          Alt produs existent
        </label>
      </div>

      {mode === 'new' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="mb-1 block text-sm font-medium">Numele noului produs</span>
            <input
              className={field}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Categorie</span>
            <select
              className={field}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium">Prețul se compară pe</span>
            <select
              className={field}
              value={baseUnit}
              onChange={(event) => setBaseUnit(event.target.value as BaseUnit)}
            >
              {BASE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unitLabel(unit)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : (
        <ProductPicker
          db={db}
          exclude={product.id}
          value={existing}
          onChange={setExisting}
          legend="Mută în produsul"
        />
      )}

      {failed && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          Nu am putut separa achizițiile. Nu s-a schimbat nimic.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={!ready || busy}
          onClick={() => void split()}
        >
          Mută achizițiile
        </button>
        <button type="button" className={button} onClick={onCancel} disabled={busy}>
          Renunță
        </button>
      </div>
    </section>
  );
}
