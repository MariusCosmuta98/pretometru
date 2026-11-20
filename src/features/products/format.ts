import type { PriceObservation } from '@/analytics';
import { formatLei, formatMilliBani, toMilliBase, type BaseUnit, type PackUnit } from '@/domain';

const UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  l: 'l',
  buc: 'buc',
  role: 'rolă',
  m: 'm',
};

export const unitLabel = (unit: BaseUnit): string => UNIT_LABELS[unit];

/** What was paid for one sold unit, as the receipt shows it: `3,98 lei`, `24,99 lei/kg`. */
export function paidEach(observation: PriceObservation): string {
  const price = formatLei(observation.paidUnitBani);
  return observation.unit === 'buc' ? price : `${price}/${observation.unit}`;
}

/**
 * The shelf price of a sold pack, `6,99 lei / 120 buc`, for the cases where the price per base
 * unit alone is hard to picture (a wipe costs 0,0583 lei). Nothing when the line has no pack, is
 * weighed, or the pack is exactly one base unit (then it equals the unit price).
 */
export function formatPackPrice(observation: PriceObservation): string | undefined {
  const { unit, pack } = observation;
  if (unit !== 'buc' || !pack || toMilliBase(pack.qty, pack.unit) === 1000) return undefined;
  return `${formatLei(observation.paidUnitBani)} / ${formatPack(pack)}`;
}

/** `1,30 lei/rolă`: two decimals from one leu up, more for cheap pieces (`0,033 lei/buc`). */
export function formatUnitPrice(milliBani: number, unit: BaseUnit): string {
  const decimals = milliBani >= 100_000 ? 2 : milliBani >= 10_000 ? 3 : 4;
  return `${formatMilliBani(milliBani, decimals)} lei/${unitLabel(unit)}`;
}

/** `2026-11-07` -> `07.11.2026`. */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

/** `+7,5%`, `−3,2%` (typographic minus), `0,0%`. */
export function formatPercent(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '−' : '';
  return `${sign}${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
}

/** How the best price in the window compares with the last price paid; nothing when they are equal. */
export function formatVersusLast(pct: number): string | undefined {
  if (pct === 0) return undefined;
  const size = `${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
  return `cu ${size} ${pct < 0 ? 'mai ieftin' : 'mai scump'} decât ultimul preț`;
}

const PACK_UNIT_LABELS: Record<PackUnit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  buc: 'buc',
  m: 'm',
  role: 'role',
};

/** `8 role`, `1,5 l`, `120 buc`. */
export function formatPack(pack: { qty: number; unit: PackUnit }): string {
  return `${String(pack.qty).replace('.', ',')} ${PACK_UNIT_LABELS[pack.unit]}`;
}

/** `3 × buc`, `0,92 kg`: what was bought, as printed units. */
export function formatQuantity(qty: number, unit: 'buc' | 'kg' | 'l'): string {
  return `${String(qty).replace('.', ',')} ${unit}`;
}
