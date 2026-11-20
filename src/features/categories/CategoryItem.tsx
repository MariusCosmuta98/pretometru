import { useState } from 'react';
import { deleteCategory, moveCategory, updateCategory, type CategoryRow } from '@/admin';
import type { PretometruDB } from '@/storage';
import { buttonQuiet, card } from '@/ui/controls';
import { plural } from '@/ui/plural';
import { CategoryBadge } from './CategoryBadge';
import { CategoryForm, type CategoryValues } from './CategoryForm';
import { DeletePanel } from './DeletePanel';
import { deleteButtonId, editButtonId, listHeadingId, moveButtonId } from './ids';
import { deletedText, errorText } from './messages';

export type Panel = { kind: 'add' } | { kind: 'edit'; id: string } | { kind: 'delete'; id: string };

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

/** One category: its name, what uses it, and what can be done with it. */
export function CategoryItem({
  screen,
  item,
  position,
  orderable,
  targets,
}: {
  screen: ScreenContext;
  item: CategoryRow;
  /** Place among the categories the user can order (0 first); unused for the system category. */
  position: number;
  orderable: number;
  targets: readonly CategoryRow[];
}) {
  const { db, panel, setPanel, notify, focus } = screen;
  const { category, system } = item;
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string>();
  const editing = panel?.kind === 'edit' && panel.id === category.id;
  const deleting = panel?.kind === 'delete' && panel.id === category.id;

  async function save(values: CategoryValues) {
    // The system category keeps its name: only its look can change.
    const updated = await updateCategory(
      db,
      category.id,
      system ? { icon: values.icon, color: values.color } : values,
    );
    setPanel(undefined);
    notify(
      { kind: 'success', text: `Categoria „${updated.name}” a fost salvată.` },
      editButtonId(category.id),
    );
  }

  async function remove(reassignTo: string | undefined) {
    setRemoving(true);
    setRemoveError(undefined);
    try {
      const result = await deleteCategory(db, category.id, reassignTo ? { reassignTo } : {});
      setPanel(undefined);
      notify({ kind: 'success', text: deletedText(result) }, listHeadingId);
    } catch (error) {
      console.warn('The category could not be deleted', error);
      setRemoveError(errorText(error));
    } finally {
      setRemoving(false);
    }
  }

  async function move(direction: 'up' | 'down') {
    try {
      if (!(await moveCategory(db, category.id, direction))) return;
      const to = direction === 'up' ? position - 1 : position + 1;
      // Focus stays on the button just used, unless the category reached the end it was moving to.
      const stays = direction === 'up' ? to > 0 : to < orderable - 1;
      const other = direction === 'up' ? 'down' : 'up';
      notify(
        {
          kind: 'success',
          text: `„${category.name}” este acum pe locul ${to + 1} din ${orderable}.`,
        },
        moveButtonId(category.id, stays ? direction : other),
      );
    } catch (error) {
      notify({ kind: 'error', text: errorText(error) });
    }
  }

  return (
    <li className={`${card} space-y-3`}>
      <div className="flex items-center gap-3">
        <CategoryBadge icon={category.icon} color={category.color} />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{category.name}</p>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {system ? 'Categorie de sistem' : plural(item.products, 'produs', 'produse')}
          </p>
        </div>
      </div>

      {system ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Grupează garanțiile, pungile, reducerile și taxele de pe bonuri, ca totalul să se
          potrivească. Nu poate fi redenumită, mutată sau ștearsă.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-1">
        {system ? null : (
          <>
            <button
              type="button"
              id={moveButtonId(category.id, 'up')}
              aria-label={`Mută „${category.name}” mai sus`}
              className={buttonQuiet}
              disabled={position === 0}
              onClick={() => {
                void move('up');
              }}
            >
              ↑ Mai sus
            </button>
            <button
              type="button"
              id={moveButtonId(category.id, 'down')}
              aria-label={`Mută „${category.name}” mai jos`}
              className={buttonQuiet}
              disabled={position === orderable - 1}
              onClick={() => {
                void move('down');
              }}
            >
              ↓ Mai jos
            </button>
          </>
        )}
        <button
          type="button"
          id={editButtonId(category.id)}
          aria-label={`Editează categoria „${category.name}”`}
          className={buttonQuiet}
          onClick={() => {
            setRemoveError(undefined);
            setPanel({ kind: 'edit', id: category.id });
          }}
        >
          Editează
        </button>
        {system ? null : (
          <button
            type="button"
            id={deleteButtonId(category.id)}
            aria-label={`Șterge categoria „${category.name}”`}
            className={REMOVE_BUTTON}
            onClick={() => {
              setRemoveError(undefined);
              setPanel({ kind: 'delete', id: category.id });
            }}
          >
            Șterge
          </button>
        )}
      </div>

      {editing ? (
        <CategoryForm
          label={`Editează categoria „${category.name}”`}
          initial={{ name: category.name, icon: category.icon, color: category.color }}
          submitLabel="Salvează"
          nameLocked={system}
          onSubmit={save}
          onCancel={() => {
            setPanel(undefined);
            focus(editButtonId(category.id));
          }}
        />
      ) : null}

      {deleting ? (
        <DeletePanel
          item={item}
          targets={targets}
          busy={removing}
          error={removeError}
          onConfirm={(reassignTo) => {
            void remove(reassignTo);
          }}
          onCancel={() => {
            setPanel(undefined);
            focus(deleteButtonId(category.id));
          }}
        />
      ) : null}
    </li>
  );
}
