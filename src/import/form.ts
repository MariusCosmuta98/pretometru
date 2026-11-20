import {
  isValidPurchasedAt,
  NON_PRODUCT_CATEGORY_ID,
  parsePurchasedAt,
  type Chain,
  type DocType,
  type LineKind,
  type PackUnit,
  type QtyUnit,
  type ReceiptStatus,
} from '@/domain';
import {
  formatLeiInput,
  formatQtyInput,
  parseEanInput,
  parseLeiInput,
  parseQtyInput,
} from './amounts';
import { defined } from './defined';
import type { DraftExtraction, DraftLine, DraftSource, ReceiptDraft } from './draft';
import type { LineMapping, PackChoice } from './ports';
import type { LineBox, VatTotals } from './session';

/*
 * The editable, text-based working copy of a receipt under review. Every number is kept as the
 * text the user typed, so a half-typed `12,` never fights the input and an invalid value can be
 * reported instead of silently replaced. `readForm` turns it back into a typed `ReceiptDraft`.
 */

export interface LineForm {
  /** The persisted line id; stable while the line is edited. */
  id: string;
  idx: number;
  rawName: string;
  kind: LineKind;
  qty: string;
  qtyUnit: QtyUnit;
  /** VAT-inclusive amount charged, after the discount (lei). */
  total: string;
  /** Lei; empty for none. */
  discount: string;
  /** Printed list price per unit (lei); empty when the receipt has none. */
  unitPrice: string;
  ean: string;
  /** Content of one sold unit; empty for "unknown". */
  packQty: string;
  packUnit: PackUnit;
  /** Consumer units in the pack (`6X2L` -> 6); empty for none. */
  unitsPerPack: string;
  productId?: string;
  categoryId?: string;
  // Not editable: carried through so the review keeps its crops and arithmetic checks.
  vatRate?: number;
  vatClass?: string;
  storeCategoryHint?: string;
  confidence?: number;
  bbox?: LineBox;
  raw?: string;
}

export interface ReceiptForm {
  id?: string;
  storeId?: string;
  status: ReceiptStatus;
  chain: Chain;
  /** Only used for the `unknown` chain. */
  storeName: string;
  branchCode: string;
  city: string;
  docType: DocType;
  documentNo: string;
  /** `YYYY-MM-DD`, or empty. */
  date: string;
  /** `HH:mm[:ss]`, or empty. */
  time: string;
  /** Printed TOTAL of goods (lei). */
  total: string;
  /** Lei actually paid, when different from the total; empty otherwise. */
  paid: string;
  /** In printed order. */
  lines: LineForm[];
  vat?: VatTotals;
  source: DraftSource;
  extraction: DraftExtraction;
}

export type FieldError = 'required' | 'invalid';
export type ReceiptField = 'date' | 'time' | 'total' | 'paid';
export type LineField =
  'rawName' | 'qty' | 'total' | 'discount' | 'unitPrice' | 'ean' | 'packQty' | 'unitsPerPack';

export type FieldTarget =
  { scope: 'receipt'; field: ReceiptField } | { scope: 'line'; lineId: string; field: LineField };

export type LineErrors = Partial<Record<LineField, FieldError>>;

export interface FormErrors {
  receipt: Partial<Record<ReceiptField, FieldError>>;
  /** By line id; only lines with an error appear. */
  lines: Record<string, LineErrors>;
}

export interface FormRead {
  /**
   * The typed receipt. Lines with an invalid field are left out, so this is safe to persist only
   * when `hasErrors` is false.
   */
  draft: ReceiptDraft;
  errors: FormErrors;
  hasErrors: boolean;
}

const MAX_UNITS_PER_PACK = 10_000;

function lineFormFromDraft(line: DraftLine): LineForm {
  return defined({
    id: line.id,
    idx: line.idx,
    rawName: line.rawName,
    kind: line.kind,
    qty: formatQtyInput(line.qty),
    qtyUnit: line.qtyUnit,
    total: formatLeiInput(line.lineTotalBani),
    discount: line.discountBani > 0 ? formatLeiInput(line.discountBani) : '',
    unitPrice: line.unitPriceBani !== undefined ? formatLeiInput(line.unitPriceBani) : '',
    ean: line.ean ?? '',
    packQty: line.pack ? formatQtyInput(line.pack.qty) : '',
    packUnit: line.pack?.unit ?? 'g',
    unitsPerPack: line.pack?.unitsPerPack !== undefined ? String(line.pack.unitsPerPack) : '',
    productId: line.productId,
    categoryId: line.categoryId,
    vatRate: line.vatRate,
    vatClass: line.vatClass,
    storeCategoryHint: line.storeCategoryHint,
    confidence: line.confidence,
    bbox: line.bbox,
    raw: line.raw,
  });
}

