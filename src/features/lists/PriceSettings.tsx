import { useState } from 'react';
import { setSetting, type PretometruDB } from '@/storage';
import { inputClass } from '@/ui/controls';
import { formatDays } from './format';

const WINDOWS = [30, 60, 90, 180, 365];

/**
 * The two comparison settings of plan §7.4 that decide where each item is cheapest, shared with the
 * product screens: how many days "cel mai ieftin" looks back, and whether sale prices take part.
 * Collapsed to one line that says what is in force.
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
    action.catch(() => setFailed(true));
  };

  return (
    <details className="rounded-xl border border-slate-200 bg-white px-4 py-1 dark:border-slate-800 dark:bg-slate-900">
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600">
        Prețuri din ultimele {formatDays(windowDays)}, {excludeSales ? 'fără' : 'cu'} reduceri
      </summary>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pb-3 text-sm">
        <label className="flex items-center gap-2">
          <span>Perioadă de comparație</span>
          <select
            className={`${inputClass} w-auto!`}
            value={windowDays}
            onChange={(event) =>
              save(setSetting(db, 'priceWindowDays', Number(event.target.value)))
            }
          >
            {options.map((days) => (
              <option key={days} value={days}>
                {formatDays(days)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-teal-700"
            checked={excludeSales}
            onChange={(event) =>
              save(setSetting(db, 'excludeDiscountedPrices', event.target.checked))
            }
          />
          <span>Fără prețuri la reducere</span>
        </label>
        {failed && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            Nu am putut salva setarea.
          </p>
        )}
      </div>
    </details>
  );
}
