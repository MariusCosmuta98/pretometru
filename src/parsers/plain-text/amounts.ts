import { BaniSchema, parseBani } from '@/domain';

/**
 * Amounts and quantities as printed on OCR'd or pasted receipts. Letters that OCR reads in place of
 * digits (`O` for 0, `l` for 1, `S` for 5, `B` for 8) are accepted inside a number, so `9,1O` still
 * reads 9,10; the digit repair then deals with digits that are wrong in confusable ways (0/8,
 * 5/6/9, 1/7).
 */

const LOOKALIKES: Readonly<Record<string, string>> = {
  O: '0',
  o: '0',
  I: '1',
  l: '1',
  '|': '1',
  S: '5',
  B: '8',
  Z: '2',
};
const LOOKALIKE_LETTERS = /[OoIl|SBZ]/g;

/** Letters that OCR reads as digits become those digits; everything else is left alone. */
export function digitize(text: string): string {
  return text.replace(LOOKALIKE_LETTERS, (letter) => LOOKALIKES[letter] ?? letter);
}

export interface AmountToken {
  /** As printed, with the sign. */
  text: string;
  bani: number;
  /** Offsets of `text` in the line (`end` exclusive). */
  start: number;
  end: number;
}

const D = '[0-9OoIl|SBZ]';
// Exactly two decimals (`1,000` is a quantity, not an amount). A `.` groups thousands (`1.234,56`)
// only when three digits follow, so `12.99` is 12,99. The left edge may touch an `x` or `*`
// (`BUC x4,05`) but not other letters or digits (`A12,99` is a code).
const AMOUNT = new RegExp(
  `(?:(?<![\\p{L}\\d.,])|(?<=[xX*]))(?<sign>-)?(?<int>${D}{1,3}(?:\\.\\d{3})+|${D}+)[.,](?<frac>${D}{2})(?<tail>-)?(?!\\d)`,
  'gu',
);

export function findAmounts(text: string): AmountToken[] {
  const tokens: AmountToken[] = [];
  for (const match of text.matchAll(AMOUNT)) {
    const { sign, int, frac, tail } = match.groups ?? {};
    if (int === undefined || frac === undefined) continue;
    // A word that happens to be made of lookalike letters ("BIO,SS") is not an amount: both the
    // whole part and the decimals need a real digit.
    if (!/[0-9]/.test(int) || !/[0-9]/.test(frac)) continue;
    if (sign && tail) continue;

    const bani = parseBani(
      `${sign || tail ? '-' : ''}${digitize(int.replaceAll('.', ''))},${digitize(frac)}`,
    );
    // An amount beyond the contract's ±10,000,000 RON is a runaway read (a code, a phone number).
    if (bani === undefined || !BaniSchema.safeParse(bani).success) continue;
    tokens.push({ text: match[0], bani, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

export interface TrailingAmount {
  /** The text before the amount, trimmed (the product name on an item line). */
  label: string;
  amount: AmountToken;
  /** What follows the amount, trimmed: a VAT class letter, a currency. */
  rest: string;
}

/**
 * The last amount of a line and what surrounds it, when what follows it is short (a VAT class
 * letter or a currency: `Smantana 30% 9,10 B`); `undefined` when the line has no such amount.
 */
export function trailingAmount(text: string, maxRest = 6): TrailingAmount | undefined {
  const amount = findAmounts(text).at(-1);
  if (!amount) return undefined;
  const rest = text.slice(amount.end).trim();
  if (rest.length > maxRest) return undefined;
  return { label: text.slice(0, amount.start).trim(), amount, rest };
}

/** The VAT class letter printed after an amount (`B`), or `undefined`. */
export function vatClassOf(rest: string): string | undefined {
  return /^[A-Z]\b/.exec(rest)?.[0];
}

/**
 * A quantity such as `1,000`, `0,920` or `2` (up to 3 decimals) as a number; `undefined` when the
 * text is not one.
 */
export function parsePrintedQuantity(text: string): number | undefined {
  const match = /^([0-9OoIl|SBZ]{1,5})(?:[.,]([0-9OoIl|SBZ]{1,3}))?$/.exec(text.trim());
  if (!match) return undefined;
  const whole = digitize(match[1] ?? '');
  const fraction = digitize(match[2] ?? '');
  if (!/^\d+$/.test(whole) || (fraction !== '' && !/^\d+$/.test(fraction))) return undefined;
  const qty = Number(`${whole}.${fraction || '0'}`);
  return qty > 0 && qty <= 100_000 ? qty : undefined;
}
