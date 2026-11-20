import {
  isValidPurchasedAt,
  SemverSchema,
  type DocType,
  type ExtractionEngine,
  type Line,
  type LineKind,
  type ParsedLine,
  type ParsedReceipt,
  type ParseWarning,
  type QtyUnit,
  type Receipt,
  type ReceiptStatus,
  type Store,
} from '@/domain';
import type { LineInput, ReceiptInput } from '@/storage';
import { defined } from './defined';
import type { MappingChoice, PackChoice } from './ports';
import type { LineBox, LineMeta, ReviewSession, VatTotals } from './session';
import type { StoreSpec } from './stores';

export type SourceKind = Receipt['source']['kind'];

/** Placeholder for a line whose printed name the engine could not read. */
export const UNNAMED_LINE = '(fără nume)';

// A guard against pathological inputs; real receipts have a few hundred characters per line.
const MAX_RAW_TEXT = 20_000;

export interface DraftLine {
  /** The persisted line id, also the stable key of the line while it is edited. */
  id: string;
  /** Printed order. Gaps are fine (deleted lines); new lines go last. */
  idx: number;
  rawName: string;
  kind: LineKind;
  ean?: string;
  qty: number;
  qtyUnit: QtyUnit;
  /** Printed list price per unit, before discount: only feeds the arithmetic check, never stored. */
  unitPriceBani?: number;
  /** Already inside `lineTotalBani`. */
  discountBani: number;
  /** VAT-inclusive, net of the discount. */
  lineTotalBani: number;
  vatRate?: number;
  vatClass?: string;
  storeCategoryHint?: string;
  pack?: PackChoice;
  productId?: string;
  categoryId?: string;
  confidence?: number;
  bbox?: LineBox;
  raw?: string;
}

export interface DraftSource {
  kind: SourceKind;
  fileHash?: string;
  fileName?: string;
  /** PII-free text kept for re-processing. */
  rawText?: string;
}

export interface DraftExtraction {
  engine: ExtractionEngine;
  parser: string;
  version: string;
  confidence?: number;
  warnings: ParseWarning[];
}

/**
 * A receipt in the shape the import and review code work with: typed values, the store as a spec
 * (found or created on save) and no storage bookkeeping. Persisted by `saveDraft`.
 */
export interface ReceiptDraft {
  /** Set once the receipt is persisted. */
  id?: string;
  storeId?: string;
  status: ReceiptStatus;
  store: StoreSpec;
  docType: DocType;
  documentNo?: string;
  purchasedAt?: string;
  /** Printed TOTAL of goods, VAT-inclusive, before payment-side vouchers. */
  totalBani: number;
  paidBani?: number;
  vat?: VatTotals;
  lines: DraftLine[];
  source: DraftSource;
  extraction: DraftExtraction;
}

export interface DraftOrigin {
  kind: SourceKind;
  fileHash?: string;
  fileName?: string;
}

/** Product lines only: the part of the printed text that is PII-free by the parser contract. */
export function rawTextFromParsed(parsed: ParsedReceipt): string | undefined {
  const text = parsed.lines
    .flatMap((line) => (line.raw?.trim() ? [line.raw.trim()] : []))
    .join('\n')
    .slice(0, MAX_RAW_TEXT);
  return text === '' ? undefined : text;
}

function draftLineFromParsed(line: ParsedLine, id: string): DraftLine {
  return defined({
    id,
    idx: line.idx,
    rawName: line.rawName.trim() === '' ? UNNAMED_LINE : line.rawName.trim(),
    kind: line.kind,
    ean: line.ean,
    qty: line.qty,
    qtyUnit: line.qtyUnit,
    unitPriceBani: line.unitPriceBani,
    discountBani: line.discountBani ?? 0,
    lineTotalBani: line.lineTotalBani,
    vatRate: line.vatRate,
    vatClass: line.vatClass,
    storeCategoryHint: line.storeCategoryHint,
    pack: line.pack ? { qty: line.pack.qty, unit: line.pack.unit } : undefined,
    confidence: line.confidence,
    bbox: line.bbox,
    raw: line.raw,
  });
}

