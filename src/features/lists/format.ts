import type { PriceObservation } from '@/analytics';
import {
  formatLei,
  formatMilliBani,
  toMilliBase,
  type BaseUnit,
  type PackUnit,
  type QtyUnit,
} from '@/domain';

const UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  l: 'l',
  buc: 'buc',
  role: 'rolă',
  m: 'm',
};

export const unitLabel = (unit: BaseUnit): string => UNIT_LABELS[unit];

/** `1,30 lei/rolă`: two decimals from one leu up, three from ten bani, four for cheaper pieces (`0,0332 lei/buc`). */
export function formatUnitPrice(milliBani: number, unit: BaseUnit): string {
  const decimals = milliBani >= 100_000 ? 2 : milliBani >= 10_000 ? 3 : 4;
  return `${formatMilliBani(milliBani, decimals)} lei/${unitLabel(unit)}`;
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
 * The shelf price of a pack, `3,98 lei / 120 buc`, for the cases where the price per base unit alone
 * is hard to picture (a wet wipe costs 0,0332 lei). Nothing for a weighed line, a line without a
 * pack, or a pack that is exactly one base unit (then it equals the unit price).
 */
export function formatPackPrice(
  price: Pick<PriceObservation, 'unit' | 'pack' | 'paidUnitBani'>,
): string | undefined {
  const { unit, pack } = price;
  if (unit !== 'buc' || !pack || toMilliBase(pack.qty, pack.unit) === 1000) return undefined;
  return `${formatLei(price.paidUnitBani)} / ${formatPack(pack)}`;
}

/** `2026-11-07` -> `07.11.2026`. */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

/** What an estimate is called on screen: `≈ 11,60 lei`. */
export const formatEstimate = (bani: number): string => `≈ ${formatLei(bani)}`;

/**
 * The quantity as typed on the list: `2 buc`, `1,5 kg`, a bare `3`. A unit without a quantity
 * means one of it. `undefined` when the item has neither.
 */
export function formatQuantity(
  qty: number | undefined,
  unit: QtyUnit | undefined,
): string | undefined {
  if (qty === undefined && unit === undefined) return undefined;
  const amount = String(qty ?? 1).replace('.', ',');
  return unit === undefined ? amount : `${amount} ${unit}`;
}

/** Romanian puts "de" between a count of 20 or more and what is counted: `2 articole`, `20 de articole`, `119 zile`. */
export function formatCount(count: number, one: string, many: string): string {
  if (count === 1) return `1 ${one}`;
  const de = count !== 0 && (count % 100 === 0 || count % 100 >= 20) ? ' de' : '';
  return `${count}${de} ${many}`;
}

export const formatItems = (count: number): string => formatCount(count, 'articol', 'articole');
export const formatDays = (count: number): string => formatCount(count, 'zi', 'zile');

const QUANTITY = /^\d+(?:[.,]\d{1,3})?$/;

/**
 * Reads a quantity typed in a field: a positive number with up to 3 decimals, `.` or `,` as the
 * mark. Empty text is "no quantity" (`undefined`); anything else is `null`.
 */
export function parseQuantityInput(text: string): number | undefined | null {
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  if (!QUANTITY.test(trimmed)) return null;
  const value = Number(trimmed.replace(',', '.'));
  return value > 0 && value <= 1_000_000 ? value : null;
}
