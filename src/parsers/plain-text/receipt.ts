import {
  parsePackSize,
  type ParsedLine,
  type ParsedReceipt,
  type QtyUnit,
  type ReceiptSource,
} from '@/domain';
import { lineKindOf } from '../line-kind';
import { meanConfidence, unionBox, type TextLine } from './text-lines';

/** One item as read from the text, before it becomes a `ParsedLine`. */
export interface ItemDraft {
  rawName: string;
  qty: number;
  qtyUnit: QtyUnit;
  unitPriceBani?: number;
  lineTotalBani: number;
  vatClass?: string;
  vatRate?: number;
  ean?: string;
  /** The text lines the item was read from, in order: they give its box, confidence and raw text. */
  from: readonly TextLine[];
}

export function buildLine(idx: number, draft: ItemDraft): ParsedLine {
  const { rawName, qty, qtyUnit, unitPriceBani, lineTotalBani, vatClass, vatRate, ean, from } =
    draft;
  const kind = lineKindOf(rawName, lineTotalBani);
  const line: ParsedLine = { idx, rawName, kind, qty, qtyUnit, lineTotalBani };

  if (unitPriceBani !== undefined) line.unitPriceBani = unitPriceBani;
  if (vatClass) line.vatClass = vatClass;
  if (vatRate !== undefined) line.vatRate = vatRate;
  if (ean) line.ean = ean;
  if (kind === 'product' && qtyUnit === 'buc') {
    const size = parsePackSize(rawName);
    if (size) line.pack = { qty: size.qty, unit: size.unit };
  }

  const confidence = meanConfidence(from);
  if (confidence !== undefined) line.confidence = confidence;
  const bbox = unionBox(from);
  if (bbox) line.bbox = bbox;
  if (from.length > 0) line.raw = from.map((printed) => printed.printed).join('\n');
  return line;
}

/** `meta.confidence` of a receipt read from `source`: the OCR page confidence on a 0..1 scale. */
export function sourceConfidence(source: ReceiptSource): number | undefined {
  return source.kind === 'ocr-text' && source.confidence !== undefined
    ? Math.min(1, Math.max(0, source.confidence / 100))
    : undefined;
}

/** Same receipt with `warnings` appended to `meta.warnings`. */
export function withWarnings(
  receipt: ParsedReceipt,
  warnings: readonly ParsedReceipt['meta']['warnings'][number][],
): ParsedReceipt {
  if (warnings.length === 0) return receipt;
  return {
    ...receipt,
    meta: { ...receipt.meta, warnings: [...receipt.meta.warnings, ...warnings] },
  };
}
