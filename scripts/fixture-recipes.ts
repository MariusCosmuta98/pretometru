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
  type OcrRule,
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

export interface OcrRecipe {
  id: string;
  kind: 'ocr-text';
  extraction: string;
  rules: readonly OcrRule[];
  /**
   * Misread lines of the OCR text (by index) and what the receipt actually prints. Together with
   * the sanitised lines they make the clean `source.pasted-text.json`. Verified against the image.
   */
  pasted?: Readonly<Record<number, string>>;
}

export type Recipe = PdfRecipe | OcrRecipe;

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
      data: 'identifiers',
      when: ({ text }) => /^Kaufland Card/i.test(text),
      apply: 'zero-digits',
    },
    {
      name: 'card slip',
      data: 'identifiers',
      when: between(/^Kaufland Card/i, /^Garan[țt]ie ambalaje/i),
      apply: 'mask',
    },
    {
      name: 'receipt number',
      data: 'identifiers',
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
      data: 'identifiers',
      when: ({ text }) => /Casier:/.test(text),
      apply: zeroAfter(/Casier:/),
    },
    {
      name: 'basket barcode',
      data: 'identifiers',
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
    {
      name: 'seller phones',
      data: 'business',
      when: immediatelyAfter(/Data Emitere/i),
      apply: 'mask',
    },
    {
      name: 'seller bank lines',
      data: 'business',
      when: between(/^Capital\s+social/i, /ONRC/i),
      apply: 'mask',
    },
    { name: 'excise line', data: 'business', when: immediatelyAfter(/ONRC/i), apply: 'mask' },
    {
      name: 'invoice header',
      data: 'identifiers',
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
      data: 'personal',
      when: ({ index, rows }) => {
        const invoice = rows.findIndex((text) => /^FACTURA\b/.test(text));
        const open = rows.findIndex((text, position) => position > invoice && SEPARATOR.test(text));
        const close = rows.findIndex((text, position) => position > open && SEPARATOR.test(text));
        return invoice !== -1 && open !== -1 && close !== -1 && index > open && index < close;
      },
      apply: 'mask',
    },
    { name: 'legal footer', data: 'business', when: after(/^Card Online/i), apply: 'mask' },
  ],
};

// Lidl: raw Tesseract output of the original screenshot (misreads included). Everything after the
// VAT lines up to the date line is the card slip; after "BON FISCAL" comes promo and store footer.
const LIDL_RECIPE: OcrRecipe = {
  id: 'lidl-2026-12-29',
  kind: 'ocr-text',
  extraction: 'lidl-2026-12-29.ocr-raw.json',
  rules: [
    {
      name: 'vat and payment lines',
      data: 'business',
      when: ({ text }) => /^(TVA [AB]\b|CARD\s+\d)/i.test(text),
      apply: 'keep',
    },
    {
      name: 'card slip',
      data: 'identifiers',
      when: between(/^TOTAL TVA/i, /^D?ATA\b/i),
      apply: 'mask',
    },
    { name: 'footer', data: 'business', when: after(/^BON FISCAL/i), apply: 'mask' },
  ],
  pasted: {
    6: 'Saci menajeri 60L 8,10 A',
    13: '1,000 BUC x 9,10',
    19: 'TVA B 11,00% 2,73',
    28: 'DATA:29/12/2026 ORA:17-12-30',
  },
};

// Mega Image: Tesseract output of the preprocessed screenshot (the raw run is unreadable). The
// receipt prints no store name; the merchant code line is the chain cue, so its letters stay.
const MEGA_RECIPE: OcrRecipe = {
  id: 'mega-image-2026-11-03',
  kind: 'ocr-text',
  extraction: 'mega-image-2026-11-03.ocr-pre.json',
  rules: [
    {
      name: 'merchant code',
      data: 'identifiers',
      when: ({ text }) => /COMERCIANT/i.test(text),
      apply: 'zero-digits',
    },
    {
      name: 'transaction date and time',
      data: 'business',
      when: ({ text }) => /\d\d\.\d\d\.\d\d\s+\S+\s+\d\d:\d\d:\d\d/.test(text),
      apply: 'keep',
    },
    {
      name: 'number under the total',
      data: 'identifiers',
      when: immediatelyAfter(/^TOTAL\b/i),
      apply: 'zero-digits',
    },
    { name: 'card slip', data: 'identifiers', when: after(/^TOTAL\b/i), apply: 'mask' },
  ],
  pasted: {
    0: 'ALWAYS ULTRA 16BUC 17,89',
    2: 'CAJU CRUDE 200G 14,99',
    3: '859042107579',
    4: 'EMMA NUCI 200G 12,99',
    5: '859042107549',
    6: 'CARE HARTIE 10R 3S 19,99',
    7: '594906503482',
    17: 'DATA 03.11.26 ORA 16:57:08',
  },
};

export const RECIPES: readonly Recipe[] = [KAUFLAND_RECIPE, METRO_RECIPE, LIDL_RECIPE, MEGA_RECIPE];
