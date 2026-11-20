import { BaniSchema } from '@/domain';
import { trailingAmount, vatClassOf } from './amounts';
import { parseEanLine } from './ean';
import { readInlineQuantity, readQuantityLine } from './quantity-line';
import type { ItemDraft } from './receipt';
import type { TextLine } from './text-lines';

export interface ItemReaderOptions {
  /** A digits-only line right after a product is its EAN (Mega Image). */
  eanLines?: boolean;
  /** `Lapte 2 x 5,99 11,98`: the quantity and unit price inside the product line. */
  inlineQuantity?: boolean;
  /** Lines to skip: the totals block, VAT rows, a company's tax number. */
  skip?: (text: string) => boolean;
}

export interface ReadItems {
  drafts: ItemDraft[];
  /** Positions (in `drafts`) of items whose product line could not be read. */
  unreadable: number[];
}

const hasName = (label: string) => /\p{L}{2}/u.test(label);

/**
 * The products among `lines[0..end)`. A product is a name followed by its total and, often, its
 * VAT class (`Smantana 30% 9,10 B`). Lidl prints `n,000 BUC x price` on the line above (a pair);
 * Mega Image prints the EAN on the line below. A quantity line whose product line is missing still
 * becomes an item (named "Produs necunoscut") because the quantity and unit price prove its total.
 */
export function readItems(
  lines: readonly TextLine[],
  end: number,
  options: ItemReaderOptions = {},
): ReadItems {
  const drafts: ItemDraft[] = [];
  const unreadable: number[] = [];
  const { eanLines = false, inlineQuantity = false, skip } = options;

  const eanAfter = (at: number): TextLine | undefined => {
    const next = lines[at + 1];
    return eanLines && next && at + 1 < end && parseEanLine(next.text) ? next : undefined;
  };

  for (let at = 0; at < end; at++) {
    const line = lines[at];
    if (!line || skip?.(line.text)) continue;

    const quantity = readQuantityLine(line.text);
    if (quantity) {
      const next = lines[at + 1];
      const found =
        next && at + 1 < end && !readQuantityLine(next.text) && !skip?.(next.text)
          ? trailingAmount(next.text)
          : undefined;
      if (found && next && hasName(found.label)) {
        const vatClass = vatClassOf(found.rest);
        drafts.push({
          rawName: found.label,
          qty: quantity.qty,
          qtyUnit: quantity.qtyUnit,
          unitPriceBani: quantity.unitPriceBani,
          lineTotalBani: found.amount.bani,
          ...(vatClass && { vatClass }),
          from: [line, next],
        });
        at++;
      } else {
        // The product line did not survive; the quantity and the unit price still prove the total.
        const lineTotalBani = Math.round(quantity.qty * quantity.unitPriceBani);
        if (!BaniSchema.safeParse(lineTotalBani).success) continue;
        unreadable.push(drafts.length);
        drafts.push({
          rawName: 'Produs necunoscut',
          qty: quantity.qty,
          qtyUnit: quantity.qtyUnit,
          unitPriceBani: quantity.unitPriceBani,
          lineTotalBani,
          from: [line],
        });
      }
      continue;
    }

    const found = trailingAmount(line.text);
    if (!found || !hasName(found.label)) continue;
    const inline = inlineQuantity ? readInlineQuantity(found.label) : undefined;
    const ean = eanAfter(at);
    const vatClass = vatClassOf(found.rest);

    drafts.push({
      rawName: inline?.name ?? found.label,
      qty: inline?.qty ?? 1,
      qtyUnit: inline?.qtyUnit ?? 'buc',
      ...(inline && { unitPriceBani: inline.unitPriceBani }),
      lineTotalBani: found.amount.bani,
      ...(vatClass && { vatClass }),
      ...(ean && { ean: parseEanLine(ean.text) }),
      from: ean ? [line, ean] : [line],
    });
    if (ean) at++;
  }
  return { drafts, unreadable };
}
