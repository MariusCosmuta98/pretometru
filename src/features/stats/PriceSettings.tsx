import { useState } from 'react';
import { setSetting, type PretometruDB } from '@/storage';
import { formatCount } from '@/ui/insights/format';

const WINDOWS = [30, 60, 90, 180, 365];

const select =
  'min-h-10 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 ' +
  'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-teal-700 ' +
  'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

/**
 * The two comparison settings of plan §7.4, stored as settings, so the product screens and Home
 * follow: how many days a price increase may have been seen ago, and whether sale prices take part.
 */
export function PriceSettings({
  db,
  windowDays,
  excludeSales,
}: {
  db: PretometruDB;
  windowDays: number;
  excludeSales: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const options = [...new Set([...WINDOWS, windowDays])].sort((a, b) => a - b);

  const save = (action: Promise<void>) => {
    setFailed(false);
    action.catch(() => {
      setFailed(true);
    });
  };

  return (
    <div className="my-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <span>Perioadă de comparație</span>
        <select
          className={select}
          value={windowDays}
          onChange={(event) => {
            save(setSetting(db, 'priceWindowDays', Number(event.target.value)));
          }}
        >
          {options.map((days) => (
            <option key={days} value={days}>
              {formatCount(days, 'zi', 'zile')}
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-teal-700"
          checked={excludeSales}
          onChange={(event) => {
            save(setSetting(db, 'excludeDiscountedPrices', event.target.checked));
          }}
        />
        <span>Fără prețuri la reducere</span>
      </label>
      {failed ? (
        <p role="alert" className="text-red-700 dark:text-red-400">
          Nu am putut salva setarea.
        </p>
      ) : null}
    </div>
  );
}
