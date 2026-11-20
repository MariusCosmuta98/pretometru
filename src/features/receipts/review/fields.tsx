import { useState } from 'react';
import { inputClass, labelClass } from '@/ui/controls';

interface BaseFieldProps {
  id: string;
  label: string;
  /** Read by screen readers only: "Cantitate" + ", linia 3". */
  suffix?: string;
  error?: string | undefined;
  /** Show the error even if the field was not visited yet (after a failed save). */
  showError?: boolean;
  hint?: string;
  className?: string;
}

function Label({ id, label, suffix }: Pick<BaseFieldProps, 'id' | 'label' | 'suffix'>) {
  return (
    <label htmlFor={id} className={labelClass}>
      {label}
      {suffix ? <span className="sr-only">{suffix}</span> : null}
    </label>
  );
}

interface TextFieldProps extends BaseFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Canonical form of a valid value, applied when the user leaves the field. */
  normalize?: (value: string) => string;
  type?: 'text' | 'date' | 'time' | 'search';
  inputMode?: 'text' | 'decimal' | 'numeric';
  autoComplete?: string;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * A labelled text input. Errors appear once the user has left the field (or the screen asks for
 * them), so half-typed numbers are not shouted at.
 */
export function TextField({
  id,
  label,
  suffix,
  error,
  showError,
  hint,
  className,
  value,
  onChange,
  normalize,
  type = 'text',
  inputMode,
  autoComplete = 'off',
  step,
  placeholder,
  disabled,
}: TextFieldProps) {
  const [visited, setVisited] = useState(false);
  const message = error !== undefined && (visited || showError === true) ? error : undefined;
  const describedBy = [hint ? `${id}-hint` : undefined, message ? `${id}-error` : undefined]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className}>
      <Label id={id} label={label} suffix={suffix} />
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoComplete={autoComplete}
        step={step}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={message ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={() => {
          setVisited(true);
          const canonical = normalize?.(value);
          if (canonical !== undefined && canonical !== value) onChange(canonical);
        }}
        className={inputClass}
      />
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </p>
      ) : null}
      {message ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-red-700 dark:text-red-300">
          {message}
        </p>
      ) : null}
    </div>
  );
}

interface SelectFieldProps<T extends string> extends BaseFieldProps {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
}

export function SelectField<T extends string>({
  id,
  label,
  suffix,
  className,
  value,
  onChange,
  options,
  disabled,
}: SelectFieldProps<T>) {
  return (
    <div className={className}>
      <Label id={id} label={label} suffix={suffix} />
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value as T);
        }}
        className={inputClass}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
