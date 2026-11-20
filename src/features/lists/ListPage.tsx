import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  loadListView,
  moveItem,
  removeCheckedItems,
  removeItem,
  restoreList,
  uncheckAll,
  type ListView,
  type PlannedItem,
} from '@/lists';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, buttonSecondary, card, noticeClass } from '@/ui/controls';
import { AddItemForm } from './AddItemForm';
import { ConfirmBar } from './ConfirmBar';
import { moveButtonId, type Direction } from './focus';
import { formatEstimate, formatItems } from './format';
import { ItemRows, StoreSection, type RowProps } from './ItemGroups';
import { Failure, Loading } from './notices';
import { PriceSettings } from './PriceSettings';
import { useDb, useDbQuery } from './useLive';

const SAVE_FAILED = 'Nu am putut salva modificarea.';

function ViewSwitch({
  grouped,
  onChange,
}: {
  grouped: boolean;
  onChange: (grouped: boolean) => void;
}) {
  const option = (value: boolean, label: string) => (
    <label className="flex-1">
      <input
        type="radio"
        name="list-view"
        className="peer sr-only"
        checked={grouped === value}
        onChange={() => onChange(value)}
      />
      <span className="flex min-h-11 cursor-pointer items-center justify-center px-4 text-sm font-medium peer-checked:bg-teal-700 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-teal-400">
        {label}
      </span>
    </label>
  );
  return (
    <fieldset className="flex overflow-hidden rounded-lg border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900">
      <legend className="sr-only">Afișare</legend>
      {option(true, 'Pe magazine')}
      {option(false, 'Listă simplă')}
    </fieldset>
  );
}

function Summary({ view }: { view: ListView }) {
  const { list, plan } = view;
  const total = plan.items.length;
  return (
    <header className={`${card} space-y-1`}>
      <h2 className="break-words text-xl font-semibold">{list.name}</h2>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        {total === 0 ? 'Listă goală' : `${plan.checked} din ${formatItems(total)} bifate`}
      </p>
      {total > 0 && (
        <p className="text-sm">
          Total estimat: <strong>{formatEstimate(plan.estimateBani)}</strong>
          {plan.unestimated > 0 && (
            <span className="text-slate-600 dark:text-slate-400">
              {' '}
              · {formatItems(plan.unestimated)} fără preț
            </span>
          )}
        </p>
      )}
    </header>
  );
}

