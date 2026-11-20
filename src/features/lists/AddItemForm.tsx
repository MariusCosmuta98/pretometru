import { useEffect, useId, useState, type FormEvent, type RefObject } from 'react';
import { searchProducts } from '@/catalog';
import { normalizeName, type Product } from '@/domain';
import { addProductToList, addTextItem, type AddStatus } from '@/lists';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, buttonSecondary, card, inputClass, labelClass } from '@/ui/controls';

const SUGGESTIONS = 6;

function said(name: string, status: AddStatus): string {
  if (status === 'already') return `„${name}” e deja pe listă.`;
  if (status === 'reopened') return `„${name}” era bifat: l-am pus din nou de cumpărat.`;
  return `Adăugat: ${name}.`;
}

/**
 * Adds an item: a product of the catalog (tap a suggestion) or free text. Enter adds the text as
 * typed, except when it is the exact name of a catalog product, so a typed "Lapte UHT" still gets
 * its prices.
 */
export function AddItemForm({
  db,
  listId,
  inputRef,
}: {
  db: PretometruDB;
  listId: string;
  /** Owned by the screen, which puts focus back here after it removed what had it. */
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [notice, setNotice] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [empty, setEmpty] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const text = query.trim();

  useEffect(() => {
    if (text === '') return undefined;
    let cancelled = false;
    searchProducts(db, text, SUGGESTIONS).then(
      (products) => {
        if (!cancelled) setFound(products);
      },
      () => {
        if (!cancelled) setFound([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, text]);

  const suggestions = text === '' ? [] : found;

  function done(message: string) {
    setNotice(message);
    setProblem(undefined);
    setEmpty(false);
    setQuery('');
    inputRef.current?.focus();
  }

  async function addProduct(product: Product) {
    try {
      const { status } = await addProductToList(db, listId, product.id);
      done(said(product.name, status));
    } catch {
      setProblem('Nu am putut adăuga articolul.');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (text === '') {
      setProblem('Scrie ce vrei să adaugi.');
      setEmpty(true);
      setNotice(undefined);
      inputRef.current?.focus();
      return;
    }
    try {
      const wanted = normalizeName(text);
      const exact = (await searchProducts(db, text, SUGGESTIONS)).find(
        (product) => normalizeName(product.name) === wanted,
      );
      if (exact) {
        await addProduct(exact);
        return;
      }
      await addTextItem(db, listId, text);
      done(`Adăugat: ${text}.`);
    } catch {
      setProblem('Nu am putut adăuga articolul.');
    }
  }

  return (
    <div className={`${card} space-y-2`}>
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-2">
        <label htmlFor={inputId} className={labelClass}>
          Adaugă un articol
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            ref={inputRef}
            type="text"
            className={inputClass}
            placeholder="ex.: lapte, pâine"
            autoComplete="off"
            maxLength={120}
            value={query}
            aria-describedby={text === '' ? undefined : hintId}
            aria-invalid={empty ? true : undefined}
            onChange={(event) => {
              setQuery(event.target.value);
              setProblem(undefined);
              setEmpty(false);
            }}
          />
          <button type="submit" className={`${buttonPrimary} shrink-0`}>
            Adaugă
          </button>
        </div>
        {text !== '' && (
          <p id={hintId} className="text-sm text-slate-600 dark:text-slate-400">
            Enter adaugă „{text}” ca articol. Alege un produs din catalog ca să vezi unde e cel mai
            ieftin.
          </p>
        )}
      </form>

      {suggestions.length > 0 && (
        <ul aria-label="Produse din catalog" className="flex flex-wrap gap-2">
          {suggestions.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className={buttonSecondary}
                aria-label={`Adaugă ${product.name}${product.brand ? `, ${product.brand}` : ''}`}
                onClick={() => void addProduct(product)}
              >
                <span aria-hidden="true">+</span>
                <span>
                  {product.name}
                  {product.brand && (
                    <span className="font-normal text-slate-500 dark:text-slate-400">
                      {' '}
                      · {product.brand}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p role="status" className={notice ? 'text-sm text-teal-800 dark:text-teal-300' : 'sr-only'}>
        {notice}
      </p>
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
    </div>
  );
}
