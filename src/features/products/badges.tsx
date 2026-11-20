import type { PriceChange, PriceObservation } from '@/analytics';
import type { BaseUnit } from '@/domain';
import { formatPackPrice, formatPercent, formatUnitPrice } from './format';

const TONES = {
  up: 'text-red-700 dark:text-red-400',
  down: 'text-green-700 dark:text-green-400',
  flat: 'text-slate-500 dark:text-slate-400',
} as const;

const ARROWS = { up: '↑', down: '↓', flat: '→' } as const;

const MEANING = {
  up: 'Prețul a crescut',
  down: 'Prețul a scăzut',
  flat: 'Prețul nu s-a schimbat',
} as const;

/** Δ: the latest price against the previous purchase at the same store (red = dearer, green = cheaper). */
export function ChangeBadge({ change }: { change: PriceChange }) {
  return (
    <span
      className={`whitespace-nowrap font-medium tabular-nums ${TONES[change.direction]}`}
      title={`${MEANING[change.direction]} față de achiziția anterioară din același magazin`}
    >
      <span aria-hidden="true">{ARROWS[change.direction]}</span>{' '}
      <span className="sr-only">{MEANING[change.direction]}: </span>
      {formatPercent(change.pct)}
    </span>
  );
}

/** Marks a sale price (the line carried a discount). */
export function SaleTag() {
  return (
    <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      reducere
    </span>
  );
}

/** The price per base unit, with the shelf price of the pack when that helps (`0,0583 lei/buc (6,99 lei / 120 buc)`). */
export function UnitPrice({
  observation,
  baseUnit,
}: {
  observation: PriceObservation;
  baseUnit: BaseUnit;
}) {
  const pack = formatPackPrice(observation);
  return (
    <>
      <strong>{formatUnitPrice(observation.pricePerBaseMilliBani, baseUnit)}</strong>
      {pack && <span className="font-normal"> ({pack})</span>}
    </>
  );
}
