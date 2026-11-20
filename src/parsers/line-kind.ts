import type { LineKind } from '@/domain';

/**
 * Non-product lines are told apart by name: a returnable-container deposit (`GARANTIE AMBALAJ`) or
 * a carrier bag (`PUNGA BIO`). Negative totals are standalone discounts.
 */
export function lineKindOf(name: string, lineTotalBani: number): LineKind {
  if (/\bgaran[țţt]ie\b/i.test(name)) return 'deposit';
  if (/^(punga|sacosa)\b/i.test(name)) return 'bag';
  return lineTotalBani < 0 ? 'discount' : 'product';
}
