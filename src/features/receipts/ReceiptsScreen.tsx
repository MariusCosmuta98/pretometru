import { useState } from 'react';
import { Link, useLoaderData, useLocation } from 'react-router';
import type { ReceiptStatus } from '@/domain';
import { formatLei } from '@/domain';
import { buttonPrimary, card, inputClass, labelClass, noticeClass } from '@/ui/controls';
import { formatMonth, formatPurchasedAt, SOURCE_LABELS, STATUS_LABELS } from './labels';
import type { ReceiptRow, ReceiptsData } from './receiptsLoader';

type StatusFilter = 'all' | ReceiptStatus;

const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Toate' },
  { value: 'draft', label: 'Ciorne' },
  { value: 'confirmed', label: 'Confirmate' },
];

const STATUS_BADGE: Record<ReceiptStatus, string> = {
  draft: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
};

function ReceiptItem({ row }: { row: ReceiptRow }) {
  return (
    <li>
      <Link
        to={`/bonuri/${row.id}`}
        className={`${card} flex items-center justify-between gap-3 hover:border-teal-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600`}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{row.storeName}</span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[row.status]}`}
            >
              {STATUS_LABELS[row.status]}
            </span>
          </span>
          <span className="mt-0.5 block text-sm text-slate-600 dark:text-slate-400">
            {formatPurchasedAt(row.purchasedAt)} · {SOURCE_LABELS[row.source]}
          </span>
        </span>
        <span className="shrink-0 text-right font-semibold tabular-nums">
          {formatLei(row.totalBani)}
        </span>
      </Link>
    </li>
  );
}

export function Component() {
  const data = useLoaderData<ReceiptsData>();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [status, setStatus] = useState<StatusFilter>('all');
  const [storeId, setStoreId] = useState('');
  const [month, setMonth] = useState('');

  if (data.status === 'error') {
    return (
      <section role="alert" className={noticeClass.error}>
        <p className="font-medium">Nu am putut deschide bonurile salvate.</p>
        <p className="mt-1 break-words opacity-80">{data.detail}</p>
      </section>
    );
  }

  const { rows } = data;
  if (rows.length === 0) {
    return (
      <section className={`${card} space-y-3 text-center`}>
        {notice ? (
          <p role="status" className={noticeClass.success}>
            {notice}
          </p>
        ) : null}
        <p className="text-slate-700 dark:text-slate-300">Nu ai niciun bon salvat încă.</p>
        <Link to="/adauga" className={buttonPrimary}>
          Adaugă primul bon
        </Link>
      </section>
    );
  }

  const stores = [...new Map(rows.map((row) => [row.storeId, row.storeName])).entries()].sort(
    (a, b) => a[1].localeCompare(b[1], 'ro'),
  );
  const months = [
    ...new Set(rows.flatMap((row) => (row.purchasedAt ? [row.purchasedAt.slice(0, 7)] : []))),
  ].sort((a, b) => b.localeCompare(a));

  const visible = rows.filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      (storeId === '' || row.storeId === storeId) &&
      (month === '' || row.purchasedAt?.startsWith(month) === true),
  );
  const drafts = rows.filter((row) => row.status === 'draft').length;

  return (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className={noticeClass.success}>
          {notice}
        </p>
      ) : null}
      {drafts > 0 ? (
        <p className={noticeClass.warning}>
          {drafts === 1 ? 'Ai o ciornă de verificat.' : `Ai ${drafts} ciorne de verificat.`}{' '}
          Confirmă-le ca să intre în comparațiile de prețuri.
        </p>
      ) : null}

      <section aria-labelledby="receipt-filters" className={`${card} space-y-3`}>
        <h2 id="receipt-filters" className="sr-only">
          Filtre
        </h2>
        <div role="group" aria-label="Stare" className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => {
                setStatus(filter.value);
              }}
              className={`min-h-11 rounded-full border px-4 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600 ${
                status === filter.value
                  ? 'border-teal-700 bg-teal-700 text-white'
                  : 'border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="filter-store" className={labelClass}>
              Magazin
            </label>
            <select
              id="filter-store"
              value={storeId}
              onChange={(event) => {
                setStoreId(event.target.value);
              }}
              className={inputClass}
            >
              <option value="">Toate magazinele</option>
              {stores.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-month" className={labelClass}>
              Luna
            </label>
            <select
              id="filter-month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
              }}
              className={inputClass}
            >
              <option value="">Toate lunile</option>
              {months.map((value) => (
                <option key={value} value={value}>
                  {formatMonth(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <p role="status" className="text-sm text-slate-600 dark:text-slate-400">
        {visible.length === 1 ? '1 bon' : `${visible.length} bonuri`}
      </p>
      {visible.length === 0 ? (
        <p className={noticeClass.info}>Niciun bon nu se potrivește filtrelor alese.</p>
      ) : (
        <ul className="space-y-2" aria-label="Bonuri">
          {visible.map((row) => (
            <ReceiptItem key={row.id} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
