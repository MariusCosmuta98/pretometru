import type { ParsedReceipt, ReceiptSource } from '@/domain';
import { findPurchasedAt } from '../plain-text/dates';
import { readItems } from '../plain-text/items';
import { buildLine, sourceConfidence } from '../plain-text/receipt';
import { repairReceipt } from '../plain-text/repair';
import { readTotalRow } from '../plain-text/rows';
import { textLines, type TextLine } from '../plain-text/text-lines';
import { engineForSource } from '../source';

export const MEGA_IMAGE_VERSION = '1.0.0';

// Mega Image prints no store name: the only cue in the text is the merchant line of the card slip
// (`TERMINAL MI123456 COMERCIANT MEGA...`). The layout is the other one: every product is its name
// and price, with its EAN on the next line.
const MERCHANT = /\bcomerciant\s+mega/i;
// Where the item list stops when there is no TOTAL row: the card slip.
const SLIP = /^terminal\b|\bcomerciant\b/i;

const totalOf = (line: TextLine): number | undefined => readTotalRow(line.text);

function endOfItems(lines: readonly TextLine[]): number {
  const total = lines.findIndex((line) => totalOf(line) !== undefined);
  if (total >= 0) return total;
  const slip = lines.findIndex((line) => SLIP.test(line.text));
  return slip < 0 ? lines.length : slip;
}

/**
 * 0..1 evidence that `source` is a Mega Image receipt: the card slip's merchant line (strong) and
 * the product-then-EAN layout. Without a store name on the receipt, the layout has to be enough
 * for a cropped photo, but only when it is the whole layout (two or more products, nearly all with
 * their EAN): other receipts print an EAN here and there. The review screen lets the user change
 * the chain.
 */
export function detectMegaImage(source: ReceiptSource): number {
  const lines = textLines(source);
  const merchant = lines.some((line) => MERCHANT.test(line.text));
  const { drafts } = readItems(lines, endOfItems(lines), { eanLines: true });
  const pairs = drafts.filter((draft) => draft.ean !== undefined).length;
  const layout = pairs >= 2 && pairs / drafts.length >= 0.8;
  return Math.min(1, (merchant ? 0.6 : 0) + (layout ? 0.4 : 0));
}

export function parseMegaImage(source: ReceiptSource): ParsedReceipt {
  const lines = textLines(source);
  const { drafts } = readItems(lines, endOfItems(lines), { eanLines: true });

  const grandTotalBani = lines.map(totalOf).find((amount) => amount !== undefined) ?? 0;
  const purchasedAt = findPurchasedAt(lines);
  const confidence = sourceConfidence(source);

  const receipt: ParsedReceipt = {
    schemaVersion: 1,
    chain: 'mega-image',
    docType: 'receipt',
    ...(purchasedAt && { purchasedAt }),
    currency: 'RON',
    totals: { grandTotalBani },
    lines: drafts.map((draft, idx) => buildLine(idx, draft)),
    meta: {
      engine: engineForSource(source),
      parser: 'mega-image',
      parserVersion: MEGA_IMAGE_VERSION,
      ...(confidence !== undefined && { confidence }),
      warnings: [],
    },
  };
  return repairReceipt(receipt);
}
