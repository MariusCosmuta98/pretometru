import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { List, Product } from '@/domain';
import { addProductToList, createListWithProduct, listOpenLists, type AddStatus } from '@/lists';
import type { PretometruDB } from '@/storage';
import { button, field, muted, primaryButton } from './styles';

const NEW_LIST = 'new';

interface Outcome {
  listId: string;
  listName: string;
  status: AddStatus;
}

function said(product: string, { listName, status }: Outcome): string {
  if (status === 'already') return `„${product}” e deja pe lista „${listName}”.`;
  if (status === 'reopened') {
    return `„${product}” era bifat pe lista „${listName}”: l-am pus din nou de cumpărat.`;
  }
  return `Adăugat pe lista „${listName}”.`;
}

/**
 * "Adaugă pe listă": puts this product on one of the shopping lists in use (the newest is
 * preselected) or on a new one, and links to the list. The lists themselves live in `@/lists`.
 */
export function AddToList({ db, product }: { db: PretometruDB; product: Product }) {
  const [open, setOpen] = useState(false);
  const [lists, setLists] = useState<List[]>();
  const [choice, setChoice] = useState<string>();
  const [name, setName] = useState('');
  const [outcome, setOutcome] = useState<Outcome>();
  const [problem, setProblem] = useState<string>();
  const trigger = useRef<HTMLButtonElement>(null);
  const listField = useRef<HTMLSelectElement>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const selectId = useId();
  const nameId = useId();

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    listOpenLists(db).then(
      (found) => {
        if (!cancelled) setLists(found);
      },
      () => {
        if (cancelled) return;
        setLists([]);
        setProblem('Nu am putut citi listele.');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [db, open]);

  // Focus goes to the first field once the lists are known (the fields exist only then).
  useEffect(() => {
    if (open && lists) (listField.current ?? nameField.current)?.focus();
  }, [open, lists]);

  const selected = choice ?? lists?.[0]?.id ?? NEW_LIST;
  const creating = selected === NEW_LIST;

  function close() {
    setOpen(false);
    setProblem(undefined);
    trigger.current?.focus();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(undefined);
    try {
      if (creating) {
        if (name.trim() === '') {
          setProblem('Scrie un nume pentru lista nouă.');
          nameField.current?.focus();
          return;
        }
        const { list, status } = await createListWithProduct(db, name, product.id);
        setOutcome({ listId: list.id, listName: list.name, status });
      } else {
        const list = lists?.find((entry) => entry.id === selected);
        if (!list) return;
        const { status } = await addProductToList(db, list.id, product.id);
        setOutcome({ listId: list.id, listName: list.name, status });
      }
      setName('');
      setChoice(undefined);
      close();
    } catch {
      setProblem('Nu am putut adăuga produsul pe listă.');
    }
  }

  return (
    <div className="mt-3 space-y-2">
      <button
        ref={trigger}
        type="button"
        className={button}
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            setLists(undefined);
            setOutcome(undefined);
            setOpen(true);
          }
        }}
      >
        Adaugă pe listă
      </button>

      {open && lists && (
        <form
          onSubmit={(event) => void submit(event)}
          noValidate
          aria-label="Adaugă pe listă"
          className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          {lists.length > 0 && (
            <div className="space-y-1">
              <label htmlFor={selectId} className="text-sm font-medium">
                Lista
              </label>
              <select
                id={selectId}
                ref={listField}
                className={field}
                value={selected}
                onChange={(event) => setChoice(event.target.value)}
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
                <option value={NEW_LIST}>Listă nouă…</option>
              </select>
            </div>
          )}
          {creating && (
            <div className="space-y-1">
              <label htmlFor={nameId} className="text-sm font-medium">
                Numele listei noi
              </label>
              <input
                id={nameId}
                ref={nameField}
                type="text"
                className={field}
                maxLength={80}
                autoComplete="off"
                placeholder="de ex. Săptămâna asta"
                value={name}
                aria-invalid={problem === 'Scrie un nume pentru lista nouă.' ? true : undefined}
                onChange={(event) => {
                  setName(event.target.value);
                  setProblem(undefined);
                }}
              />
            </div>
          )}
          {problem && (
            <p role="alert" className="text-sm text-red-700 dark:text-red-400">
              {problem}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={primaryButton}>
              Adaugă
            </button>
            <button type="button" className={button} onClick={close}>
              Anulează
            </button>
          </div>
        </form>
      )}

      <p role="status" className={outcome ? muted : 'sr-only'}>
        {outcome && (
          <>
            {said(product.name, outcome)}{' '}
            <Link
              to={`/liste/${outcome.listId}`}
              className="text-teal-700 underline dark:text-teal-300"
            >
              Deschide lista
            </Link>
          </>
        )}
      </p>
    </div>
  );
}
