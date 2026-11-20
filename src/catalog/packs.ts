import type { PackChoice } from './types';

export function samePack(a: PackChoice | undefined, b: PackChoice | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.qty === b.qty && a.unit === b.unit && a.unitsPerPack === b.unitsPerPack;
}

/** A plain copy that omits an absent `unitsPerPack`, so stored records carry no `undefined` keys. */
export function clonePack(pack: PackChoice): PackChoice {
  return {
    qty: pack.qty,
    unit: pack.unit,
    ...(pack.unitsPerPack !== undefined ? { unitsPerPack: pack.unitsPerPack } : {}),
  };
}
