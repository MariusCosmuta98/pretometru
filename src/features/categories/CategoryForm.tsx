import { useId, useRef, useState, type FormEvent } from 'react';
import { buttonPrimary, buttonQuiet, inputClass, labelClass, noticeClass } from '@/ui/controls';
import { CategoryBadge } from './CategoryBadge';
import { COLOR_CHOICES, errorText, fieldOf, ICON_CHOICES, type Field } from './messages';

export interface CategoryValues {
  name: string;
  icon: string;
  color: string;
}

/**
 * Name, emoji and colour of a category: for a new one and for an edit. `onSubmit` rejects with an
 * `AdminError` when the values are refused; the form says why and puts focus on the field. The
 * system category's name is shown but cannot be changed (`nameLocked`).
 */
export function CategoryForm({
  label,
  initial,
  submitLabel,
  nameLocked = false,
  onSubmit,
  onCancel,
}: {
  /** Names the form for screen readers. */
  label: string;
  initial: CategoryValues;
  submitLabel: string;
  nameLocked?: boolean;
  onSubmit: (values: CategoryValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState(initial);
  const [problem, setProblem] = useState<{ field: Field | undefined; text: string }>();
  const [busy, setBusy] = useState(false);
  const ids = { name: useId(), icon: useId(), color: useId(), error: useId() };
  const nameInput = useRef<HTMLInputElement>(null);
  const iconInput = useRef<HTMLInputElement>(null);
  const colorInput = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(undefined);
    try {
      await onSubmit(values);
    } catch (error) {
      const field = fieldOf(error);
      if (field === undefined) console.warn('The category could not be saved', error);
      setProblem({ field, text: errorText(error) });
      const input = { name: nameInput, icon: iconInput, color: colorInput }[field ?? 'name'];
      if (field) input.current?.focus();
    } finally {
      setBusy(false);
    }
  }

  const invalid = (field: Field) => problem?.field === field;
  const describedBy = (field: Field) => (invalid(field) ? ids.error : undefined);

  return (
    <form
      aria-label={label}
      noValidate
      className="space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700"
      onSubmit={(event) => {
        void submit(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) onCancel();
      }}
    >
      <div>
        <label htmlFor={ids.name} className={labelClass}>
          Nume
        </label>
        <input
          ref={nameInput}
          id={ids.name}
          type="text"
          maxLength={40}
          autoComplete="off"
          autoFocus={!nameLocked}
          value={values.name}
          disabled={nameLocked}
          aria-invalid={invalid('name')}
          aria-describedby={describedBy('name')}
          className={inputClass}
          onChange={(event) => {
            setValues({ ...values, name: event.target.value });
            setProblem(undefined);
          }}
        />
        {nameLocked ? (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Numele acestei categorii nu se poate schimba.
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor={ids.icon} className={labelClass}>
          Emoji
        </label>
        <div className="flex items-center gap-3">
          <input
            ref={iconInput}
            id={ids.icon}
            type="text"
            maxLength={16}
            autoComplete="off"
            autoFocus={nameLocked}
            value={values.icon}
            aria-invalid={invalid('icon')}
            aria-describedby={describedBy('icon')}
            className={`${inputClass} !w-24 text-center text-2xl`}
            onChange={(event) => {
              setValues({ ...values, icon: event.target.value });
              setProblem(undefined);
            }}
          />
          <CategoryBadge icon={values.icon.trim() || '❔'} color={values.color} />
        </div>
        <details className="mt-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm">
            Emoji sugerate
          </summary>
          <div className="flex flex-wrap gap-1">
            {ICON_CHOICES.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Alege emoji ${emoji}`}
                aria-pressed={values.icon === emoji}
                className="size-11 rounded-lg border border-slate-300 text-2xl aria-pressed:border-teal-600 aria-pressed:bg-teal-50 dark:border-slate-600 dark:aria-pressed:bg-teal-950"
                onClick={() => {
                  setValues({ ...values, icon: emoji });
                  setProblem(undefined);
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </details>
      </div>

      <div>
        <label htmlFor={ids.color} className={labelClass}>
          Culoare
        </label>
        <input
          ref={colorInput}
          id={ids.color}
          type="color"
          value={values.color}
          aria-invalid={invalid('color')}
          aria-describedby={describedBy('color')}
          className="h-11 w-20 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-600 dark:bg-slate-950"
          onChange={(event) => {
            setValues({ ...values, color: event.target.value });
            setProblem(undefined);
          }}
        />
        <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Culori sugerate">
          {COLOR_CHOICES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Alege culoarea ${color}`}
              aria-pressed={values.color === color}
              className="size-9 rounded-full border-2 border-white outline-1 outline-slate-300 aria-pressed:outline-2 aria-pressed:outline-slate-900 dark:border-slate-900 dark:outline-slate-600 dark:aria-pressed:outline-white"
              style={{ backgroundColor: color }}
              onClick={() => {
                setValues({ ...values, color });
                setProblem(undefined);
              }}
            />
          ))}
        </div>
      </div>

      {problem ? (
        <p id={ids.error} role="alert" className={noticeClass.error}>
          {problem.text}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary} disabled={busy}>
          {submitLabel}
        </button>
        <button type="button" className={buttonQuiet} disabled={busy} onClick={onCancel}>
          Anulează
        </button>
      </div>
    </form>
  );
}