/** `HH:mm:ss` -> `HH:mm` when the seconds are zero, which is how people read a receipt time. */
const shortTime = (time: string) => time.replace(/^(\d{2}:\d{2}):00$/, '$1');

export function formFromDraft(draft: ReceiptDraft): ReceiptForm {
  const moment = draft.purchasedAt ? parsePurchasedAt(draft.purchasedAt) : undefined;
  return defined({
    id: draft.id,
    storeId: draft.storeId,
    status: draft.status,
    chain: draft.store.chain,
    storeName: draft.store.chain === 'unknown' ? (draft.store.name ?? '') : '',
    branchCode: draft.store.branchCode ?? '',
    city: draft.store.city ?? '',
    docType: draft.docType,
    documentNo: draft.documentNo ?? '',
    date: moment?.date ?? '',
    time: moment?.time ? shortTime(moment.time) : '',
    total: formatLeiInput(draft.totalBani),
    paid: draft.paidBani !== undefined ? formatLeiInput(draft.paidBani) : '',
    lines: [...draft.lines].sort((a, b) => a.idx - b.idx).map(lineFormFromDraft),
    vat: draft.vat,
    source: draft.source,
    extraction: draft.extraction,
  });
}

function readLine(form: LineForm): { line: DraftLine | undefined; errors: LineErrors } {
  const errors: LineErrors = {};

  const rawName = form.rawName.trim();
  if (rawName === '') errors.rawName = 'required';

  const qty = parseQtyInput(form.qty);
  if (qty === undefined) errors.qty = form.qty.trim() === '' ? 'required' : 'invalid';

  const lineTotalBani = parseLeiInput(form.total);
  if (lineTotalBani === undefined) errors.total = form.total.trim() === '' ? 'required' : 'invalid';

  let discountBani = 0;
  if (form.discount.trim() !== '') {
    const parsed = parseLeiInput(form.discount);
    if (parsed === undefined || parsed < 0) errors.discount = 'invalid';
    else discountBani = parsed;
  }

  let unitPriceBani: number | undefined;
  if (form.unitPrice.trim() !== '') {
    const parsed = parseLeiInput(form.unitPrice);
    if (parsed === undefined || parsed < 0) errors.unitPrice = 'invalid';
    else unitPriceBani = parsed;
  }

  let ean: string | undefined;
  if (form.ean.trim() !== '') {
    ean = parseEanInput(form.ean);
    if (ean === undefined) errors.ean = 'invalid';
  }

  let pack: PackChoice | undefined;
  if (form.packQty.trim() !== '') {
    const packQty = parseQtyInput(form.packQty);
    if (packQty === undefined) {
      errors.packQty = 'invalid';
    } else {
      pack = { qty: packQty, unit: form.packUnit };
      const count = form.unitsPerPack.trim();
      if (count !== '') {
        const units = /^\d+$/.test(count) ? Number(count) : 0;
        if (units >= 1 && units <= MAX_UNITS_PER_PACK) pack.unitsPerPack = units;
        else errors.unitsPerPack = 'invalid';
      }
    }
  }

  if (qty === undefined || lineTotalBani === undefined || Object.keys(errors).length > 0) {
    return { line: undefined, errors };
  }
  return {
    errors,
    line: defined({
      id: form.id,
      idx: form.idx,
      rawName,
      kind: form.kind,
      ean,
      qty,
      qtyUnit: form.qtyUnit,
      unitPriceBani,
      discountBani,
      lineTotalBani,
      vatRate: form.vatRate,
      vatClass: form.vatClass,
      storeCategoryHint: form.storeCategoryHint,
      pack,
      productId: form.kind === 'product' ? form.productId : undefined,
      categoryId: form.categoryId,
      confidence: form.confidence,
      bbox: form.bbox,
      raw: form.raw,
    }),
  };
}

const trimmed = (text: string): string | undefined => {
  const value = text.trim();
  return value === '' ? undefined : value;
};