function LoadedList({ db, view }: { db: PretometruDB; view: ListView }) {
  const { list, plan, windowDays, excludeSales } = view;
  const [grouped, setGrouped] = useState(true);
  const [editing, setEditing] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [confirmClear, setConfirmClear] = useState(false);
  const addInput = useRef<HTMLInputElement>(null);
  const clearButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ id: string; direction: Direction }>(undefined);

  // A moved item can lose focus when the list re-renders in its new order: put it back on the
  // button that was used (or on the other one when that has reached the end of the list), in the
  // commit that shows the new order.
  useLayoutEffect(() => {
    const request = pendingFocus.current;
    if (!request) return;
    pendingFocus.current = undefined;
    const other: Direction = request.direction === 'up' ? 'down' : 'up';
    for (const direction of [request.direction, other]) {
      const button = document.getElementById(moveButtonId(request.id, direction));
      if (button instanceof HTMLButtonElement && !button.disabled) {
        button.focus();
        return;
      }
    }
  }, [view]);

  const run = useCallback(async (action: Promise<unknown>): Promise<boolean> => {
    setProblem(undefined);
    try {
      await action;
      return true;
    } catch {
      setProblem(SAVE_FAILED);
      return false;
    }
  }, []);

  const rows: RowProps = {
    db,
    windowDays,
    excludeSales,
    editing,
    onEdit: setEditing,
    run,
    onMove: (entry: PlannedItem, direction: Direction, anchor: PlannedItem) => {
      pendingFocus.current = { id: entry.item.id, direction };
      setProblem(undefined);
      moveItem(
        db,
        entry.item.id,
        direction === 'up' ? { before: anchor.item.id } : { after: anchor.item.id },
      ).then(
        (moved) => {
          if (!moved) pendingFocus.current = undefined;
        },
        () => {
          pendingFocus.current = undefined;
          setProblem(SAVE_FAILED);
        },
      );
    },
    onRemove: (entry: PlannedItem) => {
      setEditing(undefined);
      void run(removeItem(db, entry.item.id)).then((done) => {
        if (done) addInput.current?.focus();
      });
    },
  };

  const checkedWord =
    plan.checked === 1 ? 'articolul bifat' : `cele ${formatItems(plan.checked)} bifate`;

  return (
    <div className="space-y-4">
      <Link to="/liste" className="inline-block text-sm text-teal-700 underline dark:text-teal-300">
        ← Liste
      </Link>

      <Summary view={view} />

      {list.archivedAt !== undefined && (
        <div className={`${noticeClass.info} flex flex-wrap items-center justify-between gap-2`}>
          <p>Lista e arhivată.</p>
          <button
            type="button"
            className={buttonSecondary}
            onClick={() =>
              void run(restoreList(db, list.id)).then((done) => {
                if (done) addInput.current?.focus();
              })
            }
          >
            Restaurează
          </button>
        </div>
      )}

      {problem && (
        <div role="alert" className={noticeClass.error}>
          {problem}
        </div>
      )}

      <AddItemForm db={db} listId={list.id} inputRef={addInput} />

      <PriceSettings db={db} windowDays={windowDays} excludeSales={excludeSales} />

      {plan.items.length === 0 ? (
        <section className={`${card} text-center`}>
          <p className="font-medium">Lista e goală.</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Adaugă primul articol mai sus: cele din catalog îți arată unde e cel mai ieftin.
          </p>
        </section>
      ) : (
        <>
          <ViewSwitch grouped={grouped} onChange={setGrouped} />

          {grouped ? (
            <div className="space-y-4">
              {plan.groups.map((group) => (
                <StoreSection key={group.store?.id ?? 'none'} group={group} {...rows} />
              ))}
            </div>
          ) : (
            <section aria-label="Articolele listei" className={card}>
              <ItemRows items={plan.items} {...rows} />
            </section>
          )}

          {plan.checked > 0 && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={buttonSecondary}
                onClick={() =>
                  void run(uncheckAll(db, list.id)).then(() => addInput.current?.focus())
                }
              >
                Debifează tot
              </button>
              <button
                type="button"
                ref={clearButton}
                className={buttonSecondary}
                onClick={() => setConfirmClear(true)}
              >
                Șterge bifatele ({plan.checked})
              </button>
            </div>
          )}
          {confirmClear && plan.checked > 0 && (
            <ConfirmBar
              message={`Ștergi ${checkedWord} din listă?`}
              confirmLabel="Șterge bifatele"
              onCancel={() => {
                setConfirmClear(false);
                clearButton.current?.focus();
              }}
              onConfirm={() => {
                setConfirmClear(false);
                void run(removeCheckedItems(db, list.id)).then(() => addInput.current?.focus());
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function NotFound() {
  return (
    <section className={`${card} text-center`}>
      <p className="font-medium">Lista nu a fost găsită.</p>
      <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Poate a fost ștearsă.</p>
      <Link to="/liste" className={buttonPrimary}>
        Înapoi la liste
      </Link>
    </section>
  );
}

/** One list: its items grouped by the store where each is cheapest (or as a plain list), with the add form on top. */
export function ListPage({ listId }: { listId: string }) {
  const database = useDb();
  const load = useCallback((db: PretometruDB) => loadListView(db, listId), [listId]);
  const view = useDbQuery(load);

  if (view.status === 'error') {
    return <Failure>Nu am putut deschide lista de pe acest dispozitiv.</Failure>;
  }
  if (view.status === 'loading' || database.status !== 'ready') {
    return <Loading what="lista" />;
  }
  if (!view.value) return <NotFound />;
  return <LoadedList db={database.value} view={view.value} />;
}
