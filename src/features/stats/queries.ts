import {
  lastMonths,
  loadPriceIncreases,
  loadSpendingReceipts,
  summarizeSpending,
  type MonthKey,
  type PeriodSpending,
  type PriceIncrease,
  type SpendingPeriod,
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

export interface StatsData {
  choice: PeriodChoice;
  /** What was spent in the chosen period. */
  spending: PeriodSpending;
  /** Confirmed receipts on the device, whatever their date: none means nothing to show yet. */
  receiptCount: number;
  /** Receipts dated after a "last N months" period (in the future): left out of it, found under "Tot". */
  later: { count: number; months: MonthKey[] };
  /** Every price increase seen in the comparison window, biggest first. */
  increases: PriceIncrease[];
  /** The two comparison settings in force. */
  windowDays: number;
  excludeSales: boolean;
}

/** Everything the Statistics screen shows for a period; `now` is only a parameter for tests. */
export async function loadStats(
  db: PretometruDB,
  choice: PeriodChoice,
  now: Date = new Date(),
): Promise<StatsData> {
  const receipts = await loadSpendingReceipts(db);
  const period: SpendingPeriod = choice === 'all' ? {} : lastMonths(now, choice);
  const spending = summarizeSpending(receipts, period);
  const after = period.to === undefined ? [] : receipts.filter((r) => r.month > (period.to ?? ''));

  const windowDays = await getSetting(db, 'priceWindowDays');
  const excludeSales = await getSetting(db, 'excludeDiscountedPrices');

  return {
    choice,
    spending,
    receiptCount: receipts.length,
    later: { count: after.length, months: [...new Set(after.map((r) => r.month))].sort() },
    increases: await loadPriceIncreases(db, { now, days: windowDays, excludeSales }),
    windowDays,
    excludeSales,
  };
}
