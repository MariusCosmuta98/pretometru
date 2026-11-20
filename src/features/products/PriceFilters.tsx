import { useState } from 'react';
import { setSetting, type PretometruDB } from '@/storage';
import { field } from './styles';

const WINDOWS = [30, 60, 90, 180, 365];

/**
 * The two comparison settings of plan §7.4, stored as settings (so every product screen follows):
 * how many days "cel mai ieftin" looks back, and whether sale prices take part.
 */
export function PriceFilters({
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
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <label className="flex items-center gap-2">
        <span>Perioadă de comparație</span>
        <select
          className={`${field} w-auto`}
          value={windowDays}
          onChange={(event) => save(setSetting(db, 'priceWindowDays', Number(event.target.value)))}
        >
          {options.map((days) => (
            <option key={days} value={days}>
              {days} de zile
            </option>
          ))}
        </select>
      </label>
      <label className="flex min-h-10 items-center gap-2">
        <input
          type="checkbox"
          className="size-4 accent-teal-700"
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
  );
}