/** Reads every field; invalid ones come back as `errors` and their lines are left out of `draft`. */
export function readForm(form: ReceiptForm): FormRead {
  const errors: FormErrors = { receipt: {}, lines: {} };

  const date = form.date.trim();
  const time = form.time.trim();
  let purchasedAt: string | undefined;
  if (date !== '') {
    if (date.length !== 10 || parsePurchasedAt(date) === undefined) {
      errors.receipt.date = 'invalid';
    } else if (time === '') {
      purchasedAt = date;
    } else if (isValidPurchasedAt(`${date}T${time}`)) {
      purchasedAt = `${date}T${time}`;
    } else {
      errors.receipt.time = 'invalid';
    }
  } else if (time !== '') {
    errors.receipt.date = 'required';
  }

  const totalBani = parseLeiInput(form.total);
  if (totalBani === undefined)
    errors.receipt.total = form.total.trim() === '' ? 'required' : 'invalid';

  let paidBani: number | undefined;
  if (form.paid.trim() !== '') {
    paidBani = parseLeiInput(form.paid);
    if (paidBani === undefined) errors.receipt.paid = 'invalid';
  }

  const lines: DraftLine[] = [];
  for (const lineForm of form.lines) {
    const read = readLine(lineForm);
    if (read.line) lines.push(read.line);
    if (Object.keys(read.errors).length > 0) errors.lines[lineForm.id] = read.errors;
  }

  const draft: ReceiptDraft = defined({
    id: form.id,
    storeId: form.storeId,
    status: form.status,
    store: defined({
      chain: form.chain,
      name: form.chain === 'unknown' ? trimmed(form.storeName) : undefined,
      branchCode: trimmed(form.branchCode),
      city: trimmed(form.city),
    }),
    docType: form.docType,
    documentNo: trimmed(form.documentNo),
    purchasedAt,
    totalBani: totalBani ?? 0,
    paidBani,
    vat: form.vat,
    lines,
    source: form.source,
    extraction: form.extraction,
  });

  const hasErrors = Object.keys(errors.receipt).length > 0 || Object.keys(errors.lines).length > 0;
  return { draft, errors, hasErrors };
}

export function blankLineForm(id: string, idx: number): LineForm {
  return {
    id,
    idx,
    rawName: '',
    kind: 'product',
    qty: '1',
    qtyUnit: 'buc',
    total: '',
    discount: '',
    unitPrice: '',
    ean: '',
    packQty: '',
    packUnit: 'g',
    unitsPerPack: '',
  };
}

/** Applies a patch to one line; changing the kind keeps the product mapping consistent. */
export function patchLine(form: ReceiptForm, id: string, patch: Partial<LineForm>): ReceiptForm {
  return {
    ...form,
    lines: form.lines.map((line) => {
      if (line.id !== id) return line;
      const next = { ...line, ...patch };
      if (patch.kind !== undefined && patch.kind !== line.kind) {
        if (patch.kind !== 'product') {
          delete next.productId;
          delete next.categoryId;
        } else if (next.categoryId === NON_PRODUCT_CATEGORY_ID) {
          delete next.categoryId;
        }
      }
      return next;
    }),
  };
}

export function addLine(form: ReceiptForm, id: string): ReceiptForm {
  const idx = form.lines.reduce((max, line) => Math.max(max, line.idx), -1) + 1;
  return { ...form, lines: [...form.lines, blankLineForm(id, idx)] };
}

export function removeLine(form: ReceiptForm, id: string): ReceiptForm {
  return { ...form, lines: form.lines.filter((line) => line.id !== id) };
}

/** Unmaps lines whose product no longer exists (deleted or merged since the receipt was saved). */
export function dropUnknownProducts(form: ReceiptForm, known: ReadonlySet<string>): ReceiptForm {
  if (form.lines.every((line) => line.productId === undefined || known.has(line.productId))) {
    return form;
  }
  return {
    ...form,
    lines: form.lines.map((line) => {
      if (line.productId === undefined || known.has(line.productId)) return line;
      const { productId: _gone, ...rest } = line;
      return rest;
    }),
  };
}

/**
 * Fills the mapping of lines that have no product from the catalog's suggestions (`mappings[i]`
 * belongs to `form.lines[i]`): an alias or EAN match sets the product, its category and a
 * remembered pack size the name lacks; a section header sets just the category. A line that
 * already has a product (the user's choice, or an earlier save) is left alone.
 */
export function applySuggestions(form: ReceiptForm, mappings: readonly LineMapping[]): ReceiptForm {
  return {
    ...form,
    lines: form.lines.map((line, index) => {
      const mapping = mappings[index];
      if (!mapping || line.kind !== 'product') return line;

      const next = { ...line };
      if (line.productId === undefined) {
        if (mapping.productId !== undefined) {
          next.productId = mapping.productId;
          if (mapping.categoryId !== undefined) next.categoryId = mapping.categoryId;
          // The remembered size belongs to that product, so it comes along with it.
          if (line.packQty.trim() === '' && mapping.pack) {
            next.packQty = formatQtyInput(mapping.pack.qty);
            next.packUnit = mapping.pack.unit;
            next.unitsPerPack =
              mapping.pack.unitsPerPack !== undefined ? String(mapping.pack.unitsPerPack) : '';
          }
        } else if (line.categoryId === undefined && mapping.categoryId !== undefined) {
          next.categoryId = mapping.categoryId;
        }
      }
      return next;
    }),
  };
}
