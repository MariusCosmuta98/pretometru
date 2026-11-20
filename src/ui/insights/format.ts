import type { PriceObservation } from '@/analytics';
import { formatLei, formatMilliBani, toMilliBase, type BaseUnit, type PackUnit } from '@/domain';

/*
 * Romanian formatting shared by the Home and Statistics screens. Money goes through the `@/domain`
 * helpers (integer bani in, text out); percentages are ratios and the only floats on these screens.
 */

const MONTH_NAMES = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];

/** `2026-11` -> `noiembrie 2026`. */
export function formatMonth(month: string): string {
  const [year, number] = month.split('-');
  const name = MONTH_NAMES[Number(number) - 1];
  return name ? `${name} ${year}` : month;
}

/** `2026-11` -> `Noiembrie 2026`, for a heading. */
export function formatMonthTitle(month: string): string {
  const text = formatMonth(month);
  return `${text.charAt(0).toLocaleUpperCase('ro')}${text.slice(1)}`;
}

/** `2026-11-07` (or `2026-11-07T18:31`) -> `07.11.2026`. */
export function formatDay(date: string): string {
  const [year, month, day] = date.slice(0, 10).split('-');
  return `${day}.${month}.${year}`;
}

const MINUS = '\u2212';

/** `+7,5%`, `−3,2%` (typographic minus), `0,0%`: a ratio with one decimal. */
export function formatPercent(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? MINUS : '';
  return `${sign}${Math.abs(pct).toFixed(1).replace('.', ',')}%`;
}

/** `+25,00 lei`, `−108,76 lei`, `0,00 lei`. */
export function formatSignedLei(bani: number): string {
  const sign = bani > 0 ? '+' : bani < 0 ? MINUS : '';
  return `${sign}${formatLei(Math.abs(bani))}`;
}

/**
 * `1 bon`, `2 bonuri`, `20 de bonuri`: Romanian puts "de" between a number of 20 or more (its last
 * two digits, 00 included) and the thing counted.
 */
export function formatCount(count: number, one: string, many: string): string {
  if (count === 1) return `1 ${one}`;
  const lastTwo = Math.abs(count) % 100;
  return `${count} ${lastTwo === 0 || lastTwo >= 20 ? 'de ' : ''}${many}`;
}

const UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  l: 'l',
  buc: 'buc',
  role: 'rolă',
  m: 'm',
};

export const unitLabel = (unit: BaseUnit): string => UNIT_LABELS[unit];

/** Two decimals from one leu up, more for cheap pieces (`0,0332 lei/buc`). */
function decimalsFor(milliBani: number): number {
  const size = Math.abs(milliBani);
  return size >= 100_000 ? 2 : size >= 10_000 ? 3 : 4;
}

/** `1,60 lei/rolă`. */
export function formatUnitPrice(milliBani: number, unit: BaseUnit): string {
  return `${formatMilliBani(milliBani, decimalsFor(milliBani))} lei/${unitLabel(unit)}`;
}

/** `1,45 → 1,60 lei/rolă`: both ends with the same number of decimals. */
export function formatUnitPriceMove(from: number, to: number, unit: BaseUnit): string {
  const decimals = decimalsFor(Math.max(from, to));
  return `${formatMilliBani(from, decimals)} → ${formatMilliBani(to, decimals)} lei/${unitLabel(unit)}`;
}

/** `+0,15 lei/rolă`, `+0,0100 lei/buc`: the move itself, with the sign. */
export function formatUnitDelta(deltaMilliBani: number, reference: number, unit: BaseUnit): string {
  const text = formatMilliBani(Math.abs(deltaMilliBani), decimalsFor(reference));
  const sign = deltaMilliBani > 0 ? '+' : deltaMilliBani < 0 ? MINUS : '';
  return `${sign}${text} lei/${unitLabel(unit)}`;
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

/**
 * The shelf price of a pack, `6,99 lei / 120 buc`, for the cases where the price per base unit alone
 * is hard to picture (a wet wipe costs 0,0583 lei). Nothing for a weighed line, a line without a
 * pack, or a pack that is exactly one base unit (then it equals the unit price).
 */
export function formatPackPrice(
  price: Pick<PriceObservation, 'unit' | 'pack' | 'paidUnitBani'>,
): string | undefined {
  const { unit, pack } = price;
  if (unit !== 'buc' || !pack || toMilliBase(pack.qty, pack.unit) === 1000) return undefined;
  return `${formatLei(price.paidUnitBani)} / ${formatPack(pack)}`;
}
