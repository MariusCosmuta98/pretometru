import {
  lastMonths,
  loadPriceIncreases,
  loadSpendingReceipts,
  summarizeSpending,
  type MonthKey,
  type PeriodSpending,
  type PriceIncrease,
  type SpendingPeriod,
  type SpendingReceipt,
} from '@/analytics';
import { getSetting, type PretometruDB } from '@/storage';

/** The periods the screen offers: the last 3, 6 or 12 months up to the current one, or everything. */
export type PeriodChoice = 3 | 6 | 12 | 'all';

export const PERIOD_CHOICES: ReadonlyArray<{ value: PeriodChoice; param: string; label: string }> =
  [
    { value: 3, param: '3', label: '3 luni' },
    { value: 6, param: '6', label: '6 luni' },
    { value: 12, param: '12', label: '12 luni' },
    { value: 'all', param: 'tot', label: 'Tot' },
  ];

export const DEFAULT_PERIOD: PeriodChoice = 6;

/** The period of a `?perioada=` parameter; the default for anything else. */
export function parsePeriod(param: string | null): PeriodChoice {
  return PERIOD_CHOICES.find((choice) => choice.param === param)?.value ?? DEFAULT_PERIOD;
}

/** The `?perioada=` value of a period. */
export function periodParam(choice: PeriodChoice): string {
  return PERIOD_CHOICES.find((entry) => entry.value === choice)?.param ?? '';
}

/**
 * What the screen reads from the device. It does not depend on the chosen period, so that switching
 * the period is a change of view and never a new query (no loading state, the picker keeps its focus).
 */
export interface StatsData {
  /** When the data was read: the clock the periods are counted from. */
  now: Date;
  /** Every confirmed receipt on the device. */
  receipts: SpendingReceipt[];
  /** Every price increase seen in the comparison window, biggest first. */
  increases: PriceIncrease[];
  /** The two comparison settings in force. */
  windowDays: number;
  excludeSales: boolean;
}

/** Everything the Statistics screen needs; `now` is only a parameter for tests. */
export async function loadStats(db: PretometruDB, now: Date = new Date()): Promise<StatsData> {
  const windowDays = await getSetting(db, 'priceWindowDays');
  const excludeSales = await getSetting(db, 'excludeDiscountedPrices');
  return {
    now,
    receipts: await loadSpendingReceipts(db),
    increases: await loadPriceIncreases(db, { now, days: windowDays, excludeSales }),
    windowDays,
    excludeSales,
  };
}

export interface PeriodView {
  spending: PeriodSpending;
  /** Receipts dated after the period (in the future): left out of a "last N months" period, found under "Tot". */
  later: { count: number; months: MonthKey[] };
}

/** The spending of the chosen period, and what lies after it. Pure. */
export function viewPeriod(
  { now, receipts }: Pick<StatsData, 'now' | 'receipts'>,
  choice: PeriodChoice,
): PeriodView {
  const period: SpendingPeriod = choice === 'all' ? {} : lastMonths(now, choice);
  const end = period.to;
  const after = end === undefined ? [] : receipts.filter((receipt) => receipt.month > end);
  return {
    spending: summarizeSpending(receipts, period),
    later: { count: after.length, months: [...new Set(after.map((r) => r.month))].sort() },
  };
}
