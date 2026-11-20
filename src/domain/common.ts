import { z } from 'zod';
import { MAX_QTY } from './units';

// No single receipt amount is anywhere near 10 million RON; a larger value is a runaway parse
// (for instance a misread decimal separator), not data.
const MAX_BANI = 1_000_000_000;

/** Integer bani. VAT-inclusive unless the field name says otherwise. */
export const BaniSchema = z.int().min(-MAX_BANI).max(MAX_BANI);

const hasAtMostThreeDecimals = (value: number) =>
  Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-6;

/** Quantities and pack sizes: plain positive numbers with up to 3 decimals (`0.920` kg). */
export const QtySchema = z
  .number()
  .positive()
  .max(MAX_QTY)
  .refine(hasAtMostThreeDecimals, 'At most 3 decimals');

/**
 * UTC instant as `Date.toISOString()` writes it: `2026-11-20T11:05:08.959Z`. Exactly 3 ms digits,
 * because last-write-wins compares these as strings and `…08Z` would sort after `…08.500Z`.
 */
export const InstantSchema = z.iso.datetime({ precision: 3 });

export const UnitIntervalSchema = z.number().min(0).max(1);

/** VAT rate in percent (21, 11, 9, 5, 0; older receipts also used 19 and 24). */
export const VatRateSchema = z.number().min(0).max(100);

/** Digits only; may be shorter than 13 when a receipt truncates it. */
export const EanSchema = z.string().regex(/^\d{4,14}$/, 'EAN must be 4 to 14 digits');

export const NonEmptyTextSchema = z.string().min(1);

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'Expected semver');
