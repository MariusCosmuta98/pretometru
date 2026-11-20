import { useId, useState } from 'react';
import type { StoreRow } from '@/admin';
import { inputClass, labelClass, noticeClass } from '@/ui/controls';
import { ConfirmPanel } from '@/ui/ConfirmPanel';
import { plural } from '@/ui/plural';
import { describeStore, receiptsText } from './messages';

/**
 * Folding a duplicate store into the one that stays. Nothing is preselected: the user picks the store
 * to keep, and the question says what moves and what is deleted.
 */
export function MergePanel({
  item,
  others,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  item: StoreRow;
  /** The stores that can be kept, the ones of the same chain first. */
  others: readonly StoreRow[];
  busy: boolean;
  error: string | undefined;
  onConfirm: (keepId: string) => void;
  onCancel: () => void;
}) {
  const [keep, setKeep] = useState('');
  const selectId = useId();
  const { name } = item.store;

  return (
    <ConfirmPanel
      title={`Unești „${name}” cu alt magazin?`}
      confirmLabel="Unește magazinele"
      canConfirm={keep !== ''}
      busy={busy}
      onConfirm={() => {
        onConfirm(keep);
      }}
      onCancel={onCancel}
    >
      <p>
        {item.receipts === 0
          ? `„${name}” nu are bonuri; se șterge.`
          : `Bonurile magazinului „${name}” (${plural(item.receipts, 'bon', 'bonuri')}) trec la magazinul pe care îl păstrezi, iar „${name}” se șterge.`}{' '}
        Nu se poate anula.
      </p>
      <div>
        <label htmlFor={selectId} className={labelClass}>
          Păstrează magazinul
        </label>
        <select
          id={selectId}
          data-autofocus
          required
          value={keep}
          disabled={busy}
          className={inputClass}
          onChange={(event) => {
            setKeep(event.target.value);
          }}
        >
          <option value="">Alege magazinul…</option>
          {others.map(({ store, receipts }) => (
            <option key={store.id} value={store.id}>
              {store.name} ({describeStore(store)}; {receiptsText(receipts).toLowerCase()})
            </option>
          ))}
        </select>
      </div>
      {error ? (
        <p role="alert" className={noticeClass.error}>
          {error}
        </p>
      ) : null}
    </ConfirmPanel>
  );
}
