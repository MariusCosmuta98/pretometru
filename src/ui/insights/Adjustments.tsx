import type { SpendingAdjustments } from '@/analytics';
import { formatLei } from '@/domain';
import { formatSignedLei } from './format';

/**
 * What separates the lines of the receipts from what was paid, then the total: the rows that make a
 * list of categories add up. Vouchers used at the till and rounding differences show only when there
 * are any; the total always does.
 */
export function Adjustments({
  adjustments,
  totalBani,
}: {
  adjustments: SpendingAdjustments;
  totalBani: number;
}) {
  const { vouchersBani, roundingBani } = adjustments;
  return (
    <ul
      aria-label="Ajustări și total"
      className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm dark:border-slate-800"
    >
      {vouchersBani === 0 ? null : (
        <li className="flex justify-between gap-3">
          <span>Tichete folosite la plată</span>
          <span className="tabular-nums">{formatSignedLei(vouchersBani)}</span>
        </li>
      )}
      {roundingBani === 0 ? null : (
        <li className="flex justify-between gap-3">
          <span>Rotunjiri și diferențe</span>
          <span className="tabular-nums">{formatSignedLei(roundingBani)}</span>
        </li>
      )}
      <li className="flex justify-between gap-3 font-semibold">
        <span>Total plătit</span>
        <span className="tabular-nums">{formatLei(totalBani)}</span>
      </li>
    </ul>
  );
}
