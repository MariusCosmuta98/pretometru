import { digitize } from './amounts';
import type { TextLine } from './text-lines';
import { toPurchasedAt } from '../text';

/**
 * Dates and times as OCR'd or pasted receipts print them: `29/12/2026`, `03.11.26`,
 * `DATA:29/12/2026 ORA:17-12-30`, `DAT? 03.11.26 ORA 16:57:08`. Letters read in place of digits
 * (`O`, `l`) are accepted; a date that is not a real calendar date is not a date.
 */

const DIGIT_LIKE = '[0-9OoIl]';
const DATE = new RegExp(
  `(?<![\\d.,/-])(?<day>${DIGIT_LIKE}{1,2})[./-](?<month>${DIGIT_LIKE}{1,2})[./-](?<year>${DIGIT_LIKE}{4}|${DIGIT_LIKE}{2})(?!\\d)`,
);
// The time follows the date; only ":" and "-" separate it (a "." would collide with decimals).
const TIME = new RegExp(
  `(?<![\\d.,])(?<hour>${DIGIT_LIKE}{1,2})[:-](?<minute>${DIGIT_LIKE}{2})(?:[:-](?<second>${DIGIT_LIKE}{2}))?(?!\\d)`,
);

interface Found {
  purchasedAt: string;
  hasTime: boolean;
}

function findIn(text: string): Found | undefined {
  const match = DATE.exec(text);
  const date = match?.groups;
  if (!match || !date?.day || !date.month || !date.year) return undefined;
  const clock = TIME.exec(text.slice(match.index + match[0].length))?.groups;

  const day = digitize(date.day);
  const month = digitize(date.month);
  const year = digitize(date.year);
  if (clock?.hour && clock.minute) {
    const hour = digitize(clock.hour);
    const minute = digitize(clock.minute);
    const second = clock.second === undefined ? undefined : digitize(clock.second);
    const withTime = toPurchasedAt(
      { day, month, year },
      { hour, minute, ...(second === undefined ? {} : { second }) },
    );
    if (withTime) return { purchasedAt: withTime, hasTime: true };
  }
  const dateOnly = toPurchasedAt({ day, month, year });
  return dateOnly ? { purchasedAt: dateOnly, hasTime: false } : undefined;
}

/**
 * The purchase moment printed on the receipt as `YYYY-MM-DDTHH:mm:ss` (or the bare date): the first
 * line that has a date with a time, else the first line with a date. A date without a time may be
 * a card expiry or a promotion, so one with a time is preferred.
 */
export function findPurchasedAt(lines: readonly Pick<TextLine, 'text'>[]): string | undefined {
  let dateOnly: string | undefined;
  for (const { text } of lines) {
    const found = findIn(text);
    if (!found) continue;
    if (found.hasTime) return found.purchasedAt;
    dateOnly ??= found.purchasedAt;
  }
  return dateOnly;
}