/** A new draft from what a parser read. Lines get fresh ids; nothing is persisted yet. */
export function draftFromParsed(
  parsed: ParsedReceipt,
  origin: DraftOrigin,
  newId: () => string,
): ReceiptDraft {
  const rawText = rawTextFromParsed(parsed);
  return defined({
    status: 'draft' as const,
    store: defined({
      chain: parsed.chain,
      name: parsed.storeName,
      branchCode: parsed.branch?.code,
      city: parsed.branch?.city,
    }),
    docType: parsed.docType,
    documentNo: parsed.documentNo,
    purchasedAt:
      parsed.purchasedAt !== undefined && isValidPurchasedAt(parsed.purchasedAt)
        ? parsed.purchasedAt
        : undefined,
    totalBani: parsed.totals.grandTotalBani,
    paidBani: parsed.totals.paidBani,
    vat: parsed.totals.vat,
    lines: parsed.lines.map((line) => draftLineFromParsed(line, newId())),
    source: defined({
      kind: origin.kind,
      fileHash: origin.fileHash,
      fileName: origin.fileName?.trim() || undefined,
      rawText,
    }),
    extraction: defined({
      engine: parsed.meta.engine,
      parser: parsed.meta.parser,
      version: SemverSchema.safeParse(parsed.meta.parserVersion).success
        ? parsed.meta.parserVersion
        : '0.0.0',
      confidence: parsed.meta.confidence,
      warnings: [...parsed.meta.warnings],
    }),
  });
}

/** An empty draft for a receipt typed in by hand. */
export function blankDraft(
  options: { chain?: StoreSpec['chain']; date?: string } = {},
): ReceiptDraft {
  return defined({
    status: 'draft' as const,
    store: { chain: options.chain ?? 'unknown' },
    docType: 'receipt' as const,
    purchasedAt: options.date,
    totalBani: 0,
    lines: [],
    source: { kind: 'manual' as const },
    extraction: { engine: 'manual' as const, parser: 'manual', version: '1.0.0', warnings: [] },
  });
}

function draftLineFromStored(line: Line, meta: LineMeta | undefined): DraftLine {
  return defined({
    id: line.id,
    idx: line.idx,
    rawName: line.rawName,
    kind: line.kind,
    ean: line.ean,
    qty: line.qty,
    qtyUnit: line.unit,
    unitPriceBani: meta?.unitPriceBani,
    discountBani: line.discountBani,
    lineTotalBani: line.lineTotalBani,
    vatRate: line.vatRate,
    vatClass: meta?.vatClass,
    storeCategoryHint: line.storeCategoryHint,
    pack:
      line.packQty !== undefined && line.packUnit !== undefined
        ? defined({ qty: line.packQty, unit: line.packUnit, unitsPerPack: line.unitsPerPack })
        : undefined,
    productId: line.productId,
    categoryId: line.categoryId,
    confidence: meta?.confidence,
    bbox: meta?.bbox,
    raw: meta?.raw,
  });
}

/** The draft of a persisted receipt, enriched with what the in-memory review session still knows. */
export function draftFromStored(
  stored: { receipt: Receipt; lines: readonly Line[]; store: Store | undefined },
  session?: ReviewSession,
): ReceiptDraft {
  const { receipt, store } = stored;
  return defined({
    id: receipt.id,
    storeId: receipt.storeId,
    status: receipt.status,
    store: store
      ? defined({
          chain: store.chain,
          name: store.name,
          branchCode: store.branchCode,
          city: store.city,
        })
      : { chain: 'unknown' as const },
    docType: receipt.docType,
    documentNo: receipt.receiptNo,
    purchasedAt: receipt.purchasedAt,
    totalBani: receipt.totalBani,
    paidBani: receipt.paidBani,
    vat: session?.vat,
    lines: [...stored.lines]
      .sort((a, b) => a.idx - b.idx)
      .map((line) => draftLineFromStored(line, session?.lines[line.id])),
    source: defined({ ...receipt.source }),
    extraction: defined({
      ...receipt.extraction,
      warnings: [...receipt.extraction.warnings],
    }),
  });
}

