import { vatFromGross } from '@/domain';
import { VAT_AMOUNT_TOLERANCE_BANI } from '../validate';
import { digitize } from './amounts';
import { digitAlternatives } from './repair';

/** Rates (percent) that Romanian receipts print; 19, 9, 5 and 24 are older or special rates. */
export const VAT_RATES: readonly number[] = [0, 5, 9, 11, 19, 21, 24];

export interface VatRateReading {
  /** Whole percent. */
  rate: number;
  /** True when the printed digits were not a VAT rate and were corrected to reach one. */
  repaired: boolean;
}

export interface VatRateHint {
  /** The rate the class letter usually stands for (Lidl: A = 21, B = 11). */
  classRate?: number;
  /** VAT-inclusive total of the lines of this class, and the VAT amount printed for it. */
  grossBani?: number;
  vatBani?: number;
}

/**
 * Reads a printed VAT rate (`21,00`, `11,80`, `9`): as printed when it is one of `VAT_RATES`,
 * otherwise with the fewest confusable-digit corrections (`11,80` -> 11, since 8 and 0 are
 * confused) that lead to one. Several rates equally close are told apart by the printed VAT amount
 * (when the gross of the class is known), then by the class's usual rate. `undefined` when the
 * text is not a rate, or when no rate can be chosen: the caller keeps what it has.
 */
export function readVatRate(printed: string, hint: VatRateHint = {}): VatRateReading | undefined {
  const match = /^([0-9OoIl|SBZ]{1,2})(?:[.,]([0-9OoIl|SBZ]{2}))?%?$/.exec(printed.trim());
  if (!match) return undefined;
  const hundredths = Number(digitize(`${match[1] ?? ''}${match[2] ?? '00'}`));
  if (!Number.isFinite(hundredths)) return undefined;

  const exact = VAT_RATES.find((rate) => rate * 100 === hundredths);
  if (exact !== undefined) return { rate: exact, repaired: false };

  const reachable = new Map(
    digitAlternatives(hundredths, 4, 2).map(({ value, cost }) => [value, cost]),
  );
  const options = VAT_RATES.flatMap((rate) => {
    const cost = reachable.get(rate * 100);
    return cost === undefined ? [] : [{ rate, cost }];
  });
  const nearest = Math.min(...options.map((option) => option.cost));
  const tied = options.filter((option) => option.cost === nearest);

  let chosen = tied;
  const { grossBani, vatBani, classRate } = hint;
  const agrees = (rate: number) =>
    grossBani === undefined ||
    vatBani === undefined ||
    Math.abs(vatFromGross(grossBani, rate) - vatBani) <= VAT_AMOUNT_TOLERANCE_BANI;

  if (chosen.length > 1) {
    const agreeing = chosen.filter((option) => agrees(option.rate));
    if (agreeing.length > 0) chosen = agreeing;
  }
  if (chosen.length > 1 && classRate !== undefined) {
    const usual = chosen.filter((option) => option.rate === classRate);
    if (usual.length > 0) chosen = usual;
  }
  const [only] = chosen;
  // A correction that the printed VAT amount contradicts is a guess, not a repair.
  return chosen.length === 1 && only && agrees(only.rate)
    ? { rate: only.rate, repaired: true }
    : undefined;
}
