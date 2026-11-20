import { useId, useState } from 'react';
import type { CategoryRow } from '@/admin';
import { inputClass, labelClass, noticeClass } from '@/ui/controls';
import { ConfirmPanel } from '@/ui/ConfirmPanel';
import { usageText } from './messages';

/**
 * The question before a category is deleted. While products or receipt lines use it, the user has to
 * choose the category they move to (nothing is preselected, so it is a decision); a category nothing
 * uses just asks for a confirmation.
 */
export function DeletePanel({
  item,
  targets,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  item: CategoryRow;
  /** The categories that can receive the products and lines. */
  targets: readonly CategoryRow[];
  busy: boolean;
  error: string | undefined;
  onConfirm: (reassignTo: string | undefined) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState('');
  const selectId = useId();
  const used = item.products + item.lines > 0;

  return (
    <ConfirmPanel
      title={`Ștergi categoria „${item.category.name}”?`}
      confirmLabel={used ? 'Șterge și mută' : 'Șterge categoria'}
      canConfirm={!used || target !== ''}
      busy={busy}
      onConfirm={() => {
        onConfirm(used ? target : undefined);
      }}
      onCancel={onCancel}
    >
      {used ? (
        <>
          <p>{usageText(item.products, item.lines)} Ele se mută în categoria pe care o alegi.</p>
          <div>
            <label htmlFor={selectId} className={labelClass}>
              Mută în
            </label>
            <select
              id={selectId}
              data-autofocus
              required
              value={target}
              disabled={busy}
              className={inputClass}
              onChange={(event) => {
                setTarget(event.target.value);
              }}
            >
              <option value="">Alege categoria…</option>
              {targets.map(({ category }) => (
                <option key={category.id} value={category.id}>
                  {category.icon} {category.name}
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <p>Nimic nu folosește această categorie.</p>
      )}
      <p className="text-sm">Ștergerea nu se poate anula.</p>
      {error ? (
        <p role="alert" className={noticeClass.error}>
          {error}
        </p>
      ) : null}
    </ConfirmPanel>
  );
}
