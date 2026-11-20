import { useEffect, useRef } from 'react';
import { hasStore, setItemChecked, type PlannedItem } from '@/lists';
import type { PretometruDB } from '@/storage';
import { buttonQuiet } from '@/ui/controls';
import type { Direction } from './focus';
import { formatEstimate, formatQuantity } from './format';
import { ItemEditor } from './ItemEditor';
import { PriceLine } from './PriceLine';

/**
 * One item of the list: a checkbox with its name and quantity, where it is cheapest (store, price
 * per base unit, date), the estimated cost, and an "Editează" button that opens the editor below.
 */
export function ItemRow({
  entry,
  db,
  windowDays,
  excludeSales,
  editing,
  onEdit,
  run,
  onMove,
  onRemove,
  canMoveUp,
  canMoveDown,
}: {
  entry: PlannedItem;
  db: PretometruDB;
  windowDays: number;
  excludeSales: boolean;
  editing: boolean;
  /** Opens this item's editor, or closes it (`false`). */
  onEdit: (open: boolean) => void;
  run: (action: Promise<unknown>) => Promise<boolean>;
  onMove: (direction: Direction) => void;
  onRemove: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const { item, name, product, quote } = entry;
  const quantity = formatQuantity(item.qty, item.unit);
  const estimate = hasStore(quote) ? quote.estimateBani : undefined;
  const detailId = `detail-${item.id}`;
  const editorId = `editor-${item.id}`;

  const toggle = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  // Closing the editor from its own buttons puts focus back on "Editează"; opening another item's
  // editor must not take it from there.
  useEffect(() => {
    if (editing || !returnFocus.current) return;
    returnFocus.current = false;
    toggle.current?.focus();
  }, [editing]);

  const close = () => {
    returnFocus.current = true;
    onEdit(false);
  };

  return (
    <li className="py-1">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
            <input
              type="checkbox"
              className="mt-0.5 size-6 shrink-0 accent-teal-700"
              checked={item.checked}
              aria-describedby={detailId}
              onChange={(event) => void run(setItemChecked(db, item.id, event.target.checked))}
            />
            <span className={item.checked ? 'text-slate-500 line-through dark:text-slate-400' : ''}>
              <span className="break-words font-medium">{name}</span>
              {product?.brand && (
                <span className="text-slate-600 dark:text-slate-400"> · {product.brand}</span>
              )}
              {quantity && (
                <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-sm dark:bg-slate-800">
                  {quantity}
                </span>
              )}
            </span>
          </label>
          <div
            id={detailId}
            className="ml-9 space-y-0.5 text-sm text-slate-600 dark:text-slate-400"
          >
            <PriceLine quote={quote} windowDays={windowDays} excludeSales={excludeSales} />
            {item.note && <p>Notă: {item.note}</p>}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end">
          {estimate !== undefined && (
            <span className="pt-2 text-sm font-medium tabular-nums">
              {formatEstimate(estimate)}
            </span>
          )}
          <button
            type="button"
            ref={toggle}
            className={buttonQuiet}
            aria-expanded={editing}
            aria-controls={editing ? editorId : undefined}
            aria-label={`Editează ${name}`}
            onClick={() => (editing ? close() : onEdit(true))}
          >
            Editează
          </button>
        </div>
      </div>

      {editing && (
        <div id={editorId}>
          <ItemEditor
            entry={entry}
            db={db}
            run={run}
            onClose={close}
            onMove={onMove}
            onRemove={onRemove}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
          />
        </div>
      )}
    </li>
  );
}
