import { useId, useRef, useState, type FormEvent } from 'react';
import type { Store } from '@/domain';
import { buttonPrimary, buttonQuiet, inputClass, labelClass, noticeClass } from '@/ui/controls';
import { errorText } from './messages';

/** The new name of a store. `onSubmit` rejects with an `AdminError` when the name is refused. */
export function RenameForm({
  store,
  onSubmit,
  onCancel,
}: {
  store: Store;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(store.name);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(name);
    } catch (cause) {
      setError(errorText(cause));
      input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label={`Redenumește magazinul „${store.name}”`}
      noValidate
      className="space-y-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
      onSubmit={(event) => {
        void submit(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <div>
        <label htmlFor={fieldId} className={labelClass}>
          Numele magazinului
        </label>
        <input
          ref={input}
          id={fieldId}
          type="text"
          maxLength={80}
          autoComplete="off"
          autoFocus
          value={name}
          aria-invalid={error !== undefined}
          aria-describedby={error ? errorId : undefined}
          className={inputClass}
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
        />
        {store.chain !== 'unknown' ? (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Se schimbă doar numele afișat: bonurile următoare ale aceluiași lanț, unități și oraș
            ajung tot aici.
          </p>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className={noticeClass.error}>
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={busy}>
          Salvează
        </button>
        <button type="button" className={buttonQuiet} disabled={busy} onClick={onCancel}>
          Anulează
        </button>
      </div>
    </form>
  );
}
