import { useId, useState, type FormEvent, type RefObject } from 'react';
import { createList } from '@/lists';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, card, inputClass, labelClass } from '@/ui/controls';

/** Creates a list and opens it, so the first items can go in straight away. */
export function NewListForm({
  db,
  inputRef,
  onCreated,
}: {
  db: PretometruDB;
  /** Owned by the screen, which puts focus back here after it deleted or archived a list. */
  inputRef: RefObject<HTMLInputElement | null>;
  onCreated: (listId: string) => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === '') {
      setError('Scrie un nume pentru listă.');
      inputRef.current?.focus();
      return;
    }
    setError(undefined);
    setBusy(true);
    try {
      onCreated((await createList(db, name)).id);
    } catch {
      setError('Nu am putut crea lista.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate className={`${card} space-y-2`}>
      <label htmlFor={inputId} className={labelClass}>
        Listă nouă
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          className={inputClass}
          placeholder="de ex. Săptămâna asta"
          maxLength={80}
          autoComplete="off"
          value={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
        />
        <button type="submit" className={`${buttonPrimary} shrink-0`} disabled={busy}>
          Creează
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
