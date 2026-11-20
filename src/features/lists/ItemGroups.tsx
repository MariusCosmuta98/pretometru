import { useId } from 'react';
import type { PlannedItem, StoreGroup } from '@/lists';
import type { PretometruDB } from '@/storage';
import { card } from '@/ui/controls';
import type { Direction } from './focus';
import { formatEstimate, formatItems } from './format';
import { ItemRow } from './ItemRow';

export interface RowProps {
  db: PretometruDB;
  windowDays: number;
  excludeSales: boolean;
  /** The item whose editor is open, if any. */
  editing: string | undefined;
  onEdit: (itemId: string | undefined) => void;
  run: (action: Promise<unknown>) => Promise<boolean>;
  onMove: (entry: PlannedItem, direction: Direction, anchor: PlannedItem) => void;
  onRemove: (entry: PlannedItem) => void;
}

/**
 * The rows of `items`, which are the items of one store (or of the whole list) in screen order:
 * the ones still to buy, then the checked ones. An item moves up or down among the neighbours it
 * shares its checked state with; the first and the last cannot move further.
 */
export function ItemRows({ items, ...props }: { items: readonly PlannedItem[] } & RowProps) {
  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {items.map((entry, index) => {
        const before = items[index - 1];
        const after = items[index + 1];
        const previous = before?.item.checked === entry.item.checked ? before : undefined;
        const next = after?.item.checked === entry.item.checked ? after : undefined;
        return (
          <ItemRow
            key={entry.item.id}
            entry={entry}
            db={props.db}
            windowDays={props.windowDays}
            excludeSales={props.excludeSales}
            editing={props.editing === entry.item.id}
            onEdit={(open) => props.onEdit(open ? entry.item.id : undefined)}
            run={props.run}
            canMoveUp={previous !== undefined}
            canMoveDown={next !== undefined}
            onMove={(direction) => {
              const anchor = direction === 'up' ? previous : next;
              if (anchor) props.onMove(entry, direction, anchor);
            }}
            onRemove={() => props.onRemove(entry)}
          />
        );
      })}
    </ul>
  );
}

/** The items to buy at one store with an estimated subtotal; the group without a store says why it has none. */
export function StoreSection({ group, ...props }: { group: StoreGroup } & RowProps) {
  const headingId = useId();
  const { store, items } = group;

  return (
    <section aria-labelledby={headingId} className={card}>
      <h3 id={headingId} className="break-words text-base font-semibold">
        {store?.name ?? 'Fără magazin'}
      </h3>
      <p className="mb-1 text-sm text-slate-600 dark:text-slate-400">
        {store ? (
          <>
            {formatItems(items.length)} · <strong>{formatEstimate(group.estimateBani)}</strong>
            {group.unestimated > 0 &&
              ` · ${formatItems(group.unestimated)} fără estimare (unitatea nu se potrivește cu prețul)`}
          </>
        ) : (
          `${formatItems(items.length)} · nu știm încă unde sunt mai ieftine`
        )}
      </p>
      <ItemRows items={items} {...props} />
    </section>
  );
}
