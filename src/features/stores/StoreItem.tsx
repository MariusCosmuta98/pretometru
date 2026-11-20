import { useState } from 'react';
import { deleteStore, mergeStores, renameStore, type StoreRow } from '@/admin';
import type { PretometruDB } from '@/storage';
import { buttonQuiet, card } from '@/ui/controls';
import { ConfirmPanel } from '@/ui/ConfirmPanel';
import { deleteButtonId, listHeadingId, mergeButtonId, renameButtonId } from './ids';
import { MergePanel } from './MergePanel';
import { describeStore, errorText, mergedText, receiptsText } from './messages';
import { RenameForm } from './RenameForm';

export type Panel = { kind: 'rename' | 'merge' | 'delete'; id: string };

export interface Notice {
  kind: 'success' | 'error';
  text: string;
}

/** What a row needs from its screen. */
export interface ScreenContext {
  db: PretometruDB;
  panel: Panel | undefined;
  setPanel: (panel: Panel | undefined) => void;
  /** Says what happened; focus goes to `focusId` afterwards, if any. */
  notify: (notice: Notice, focusId?: string) => void;
  focus: (id: string) => void;
}

const REMOVE_BUTTON = `${buttonQuiet} !text-red-700 dark:!text-red-400`;

/** One store: what identifies it, how many receipts it has, and what can be done with it. */
export function StoreItem({
  screen,
  item,
  others,
}: {
  screen: ScreenContext;
  item: StoreRow;
  /** The other stores, the ones of the same chain first: the candidates to keep in a merge. */
  others: readonly StoreRow[];
}) {
  const { db, panel, setPanel, notify, focus } = screen;
  const { store, receipts } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const open = panel?.id === store.id ? panel.kind : undefined;

  function ask(kind: Panel['kind']) {
    setError(undefined);
    setPanel({ kind, id: store.id });
  }

  async function rename(name: string) {
    const updated = await renameStore(db, store.id, name);
    setPanel(undefined);
    notify(
      { kind: 'success', text: `Magazinul a fost redenumit „${updated.name}”.` },
      renameButtonId(store.id),
    );
  }

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(undefined);
    try {
      const text = await action();
      setPanel(undefined);
      // The store leaves the list: focus goes to its heading.
      notify({ kind: 'success', text }, listHeadingId);
    } catch (cause) {
      console.warn('The store could not be changed', cause);
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${card} space-y-3`}>
      <div>
        <p className="font-medium break-words">{store.name}</p>
        <p className="text-sm text-slate-600 dark:text-slate-400">{describeStore(store)}</p>
        <p className="text-sm">{receiptsText(receipts)}</p>
      </div>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          id={renameButtonId(store.id)}
          aria-label={`Redenumește magazinul „${store.name}”`}
          className={buttonQuiet}
          onClick={() => {
            ask('rename');
          }}
        >
          Redenumește
        </button>
        {others.length > 0 ? (
          <button
            type="button"
            id={mergeButtonId(store.id)}
            aria-label={`Unește magazinul „${store.name}” cu altul`}
            className={buttonQuiet}
            onClick={() => {
              ask('merge');
            }}
          >
            Unește cu altul
          </button>
        ) : null}
        {receipts === 0 ? (
          <button
            type="button"
            id={deleteButtonId(store.id)}
            aria-label={`Șterge magazinul „${store.name}”`}
            className={REMOVE_BUTTON}
            onClick={() => {
              ask('delete');
            }}
          >
            Șterge
          </button>
        ) : null}
      </div>

      {open === 'rename' ? (
        <RenameForm
          store={store}
          onSubmit={rename}
          onCancel={() => {
            setPanel(undefined);
            focus(renameButtonId(store.id));
          }}
        />
      ) : null}

      {open === 'merge' ? (
        <MergePanel
          item={item}
          others={others}
          busy={busy}
          error={error}
          onConfirm={(keepId) => {
            void run(async () => mergedText(await mergeStores(db, keepId, store.id)));
          }}
          onCancel={() => {
            setPanel(undefined);
            focus(mergeButtonId(store.id));
          }}
        />
      ) : null}

      {open === 'delete' ? (
        <ConfirmPanel
          title={`Ștergi magazinul „${store.name}”?`}
          confirmLabel="Șterge magazinul"
          busy={busy}
          onConfirm={() => {
            void run(async () => {
              await deleteStore(db, store.id);
              return `Magazinul „${store.name}” a fost șters.`;
            });
          }}
          onCancel={() => {
            setPanel(undefined);
            focus(deleteButtonId(store.id));
          }}
        >
          <p>Magazinul nu are niciun bon. Ștergerea nu se poate anula.</p>
          {error ? (
            <p role="alert" className="font-medium">
              {error}
            </p>
          ) : null}
        </ConfirmPanel>
      ) : null}
    </li>
  );
}
