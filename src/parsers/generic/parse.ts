import type { ParsedReceipt, ParseWarning, ReceiptSource } from '@/domain';
import { findPurchasedAt } from '../plain-text/dates';
import { readItems } from '../plain-text/items';
import { buildLine, sourceConfidence } from '../plain-text/receipt';
import { repairReceipt } from '../plain-text/repair';
import { isTotalsRow, readTotalRow } from '../plain-text/rows';
import { textLines, type TextLine } from '../plain-text/text-lines';
import { engineForSource } from '../source';

export const GENERIC_VERSION = '1.0.0';

/** What `detect` answers for any text: low and constant, so every specific parser wins over it. */
export const GENERIC_DETECT_SCORE = 0.05;

// Below this OCR confidence (0..1) the text is probably too damaged to trust line by line.
const LOW_OCR_CONFIDENCE = 0.6;

// The totals block, the VAT rows and the company's tax number are not products.
const TAX_ROW = /^(?:tva\b|t\.?v\.?a\b|c\.?[iu]\.?[fi]\.?\b)/i;
const notAnItem = (text: string) => isTotalsRow(text) || TAX_ROW.test(text);

const totalOf = (line: TextLine): number | undefined => readTotalRow(line.text);

/** The fallback for a document no specific parser recognises: text lines, best effort. */
export function detectGeneric(source: ReceiptSource): number {
  return source.kind === 'pdf-text' ? 0 : GENERIC_DETECT_SCORE;
}

/**
 * Best-effort reading of a receipt of an unknown store: product rows (`name total [class]`, with
 * the quantity above or inside the row and an EAN below), the TOTAL row and the date. Everything is
 * flagged for review. The chain is `unknown`.
 */
export function parseGeneric(source: ReceiptSource): ParsedReceipt {
  const lines = textLines(source);
  const stop = lines.findIndex((line) => totalOf(line) !== undefined);
  const end = stop < 0 ? lines.length : stop;

  const { drafts, unreadable } = readItems(lines, end, {
    eanLines: true,
    inlineQuantity: true,
    skip: notAnItem,
  });
  const grandTotalBani = lines.map(totalOf).find((amount) => amount !== undefined) ?? 0;
  const purchasedAt = findPurchasedAt(lines);
  const confidence = sourceConfidence(source);

  const warnings: ParseWarning[] = [
    {
      code: 'LOW_CONFIDENCE',
      message:
        confidence !== undefined && confidence < LOW_OCR_CONFIDENCE
          ? 'Formatul bonului nu este recunoscut, iar textul este greu de citit: verifică fiecare linie.'
          : 'Formatul bonului nu este recunoscut: verifică fiecare linie.',
    },
    ...unreadable.map((lineIdx): ParseWarning => ({
      code: 'LOW_CONFIDENCE',
      lineIdx,
      message:
        'Linia produsului nu a putut fi citită; s-au păstrat doar cantitatea și prețul unitar.',
    })),
  ];

  const receipt: ParsedReceipt = {
    schemaVersion: 1,
    chain: 'unknown',
    docType: 'receipt',
    ...(purchasedAt && { purchasedAt }),
    currency: 'RON',
    totals: { grandTotalBani },
    lines: drafts.map((draft, idx) => buildLine(idx, draft)),
    meta: {
      engine: engineForSource(source),
      parser: 'generic',
      parserVersion: GENERIC_VERSION,
      ...(confidence !== undefined && { confidence }),
      warnings,
    },
  };
  return repairReceipt(receipt);
}
