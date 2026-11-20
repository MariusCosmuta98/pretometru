import type { ParseWarning } from '@/domain';
import { digitize } from './amounts';
import type { TextLine } from './text-lines';
import { toPurchasedAt } from '../text';

/**
 * Dates and times as OCR'd or pasted receipts print them: `29/12/2026`, `03.11.26`,
 * `DATA:29/12/2026 ORA:17-12-30`, `DAT? 03.11.26 ORA 16:57:08`. Letters read in place of digits
 * (`O`, `l`) are accepted; a date that is not a real calendar date is not a date.
 *
 * A time is read only from a clock that stands alone. A damaged clock (`ORA:1/-03-04`) is no
 * clock: its valid-looking tail (`03-04`) must not be read as the time, which would be made up.
 * The date stays, without a time, and the review is told that a time was printed.
 */

const DIGIT_LIKE = '[0-9OoIl]';
const DATE = new RegExp(
  `(?<![\\d.,/-])(?<day>${DIGIT_LIKE}{1,2})[./-](?<month>${DIGIT_LIKE}{1,2})[./-](?<year>${DIGIT_LIKE}{4}|${DIGIT_LIKE}{2})(?!\\d)`,
);

// `ORA`, `Ora`, `0RA`, `ORĂ`, `TIMP`, `Timp`, `TIME`: how receipts label the time of day.
const TIME_LABEL = '(?:[Oo0][Rr][AaĂă]|[Tt][Ii][Mm][EePp])';

// The time follows the date; only ":" and "-" separate it (a "." would collide with decimals).
// A clock stands alone: it begins a token (after a space) or follows its label, with or without a
// colon (`ORA:13-03-04`, `ORA :13-03-04`, `ORA13:03`). So the tails of a damaged clock, `03-04` of
// `1/-03-04` and `04:05` of `123:04:05`, are not clocks. It must not run on into another digit or
// group either (`1:13:03:04`: `1` was the last letter of a label).
const TIME = new RegExp(
  String.raw`(?<=(?:^|\s)(?:${TIME_LABEL}\s*:?)?)` +
    `(?<hour>${DIGIT_LIKE}{1,2})[:-](?<minute>${DIGIT_LIKE}{2})(?:[:-](?<second>${DIGIT_LIKE}{2}))?` +
    String.raw`(?![0-9]|[.,/:\-][0-9])`,
);

// A time label with digits after it: a time was printed, whether or not it can be read.
const TIME_PRINTED = new RegExp(`(?<![\\p{L}\\d])${TIME_LABEL}(?!\\p{L})[^\\p{L}\\d]{0,3}\\d`, 'u');

interface Found {
  purchasedAt: string;
  hasTime: boolean;
  /** A time was printed after its label but no clock could be read: the date stays without it. */
  timeUnreadable: boolean;
}

function findIn(text: string): Found | undefined {
  const match = DATE.exec(text);
  const date = match?.groups;
  if (!match || !date?.day || !date.month || !date.year) return undefined;
  const rest = text.slice(match.index + match[0].length);
  const clock = TIME.exec(rest)?.groups;

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
    if (withTime) return { purchasedAt: withTime, hasTime: true, timeUnreadable: false };
  }
  const dateOnly = toPurchasedAt({ day, month, year });
  return dateOnly
    ? { purchasedAt: dateOnly, hasTime: false, timeUnreadable: TIME_PRINTED.test(rest) }
    : undefined;
}

export interface PurchaseReading {
  /** `YYYY-MM-DDTHH:mm:ss`, `YYYY-MM-DDTHH:mm` or `YYYY-MM-DD`; absent when no date was read. */
  purchasedAt?: string;
  /** For the review: a printed time that could not be read (the date is kept without it). */
  warnings: ParseWarning[];
}

/**
 * The purchase moment printed on the receipt as `YYYY-MM-DDTHH:mm:ss` (or the bare date): the first
 * line that has a date with a time, else the first line with a date. A date without a time may be
 * a card expiry or a promotion, so one with a time is preferred. When the date is kept without the
 * time because the time was printed but unreadable (`ORA:1/-03-04`, `ORA 25:61`), a
 * `LOW_CONFIDENCE` warning says so; a date that never had a time raises nothing.
 */
export function readPurchasedAt(lines: readonly Pick<TextLine, 'text'>[]): PurchaseReading {
  let dateOnly: Found | undefined;
  for (const { text } of lines) {
    const found = findIn(text);
    if (!found) continue;
    if (found.hasTime) return { purchasedAt: found.purchasedAt, warnings: [] };
    dateOnly ??= found;
  }
  if (!dateOnly) return { warnings: [] };
  return {
    purchasedAt: dateOnly.purchasedAt,
    warnings: dateOnly.timeUnreadable
      ? [
          {
            code: 'LOW_CONFIDENCE',
            message:
              'Ora bonului nu a putut fi citită; s-a păstrat doar data. Verifică ora pe bon.',
          },
        ]
      : [],
  };
}
