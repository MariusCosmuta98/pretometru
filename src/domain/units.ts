import { z } from 'zod';

export const QTY_UNITS = ['buc', 'kg', 'l'] as const;
export const PACK_UNITS = ['g', 'kg', 'ml', 'l', 'buc', 'm', 'role'] as const;
/** Units in which prices are compared: what a product's price is expressed per. */
export const BASE_UNITS = ['kg', 'l', 'buc', 'role', 'm'] as const;

export const QtyUnitSchema = z.enum(QTY_UNITS);
export const PackUnitSchema = z.enum(PACK_UNITS);
export const BaseUnitSchema = z.enum(BASE_UNITS);

export type QtyUnit = z.infer<typeof QtyUnitSchema>;
export type PackUnit = z.infer<typeof PackUnitSchema>;
export type BaseUnit = z.infer<typeof BaseUnitSchema>;

/** Content of one sold unit, e.g. `{ qty: 425, unit: 'ml' }`. */
export interface Pack {
  qty: number;
  unit: PackUnit;
}

export interface PackSize extends Pack {
  /** Number of consumer units in the sold unit when the name says so (`6X2L` -> 6). */
  unitsPerPack?: number;
  /**
   * The name continues with a spaced multiplier (`8G * 4`, `2L X6`, `8 ROLE X 3 STRATURI`) that may
   * or may not be a pack count; `qty` is the single size. Warn, or confirm with other data (METRO's
   * "Unit. vanz.").
   */
  ambiguous?: true;
}

/** Upper bound of any quantity or pack size (also enforced by `QtySchema`). */
export const MAX_QTY = 1_000_000;

const BASE_OF: Record<PackUnit | QtyUnit, BaseUnit> = {
  g: 'kg',
  kg: 'kg',
  ml: 'l',
  l: 'l',
  buc: 'buc',
  m: 'm',
  role: 'role',
};

export function baseUnitOf(unit: PackUnit | QtyUnit): BaseUnit {
  return BASE_OF[unit];
}

// 1 g = 1 milli-kg and 1 ml = 1 milli-l; every other unit is already a base unit.
const MILLI_PER_UNIT: Record<PackUnit | QtyUnit, number> = {
  g: 1,
  ml: 1,
  kg: 1000,
  l: 1000,
  buc: 1000,
  role: 1000,
  m: 1000,
};

/** Quantity expressed in thousandths of its base unit, as an integer (400 g -> 400 milli-kg). */
export function toMilliBase(qty: number, unit: PackUnit | QtyUnit): number {
  return Math.round(qty * MILLI_PER_UNIT[unit]);
}

const NUMBER = '\\d+(?:[.,]\\d+)?';
// Meters only when glued to the number: `100M` is a length, `38 M` is a clothing size.
const UNIT = '(?:kg|gr|g|ml|cl|lt|l|buc|role|rol|(?<=\\d)m)';
const MULTIPLY = '[x*\\u00d7]';
// A size token must start at a word edge, must not be the upper end of a range (`9-14KG`) and
// must not run into more letters or digits.
const PACK_PATTERN = new RegExp(
  '(?<![\\p{L}\\d.,])(?<!\\d-)(?:' +
    // 4X125G, 6 x 0,5L: count first
    `(?<count>\\d+)\\s*${MULTIPLY}\\s*(?<countSize>${NUMBER})\\s*(?<countUnit>${UNIT})` +
    '|' +
    // 8G*4, 125GX4: size first, no spaces around the operator
    `(?<size>${NUMBER})\\s*(?<unit>${UNIT})${MULTIPLY}(?<multiplier>\\d+)` +
    '|' +
    // 425ML, 1 KG, 8 ROLE
    `(?<singleSize>${NUMBER})\\s*(?<singleUnit>${UNIT})` +
    ')(?![\\p{L}\\d])',
  'iu',
);
// `8G * 4`, `2L X6`, `8 ROLE X 3 STRATURI`: may be a pack count or something else (plies).
const SPACED_MULTIPLIER = new RegExp(`^\\s*${MULTIPLY}\\s*\\d`, 'iu');

const UNIT_ALIASES: Record<string, { unit: PackUnit; factor: number }> = {
  g: { unit: 'g', factor: 1 },
  gr: { unit: 'g', factor: 1 },
  kg: { unit: 'kg', factor: 1 },
  ml: { unit: 'ml', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  l: { unit: 'l', factor: 1 },
  lt: { unit: 'l', factor: 1 },
  buc: { unit: 'buc', factor: 1 },
  role: { unit: 'role', factor: 1 },
  rol: { unit: 'role', factor: 1 },
  m: { unit: 'm', factor: 1 },
};

const toNumber = (text: string) => Number(text.replace(',', '.'));
const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Finds the size of ONE sold unit in a printed product name (`425ML`, `8 ROLE`, `120BUC`,
 * `8G*4`, `4X125G`, `100M`). The first size token wins. Multipacks return the total content and
 * the number of consumer units. A size followed by a spaced multiplier (`8G * 4`) comes back as the
 * single size with `ambiguous: true`. Returns `undefined` when nothing usable is found.
 */
export function parsePackSize(name: string): PackSize | undefined {
  const match = PACK_PATTERN.exec(name);
  const groups = match?.groups;
  if (!match || !groups) return undefined;

  const count = groups.count ?? groups.multiplier;
  const size = groups.countSize ?? groups.size ?? groups.singleSize;
  const rawUnit = groups.countUnit ?? groups.unit ?? groups.singleUnit;
  const alias = rawUnit ? UNIT_ALIASES[rawUnit.toLowerCase()] : undefined;
  if (!size || !alias) return undefined;

  const unitsPerPack = count ? Number(count) : 1;
  const qty = round3(unitsPerPack * toNumber(size) * alias.factor);
  if (!(qty > 0 && qty <= MAX_QTY)) return undefined;

  if (unitsPerPack > 1) return { qty, unit: alias.unit, unitsPerPack };
  const rest = name.slice(match.index + match[0].length);
  return SPACED_MULTIPLIER.test(rest)
    ? { qty, unit: alias.unit, ambiguous: true }
    : { qty, unit: alias.unit };
}
