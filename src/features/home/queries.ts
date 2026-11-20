import {
  compareSpending,
  currentMonth,
  loadPriceIncreases,
  loadRecentReceipts,
  loadSpendingReceipts,
  shiftMonth,
  summarizeSpending,
  type MonthKey,
  type PeriodSpending,
  type PriceIncrease,
  type RecentReceipts,
  type SpendingComparison,
} from '@/analytics';
import { getSetting, type PretometruDB } from '@/storage';

/** How many receipts and price increases the Home cards list; the rest is one tap away. */
export const RECENT_LIMIT = 5;
export const INCREASES_LIMIT = 5;

export interface HomeData {
  /** The current month in Europe/Bucharest, and the one before it. */
  month: MonthKey;
  previousMonth: MonthKey;
  current: PeriodSpending;
  previous: PeriodSpending;
  comparison: SpendingComparison;
  recent: RecentReceipts;
  /** The biggest price increases seen in the window, at most `INCREASES_LIMIT`. */
  increases: PriceIncrease[];
  /** All of the increases seen in the window. */
  increaseCount: number;
  /** The user's `priceWindowDays` setting. */
  windowDays: number;
}

/** Everything the Home screen shows, read in one go; `now` is only a parameter for tests. */
export async function loadHome(db: PretometruDB, now: Date = new Date()): Promise<HomeData> {
  const month = currentMonth(now);
  const previousMonth = shiftMonth(month, -1);

  const receipts = await loadSpendingReceipts(db);
  const current = summarizeSpending(receipts, { from: month, to: month });
  const previous = summarizeSpending(receipts, { from: previousMonth, to: previousMonth });

  const windowDays = await getSetting(db, 'priceWindowDays');
  const increases = await loadPriceIncreases(db, { now, days: windowDays });

  return {
    month,
    previousMonth,
    current,
    previous,
    comparison: compareSpending(current, previous),
    recent: await loadRecentReceipts(db, RECENT_LIMIT),
    increases: increases.slice(0, INCREASES_LIMIT),
    increaseCount: increases.length,
    windowDays,
  };
}