function parsedLineFromDraft(line: DraftLine): ParsedLine {
  return defined({
    idx: line.idx,
    rawName: line.rawName,
    kind: line.kind,
    ean: line.ean,
    qty: line.qty,
    qtyUnit: line.qtyUnit,
    unitPriceBani: line.unitPriceBani,
    discountBani: line.discountBani > 0 ? line.discountBani : undefined,
    lineTotalBani: line.lineTotalBani,
    vatRate: line.vatRate,
    vatClass: line.vatClass,
    storeCategoryHint: line.storeCategoryHint,
    pack: line.pack ? { qty: line.pack.qty, unit: line.pack.unit } : undefined,
    confidence: line.confidence,
    bbox: line.bbox,
    raw: line.raw,
  });
}

/** The draft as the parsers' validation sees it: lines in printed order, no warnings. */
export function parsedFromDraft(draft: ReceiptDraft): ParsedReceipt {
  const { totalBani, paidBani } = draft;
  const voucherBani =
    paidBani !== undefined && paidBani < totalBani ? totalBani - paidBani : undefined;
  const branch = defined({ code: draft.store.branchCode, city: draft.store.city });

  return defined({
    schemaVersion: 1 as const,
    chain: draft.store.chain,
    storeName: draft.store.name,
    branch: Object.keys(branch).length > 0 ? branch : undefined,
    docType: draft.docType,
    documentNo: draft.documentNo,
    purchasedAt: draft.purchasedAt,
    currency: 'RON' as const,
    totals: defined({ grandTotalBani: totalBani, voucherBani, paidBani, vat: draft.vat }),
    lines: [...draft.lines].sort((a, b) => a.idx - b.idx).map(parsedLineFromDraft),
    meta: defined({
      engine: draft.extraction.engine,
      parser: draft.extraction.parser,
      parserVersion: draft.extraction.version,
      confidence: draft.extraction.confidence,
      warnings: [],
    }),
  });
}

export function receiptInputFromDraft(draft: ReceiptDraft, storeId: string): ReceiptInput {
  return defined({
    id: draft.id,
    storeId,
    purchasedAt: draft.purchasedAt,
    receiptNo: draft.documentNo,
    docType: draft.docType,
    totalBani: draft.totalBani,
    paidBani: draft.paidBani,
    source: defined({ ...draft.source }),
    extraction: defined({ ...draft.extraction }),
    status: draft.status,
  });
}

/**
 * Persisted fields only: `saveReceipt` derives the unit prices from total, quantity and pack, and
 * the schemas reject unknown keys. Non-product lines never carry a product.
 */
export function lineInputsFromDraft(draft: ReceiptDraft): LineInput[] {
  return [...draft.lines]
    .sort((a, b) => a.idx - b.idx)
    .map((line) =>
      defined({
        id: line.id,
        idx: line.idx,
        rawName: line.rawName,
        ean: line.ean,
        qty: line.qty,
        unit: line.qtyUnit,
        lineTotalBani: line.lineTotalBani,
        discountBani: line.discountBani,
        vatRate: line.vatRate,
        kind: line.kind,
        storeCategoryHint: line.storeCategoryHint,
        productId: line.kind === 'product' ? line.productId : undefined,
        categoryId: line.categoryId,
        packQty: line.pack?.qty,
        packUnit: line.pack?.unit,
        unitsPerPack: line.pack?.unitsPerPack,
      }),
    );
}

/** The mapped product lines, for the alias memory (`rememberMappings`). */
export function mappingChoices(draft: ReceiptDraft): MappingChoice[] {
  const choices: MappingChoice[] = [];
  for (const line of draft.lines) {
    if (line.kind !== 'product' || line.productId === undefined) continue;
    choices.push(
      defined({
        rawName: line.rawName,
        ean: line.ean,
        productId: line.productId,
        pack: line.pack ? { ...line.pack } : undefined,
      }),
    );
  }
  return choices;
}

/** The part of a line that lives only in memory while the receipt is reviewed. */
export function lineMetaOf(line: DraftLine): LineMeta {
  return defined({
    unitPriceBani: line.unitPriceBani,
    vatClass: line.vatClass,
    confidence: line.confidence,
    bbox: line.bbox,
    raw: line.raw,
  });
}
