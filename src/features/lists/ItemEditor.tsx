import { useId, useRef, useState, type FormEvent } from 'react';
import { QTY_UNITS, type QtyUnit } from '@/domain';
import { updateItem, type ItemPatch, type PlannedItem } from '@/lists';
import type { PretometruDB } from '@/storage';
import { buttonPrimary, buttonQuiet, buttonSecondary, inputClass, labelClass } from '@/ui/controls';
import { moveButtonId, type Direction } from './focus';
import { parseQuantityInput } from './format';

const QUANTITY_ERROR = 'Cantitatea e un număr pozitiv, cu cel mult 3 zecimale (de ex. 2 sau 1,5).';

/**
 * Edits one item in place: quantity, unit and note (and the name of a free-text item), moves it up
 * or down among its neighbours, removes it. Escape closes it without saving.
 */
export function ItemEditor({
  entry,
  db,
  run,
  onClose,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  entry: PlannedItem;
  db: PretometruDB;
  /** Runs a write; resolves `true` when it went through (the screen shows the failure otherwise). */
  run: (action: Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { item, product, name } = entry;
  const [label, setLabel] = useState(item.label);
  const [qty, setQty] = useState(item.qty === undefined ? '' : String(item.qty).replace('.', ','));
  const [unit, setUnit] = useState<QtyUnit | ''>(item.unit ?? '');
  const [note, setNote] = useState(item.note ?? '');
  const [errors, setErrors] = useState<{ label?: string; qty?: string }>({});
  const ids = { label: useId(), qty: useId(), unit: useId(), note: useId(), error: useId() };
  const labelField = useRef<HTMLInputElement>(null);
  const qtyField = useRef<HTMLInputElement>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseQuantityInput(qty);
    const next: typeof errors = {};
    if (!product && label.trim() === '') next.label = 'Scrie denumirea articolului.';
    if (parsed === null) next.qty = QUANTITY_ERROR;
    if (next.label || next.qty || parsed === null) {
      setErrors(next);
      (next.label ? labelField : qtyField).current?.focus();
      return;
    }

    const patch: ItemPatch = { qty: parsed, unit: unit === '' ? undefined : unit, note };
    if (!product) patch.label = label;
    if (await run(updateItem(db, item.id, patch))) onClose();
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      noValidate
      aria-label={`Editează ${name}`}
      className="mb-2 ml-9 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
    >
      {!product && (
        <div>
          <label htmlFor={ids.label} className={labelClass}>
            Denumire
          </label>
          <input
            id={ids.label}
            ref={labelField}
            type="text"
            className={inputClass}
            autoComplete="off"
            maxLength={120}
            value={label}
            aria-invalid={errors.label ? true : undefined}
            aria-describedby={errors.label ? ids.error : undefined}
            onChange={(event) => setLabel(event.target.value)}
          />
          {errors.label && (
            <p id={ids.error} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
              {errors.label}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={ids.qty} className={labelClass}>
            Cantitate
          </label>
          <input
            id={ids.qty}
            ref={qtyField}
            type="text"
            inputMode="decimal"
            className={inputClass}
            autoComplete="off"
            placeholder="1"
            value={qty}
            aria-invalid={errors.qty ? true : undefined}
            aria-describedby={errors.qty ? `${ids.error}-qty` : undefined}
            onChange={(event) => setQty(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={ids.unit} className={labelClass}>
            Unitate
          </label>
          <select
            id={ids.unit}
            className={inputClass}
            value={unit}
            onChange={(event) => setUnit(event.target.value as QtyUnit | '')}
          >
            <option value="">—</option>
            {QTY_UNITS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      {errors.qty && (
        <p
          id={`${ids.error}-qty`}
          role="alert"
          className="-mt-1 text-sm text-red-700 dark:text-red-400"
        >
          {errors.qty}
        </p>
      )}

      <div>
        <label htmlFor={ids.note} className={labelClass}>
          Notă
        </label>
        <input
          id={ids.note}
          type="text"
          className={inputClass}
          autoComplete="off"
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className={buttonPrimary}>
          Salvează
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Anulează
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-t border-slate-200 pt-2 dark:border-slate-700">
        <button
          type="button"
          id={moveButtonId(item.id, 'up')}
          className={buttonQuiet}
          disabled={!canMoveUp}
          onClick={() => onMove('up')}
        >
          Mută mai sus
        </button>
        <button
          type="button"
          id={moveButtonId(item.id, 'down')}
          className={buttonQuiet}
          disabled={!canMoveDown}
          onClick={() => onMove('down')}
        >
          Mută mai jos
        </button>
        <button
          type="button"
          className={`${buttonQuiet} text-red-700! dark:text-red-400!`}
          onClick={onRemove}
        >
          Șterge articolul
        </button>
      </div>
    </form>
  );
}
