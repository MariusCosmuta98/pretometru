import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { archiveList, deleteList, renameList, restoreList, type ListSummary } from '@/lists';
import type { PretometruDB } from '@/storage';
import {
  buttonPrimary,
  buttonQuiet,
  buttonSecondary,
  card,
  inputClass,
  labelClass,
} from '@/ui/controls';
import { ConfirmBar } from './ConfirmBar';
import { formatItems } from './format';

type Mode = 'view' | 'rename' | 'delete';

function RenameForm({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(name);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (text.trim() === '') input.current?.focus();
    else onSave(text);
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <label htmlFor={inputId} className={labelClass}>
        Numele listei
      </label>
      <input
        id={inputId}
        ref={input}
        type="text"
        className={inputClass}
        maxLength={80}
        autoComplete="off"
        value={text}
        aria-invalid={text.trim() === '' ? true : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex gap-2">
        <button type="submit" className={buttonPrimary}>
          Salvează
        </button>
        <button type="button" className={buttonSecondary} onClick={onCancel}>
          Anulează
        </button>
      </div>
    </form>
  );
}

/** One list of the overview: where it goes (open, rename, archive or restore, delete) and how far along it is. */
export function ListCard({
  summary,
  db,
  announce,
}: {
  summary: ListSummary;
  db: PretometruDB;
  /**
   * Says what happened in the screen's status line (the card may be gone by then). `leaves` is set
   * when the card leaves its place (archived, restored, deleted) and focus has to go elsewhere.
   */
  announce: (message: string, leaves: boolean) => void;
}) {
  const { list, itemCount, checkedCount } = summary;
  const archived = list.archivedAt !== undefined;
  const [mode, setMode] = useState<Mode>('view');
  const [problem, setProblem] = useState<string>();
  const renameButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<'rename' | 'delete'>(undefined);

  // Leaving the rename form or the question without a change puts focus back on the button that opened it.
  useEffect(() => {
    if (mode !== 'view' || !returnTo.current) return;
    (returnTo.current === 'rename' ? renameButton : deleteButton).current?.focus();
    returnTo.current = undefined;
  }, [mode]);

  const back = (from: 'rename' | 'delete') => {
    returnTo.current = from;
    setMode('view');
  };

  async function run(action: () => Promise<unknown>, message: string, leaves: boolean) {
    setProblem(undefined);
    try {
      await action();
      announce(message, leaves);
    } catch {
      setProblem('Nu am putut salva modificarea.');
    }
  }

  const progress =
    itemCount === 0 ? 'Listă goală' : `${checkedCount} din ${formatItems(itemCount)} bifate`;

  return (
    <li className={`${card} space-y-2`}>
      {mode === 'rename' ? (
        <RenameForm
          name={list.name}
          onCancel={() => back('rename')}
          onSave={(name) => {
            back('rename');
            void run(
              () => renameList(db, list.id, name),
              `Lista a fost redenumită „${name.trim()}”.`,
              false,
            );
          }}
        />
      ) : (
        <Link
          to={`/liste/${list.id}`}
          className="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          <span className="block break-words font-medium">{list.name}</span>
          <span className="block text-sm text-slate-600 dark:text-slate-400">{progress}</span>
        </Link>
      )}

      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}

      {mode === 'delete' && (
        <ConfirmBar
          message={
            itemCount === 0
              ? `Ștergi lista „${list.name}”?`
              : `Ștergi lista „${list.name}” și ${formatItems(itemCount)}? Nu se poate anula.`
          }
          confirmLabel="Șterge lista"
          onCancel={() => back('delete')}
          onConfirm={() =>
            void run(() => deleteList(db, list.id), `Lista „${list.name}” a fost ștearsă.`, true)
          }
        />
      )}

      {mode === 'view' && (
        <div className="flex flex-wrap gap-1">
          {archived ? (
            <button
              type="button"
              className={buttonQuiet}
              aria-label={`Restaurează lista „${list.name}”`}
              onClick={() =>
                void run(
                  () => restoreList(db, list.id),
                  `Lista „${list.name}” a fost restaurată.`,
                  true,
                )
              }
            >
              Restaurează
            </button>
          ) : (
            <>
              <button
                type="button"
                ref={renameButton}
                className={buttonQuiet}
                aria-label={`Redenumește lista „${list.name}”`}
                onClick={() => setMode('rename')}
              >
                Redenumește
              </button>
              <button
                type="button"
                className={buttonQuiet}
                aria-label={`Arhivează lista „${list.name}”`}
                onClick={() =>
                  void run(
                    () => archiveList(db, list.id),
                    `Lista „${list.name}” a fost arhivată.`,
                    true,
                  )
                }
              >
                Arhivează
              </button>
            </>
          )}
          <button
            type="button"
            ref={deleteButton}
            className={buttonQuiet}
            aria-label={`Șterge lista „${list.name}”`}
            onClick={() => setMode('delete')}
          >
            Șterge
          </button>
        </div>
      )}
    </li>
  );
}
