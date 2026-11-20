import { Link } from 'react-router';
import type { RecentReceipts } from '@/analytics';
import { formatLei } from '@/domain';
import { card } from '@/ui/controls';
import { formatDay } from '@/ui/insights/format';

const muted = 'text-sm text-slate-600 dark:text-slate-400';

/** The newest receipts, each a link to its review; drafts are marked, a future date shows as it is. */
export function RecentCard({ recent }: { recent: RecentReceipts }) {
  return (
    <section aria-labelledby="home-recent" className={card}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 id="home-recent" className="text-base font-semibold">
          Ultimele bonuri
        </h2>
        <Link
          to="/bonuri"
          className="rounded text-sm font-medium text-teal-800 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 dark:text-teal-300"
        >
          Toate bonurile
        </Link>
      </div>
      <ul aria-label="Ultimele bonuri" className="divide-y divide-slate-100 dark:divide-slate-800">
        {recent.items.map((receipt) => (
          <li key={receipt.id}>
            <Link
              to={`/bonuri/${receipt.id}`}
              className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-700 dark:hover:bg-slate-800"
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{receipt.storeName}</span>
                  {receipt.status === 'draft' ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Ciornă
                    </span>
                  ) : null}
                </span>
                <span className={`${muted} block`}>
                  {receipt.purchasedAt ? formatDay(receipt.purchasedAt) : 'Fără dată'}
                  {receipt.paidBani === receipt.totalBani
                    ? null
                    : ` · plătit ${formatLei(receipt.paidBani)}`}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatLei(receipt.totalBani)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
