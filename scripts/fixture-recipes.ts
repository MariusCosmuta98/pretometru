/**
 * How each real sample is sanitised. Rules select rows by label or position, never by value, so
 * this file holds no personal data. A rule that matches nothing fails the run (see `sanitize.ts`).
 *
 * Masked rows keep their shape (letters -> x/X, digits -> 0) so parsers still meet the noise a real
 * document has: bank lines, buyer block, card slip, legal footer.
 */
import {
  after,
  between,
  immediatelyAfter,
  zeroDigits,
  type PdfRule,
  type RowTransform,
} from './sanitize.ts';

export interface PdfRecipe {
  /** Directory name under `tests/fixtures/real/`. */
  id: string;
  kind: 'pdf-text';
  /** File name inside `~/.pretometru-private/extracted/`. */
  extraction: string;
  rules: readonly PdfRule[];
}

/** Same-length stand-in for a document number: reads as a number, is never a real one. */
export function fakeDigits(digits: string): string {
  return '1234567890'.repeat(Math.ceil(digits.length / 10)).slice(0, digits.length);
}

/** Zeroes every digit in the items after the one that carries `label`. */
const zeroAfter =
  (label: RegExp): RowTransform =>
  (strings) => {
    let zero = false;
    return strings.map((text) => {
      if (label.test(text)) {
        zero = true;
        return text;
      }
      return zero ? zeroDigits(text) : text;
    });
  };

const KAUFLAND_RECIPE: PdfRecipe = {
  id: 'kaufland-2026-11-07',
  kind: 'pdf-text',
  extraction: 'kaufland-2026-11-07.pdf-text.json',
  rules: [
    {
      name: 'loyalty card number',
      when: ({ text }) => /^Kaufland Card/i.test(text),
      apply: 'zero-digits',
    },
    {
      name: 'card slip',
      when: between(/^Kaufland Card/i, /^Garan[țt]ie ambalaje/i),
      apply: 'mask',
    },
    {
      name: 'receipt number',
      when: ({ text }) => /\bBon:\d+/.test(text),
      apply: (strings) =>
        strings.map((text) =>
          text.replace(
            /(Bon:\s*)(\d+)/,
            (_match, label: string, digits: string) => label + fakeDigits(digits),
          ),
        ),
    },
    {
      name: 'cashier number',
      when: ({ text }) => /Casier:/.test(text),
      apply: zeroAfter(/Casier:/),
    },
    {
      name: 'basket barcode',
      when: ({ text }) => /^\d{20,}$/.test(text),
      apply: 'zero-digits',
    },
  ],
};

// METRO invoices carry the seller's phone and bank lines, the buyer block (name, address, client
// number) between two separator lines, and a legal footer after the payment line.
const SEPARATOR = /^-{20,}$/;

const METRO_RECIPE: PdfRecipe = {
  id: 'metro-invoice-2026-08-12',
  kind: 'pdf-text',
  extraction: 'metro-invoice-2026-08-12.pdf-text.json',
  rules: [
    { name: 'seller phones', when: immediatelyAfter(/Data Emitere/i), apply: 'mask' },
    { name: 'seller bank lines', when: between(/^Capital\s+social/i, /ONRC/i), apply: 'mask' },
    { name: 'excise line', when: immediatelyAfter(/ONRC/i), apply: 'mask' },
    {
      name: 'invoice header',
      when: ({ text }) => /^FACTURA\b/.test(text),
      apply: (strings) => {
        let zero = false;
        return strings.map((text) => {
          if (/Casier:/.test(text)) {
            zero = true;
            return text;
          }
          if (/Casa:/.test(text)) {
            zero = false;
            return text;
          }
          if (/NR\.Intern/.test(text)) zero = true;
          const faked = text.replace(/\d{10,}/g, fakeDigits);
          return zero ? zeroDigits(faked) : faked;
        });
      },
    },
    {
      name: 'buyer block',
      when: ({ index, rows }) => {
        const invoice = rows.findIndex((text) => /^FACTURA\b/.test(text));
        const open = rows.findIndex((text, position) => position > invoice && SEPARATOR.test(text));
        const close = rows.findIndex((text, position) => position > open && SEPARATOR.test(text));
        return invoice !== -1 && open !== -1 && close !== -1 && index > open && index < close;
      },
      apply: 'mask',
    },
    { name: 'legal footer', when: after(/^Card Online/i), apply: 'mask' },
  ],
};

export const PDF_RECIPES: readonly PdfRecipe[] = [KAUFLAND_RECIPE, METRO_RECIPE];
