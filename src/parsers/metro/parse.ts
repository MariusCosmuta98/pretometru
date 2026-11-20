import {
  grossFromNet,
  mulDiv,
  parseBani,
  parsePackSize,
  type ParsedLine,
  type ParsedReceipt,
  type ParseWarning,
} from '@/domain';
import { lineKindOf } from '../line-kind';
import { pdfRows, type PdfCell, type PdfRow, type PdfTextSource } from '../pdf-rows';
import { parseQuantity, toPurchasedAt } from '../text';

export const METRO_VERSION = '1.0.0';

// An amount or count in a column: `4,12`, `3`, `2,350`, `1.234,56`, a discount `2,49-`.
const NUMBER = /^\d[\d.]*(?:,\d+)?-?$/;
// Printed after the name when the unit of measure is not the default (`... CAPSUNI  BUC`).
const MEASURE_UNIT = /^(BUC|KG|L|LT|ML|CL|G|GR|M|MP|ROL|ROLE|SET)$/i;
// The "Mod amb" column holds two letters (PC, BU, SI, PG, ...), never a unit of measure.
const isPackaging = (text: string): boolean => /^[A-Z]{2}$/.test(text) && !MEASURE_UNIT.test(text);
const VAT_RATE_CELL = /^(\d+(?:,\d+)?)\s*%$/;
const SELLER = /METRO\s+CASH\s*&\s*CARRY/i;
const INVOICE_TITLE = /^FACTURA\b/i;
const VAT_TABLE_LABEL = /^Total factura\b/i;
const PAYABLE_LABEL = /^Total de plata\b/i;

interface Field {
  text: string;
  x: number;
  right: number;
}

/**
 * Groups the text runs of a row into printed fields: the invoice is laid out in fixed-width
 * columns, so the words of one description are a character apart while columns are further apart.
 */
function fieldsOf(cells: readonly PdfCell[]): Field[] {
  const fields: Field[] = [];
  for (const cell of cells) {
    const last = fields.at(-1);
    const charWidth = (cell.right - cell.x) / Math.max(1, cell.text.length);
    if (last && cell.x - last.right < 1.5 * charWidth) {
      last.text += ` ${cell.text}`;
      last.right = cell.right;
    } else {
      fields.push({ text: cell.text, x: cell.x, right: cell.right });
    }
  }
  return fields;
}

interface Columns {
  /** Everything left of the numbers: EAN, description, unit of measure, packaging. */
  head: Field[];
  /** price, qty, value, [discount], value after discount, VAT %, total with VAT, units sold, unit price. */
  numbers: string[];
  hasDiscount: boolean;
}

/**
 * Anchors the columns from the right: eight numbers, nine when the line has a discount (the one
 * printed with a trailing minus, `2,49-`, in the fourth column). A wide quantity (`12,350`) can
 * sit a single space from the price, so a run of numbers is split into its tokens.
 */
function splitColumns(cells: readonly PdfCell[]): Columns | undefined {
  const tail: string[] = [];
  let split = cells.length;
  while (split > 0) {
    const parts = (cells[split - 1]?.text ?? '').split(' ');
    if (!parts.every((part) => NUMBER.test(part))) break;
    tail.unshift(...parts);
    split--;
  }
  if (tail.length < 8) return undefined;

  const hasDiscount = tail.length >= 9 && (tail[tail.length - 6] ?? '').endsWith('-');
  const extra = tail.length - (hasDiscount ? 9 : 8);
  return {
    head: [
      ...fieldsOf(cells.slice(0, split)),
      ...tail.slice(0, extra).map((text) => ({ text, x: 0, right: 0 })),
    ],
    numbers: tail.slice(extra),
    hasDiscount,
  };
}

interface Head {
  ean?: string;
  name: string;
  /** A measure-unit token that ends the description (`... CAPSUNI BUC`); the name keeps it. */
  unit?: string;
}

function readHead(head: Field[]): Head {
  const fields = [...head];
  let ean: string | undefined;
  const first = fields[0]?.text ?? '';
  if (/^\d+$/.test(first)) {
    // A code that is too short to be an EAN (the column can truncate it) is dropped, not guessed.
    if (/^\d{4,14}$/.test(first)) ean = first;
    fields.shift();
  }
  if (fields.length >= 2 && isPackaging(fields.at(-1)?.text ?? '')) fields.pop();
  const last = fields.at(-1)?.text.toUpperCase() ?? '';
  const unit = fields.length >= 2 && MEASURE_UNIT.test(last) ? last : undefined;
  const name = fields.map((field) => field.text).join(' ');
  return { ...(ean ? { ean } : {}), name, ...(unit ? { unit } : {}) };
}

interface ParsedRow {
  line: ParsedLine;
  warnings: ParseWarning[];
}

/** One invoice line: prices are ex-VAT; the line total (with VAT) is its own column. */
function readProductRow(row: PdfRow, idx: number): ParsedRow | undefined {
  const columns = splitColumns(row.cells);
  if (!columns || columns.head.length === 0) return undefined;
  const { head, numbers, hasDiscount } = columns;
  const at = (index: number) => numbers[index] ?? '';
  const offset = hasDiscount ? 1 : 0;

  const priceNet = parseBani(at(0));
  const qty = parseQuantity(at(1));
  const valueNet = parseBani(at(2));
  const discountNet = hasDiscount ? parseBani(at(3)) : 0;
  const discountedNet = parseBani(at(3 + offset));
  const vatText = at(4 + offset);
  const vatRate = /^\d+$/.test(vatText) ? Number(vatText) : undefined;
  const lineTotalBani = parseBani(at(5 + offset));
  const unitsSold = parseQuantity(at(6 + offset));

  const { ean, name, unit } = readHead(head);
  if (qty === undefined || lineTotalBani === undefined || vatRate === undefined || name === '') {
    return undefined;
  }

  const warnings: ParseWarning[] = [];
  const kind = lineKindOf(name, lineTotalBani);
  const measured = unit === 'KG' ? 'kg' : unit === 'L' || unit === 'LT' ? 'l' : 'buc';
  const line: ParsedLine = {
    idx,
    rawName: name,
    kind,
    qty,
    // A fractional quantity of pieces cannot exist: it is a weight.
    qtyUnit: measured === 'buc' && !Number.isInteger(qty) ? 'kg' : measured,
    lineTotalBani,
    vatRate,
  };
  if (ean) line.ean = ean;

  // The prices are ex-VAT, so there is no VAT-inclusive list price to report; the discount is
  // converted, as the contract asks.
  if (discountNet !== undefined && discountNet < 0) {
    line.discountBani = grossFromNet(-discountNet, vatRate);
  }

  if (kind === 'product' && line.qtyUnit === 'buc') {
    const size = parsePackSize(name);
    if (size) line.pack = { qty: size.qty, unit: size.unit };
    // "Unit. vanz." counts the consumer units in a sold pack (8 rolls): it must agree with a
    // counted size in the name.
    const counted = size?.unit === 'role' || size?.unit === 'buc';
    if (size && counted && unitsSold !== undefined && unitsSold > 1 && unitsSold !== size.qty) {
      warnings.push({
        code: 'LOW_CONFIDENCE',
        lineIdx: idx,
        message: `Linia „${name}”: ambalajul din denumire (${size.qty}) diferă de „Unit. vanz.” (${unitsSold}).`,
      });
    }
  }

  const problem = columnProblem({
    priceNet,
    qty,
    valueNet,
    discountNet,
    discountedNet,
    lineTotalBani,
    vatRate,
  });
  if (problem !== undefined) {
    warnings.push({
      code: 'LINE_ARITHMETIC',
      lineIdx: idx,
      message: `Linia „${name}”: coloanele facturii nu se potrivesc (${problem}).`,
    });
  }
  return { line, warnings };
}

interface PrintedColumns {
  priceNet: number | undefined;
  qty: number;
  valueNet: number | undefined;
  discountNet: number | undefined;
  discountedNet: number | undefined;
  lineTotalBani: number;
  vatRate: number;
}

/**
 * Cross-checks the invoice's own columns, which are all ex-VAT but the last: value = price x qty,
 * value after discount = value - discount, total with VAT = value after discount x (1 + VAT).
 * Returns what does not add up, or `undefined` when every identity holds.
 */
function columnProblem(columns: PrintedColumns): string | undefined {
  const { priceNet, qty, valueNet, discountNet, discountedNet, lineTotalBani, vatRate } = columns;
  if (valueNet === undefined || discountNet === undefined || discountedNet === undefined) {
    return 'sumă ilizibilă';
  }
  // The printed unit price is rounded to the ban: allow half a ban per unit of quantity.
  if (priceNet !== undefined) {
    const expected = mulDiv(Math.round(qty * 1000), priceNet, 1000);
    if (Math.abs(expected - valueNet) > 1 + Math.floor(qty / 2)) return 'preț x cantitate';
  }
  if (Math.abs(valueNet + discountNet - discountedNet) > 1) return 'valoare - discount';
  if (Math.abs(grossFromNet(discountedNet, vatRate) - lineTotalBani) > 1) return 'TVA';
  return undefined;
}

interface VatEntry {
  rate: number;
  netBani?: number;
  vatBani?: number;
  grossBani?: number;
}

/** `net | 21% | VAT | gross`, optionally preceded by the label (`Subtotal`, `Total factura`). */
function readVatRow(row: PdfRow): VatEntry | undefined {
  const texts = row.cells.map((cell) => cell.text);
  const at = texts.findIndex((text) => VAT_RATE_CELL.test(text));
  const rate = at < 0 ? undefined : VAT_RATE_CELL.exec(texts[at] ?? '')?.[1];
  if (rate === undefined) return undefined;
  const entry: VatEntry = { rate: Number(rate.replace(',', '.')) };
  const net = parseBani(texts[at - 1] ?? '');
  const vat = parseBani(texts[at + 1] ?? '');
  const gross = parseBani(texts[at + 2] ?? '');
  if (net !== undefined) entry.netBani = net;
  if (vat !== undefined) entry.vatBani = vat;
  if (gross !== undefined) entry.grossBani = gross;
  return entry;
}

/**
 * The per-rate VAT table printed under `Total factura` (the last block wins on multi-page
 * documents) and the index of the first row after it.
 */
function readVatTable(rows: PdfRow[]): { entries: VatEntry[]; next: number } {
  const labelAt = rows.findLastIndex((row) => VAT_TABLE_LABEL.test(row.text));
  if (labelAt < 0) return { entries: [], next: rows.length };
  const entries: VatEntry[] = [];
  let next = labelAt;
  for (; next < rows.length; next++) {
    const entry = readVatRow(rows[next] as PdfRow);
    if (!entry) break;
    entries.push(entry);
  }
  return { entries, next };
}

/** `309,54 | 53,87 | 363,41 | LEI` after the VAT table: net, VAT and gross of the whole invoice. */
function readInvoiceGross(rows: PdfRow[], from: number): number | undefined {
  for (const row of rows.slice(from, from + 6)) {
    const texts = row.cells.map((cell) => cell.text);
    if (texts.at(-1)?.toUpperCase() !== 'LEI') continue;
    const amounts = texts.slice(0, -1).map((text) => parseBani(text));
    if (amounts.length === 3) return amounts[2];
  }
  return undefined;
}

/** `Total de plata 363,41 LEI`: what is payable (and was paid) for the invoice. */
function readPayable(rows: PdfRow[]): number | undefined {
  const row = rows.findLast((candidate) => PAYABLE_LABEL.test(candidate.text));
  for (const cell of [...(row?.cells ?? [])].reverse()) {
    const bani = parseBani(cell.text);
    if (bani !== undefined) return bani;
  }
  return undefined;
}

interface Header {
  storeName?: string;
  city?: string;
  documentNo?: string;
  purchasedAt?: string;
}

const SALE_DATE = /Data\s+Vanzare:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/i;
const ISSUE_DATE = /Data\s+Emitere:\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})/i;

/** Seller, store, invoice number and sale date. The buyer block (name, address, client no.) is never read. */
function readHeader(rows: PdfRow[]): Header {
  const header: Header = {};
  for (const row of rows) {
    if (header.storeName === undefined && SELLER.test(row.text)) {
      const fields = fieldsOf(row.cells);
      header.storeName = fields[0]?.text;
      const city = /Cash\s*&\s*Carry\s+(.+)$/i.exec(fields[1]?.text ?? '')?.[1];
      if (city) header.city = city.trim();
    }
    const invoice = /\bFACTURA\s+NR\.?\s*(\d+)/i.exec(row.text);
    if (invoice?.[1] && header.documentNo === undefined) header.documentNo = invoice[1];
  }

  for (const pattern of [SALE_DATE, ISSUE_DATE]) {
    for (const row of rows) {
      const match = pattern.exec(row.text);
      if (!match) continue;
      header.purchasedAt = toPurchasedAt(
        { day: match[1] ?? '', month: match[2] ?? '', year: match[3] ?? '' },
        { hour: match[4] ?? '', minute: match[5] ?? '' },
      );
      break;
    }
    if (header.purchasedAt !== undefined) break;
  }
  return header;
}

/** 0..1 evidence that the rows are a METRO invoice: the seller, `FACTURA`, the column header, the totals. */
export function detectMetro(rows: PdfRow[]): number {
  let score = 0;
  if (rows.some((row) => SELLER.test(row.text))) score += 0.5;
  if (rows.some((row) => INVOICE_TITLE.test(row.text))) score += 0.15;
  if (rows.some((row) => /^Cod articol/i.test(row.text))) score += 0.15;
  if (rows.some((row) => VAT_TABLE_LABEL.test(row.text))) score += 0.1;
  if (rows.some((row) => PAYABLE_LABEL.test(row.text))) score += 0.1;
  return Math.min(1, score);
}

export function parseMetro(source: PdfTextSource): ParsedReceipt {
  const rows = pdfRows(source);
  const lines: ParsedLine[] = [];
  const warnings: ParseWarning[] = [];
  for (const row of rows) {
    const parsed = readProductRow(row, lines.length);
    if (!parsed) continue;
    lines.push(parsed.line);
    warnings.push(...parsed.warnings);
  }

  const header = readHeader(rows);
  const { entries: vat, next } = readVatTable(rows);
  const payableBani = readPayable(rows);
  const grandTotalBani = readInvoiceGross(rows, next) ?? payableBani;
  const branch = header.city ? { city: header.city } : undefined;

  return {
    schemaVersion: 1,
    chain: 'metro',
    ...(header.storeName ? { storeName: header.storeName } : {}),
    ...(branch ? { branch } : {}),
    docType: 'invoice',
    ...(header.documentNo ? { documentNo: header.documentNo } : {}),
    ...(header.purchasedAt ? { purchasedAt: header.purchasedAt } : {}),
    currency: 'RON',
    totals: {
      // A total that cannot be found is 0: validateReceipt reports MISSING_TOTAL.
      grandTotalBani: grandTotalBani ?? 0,
      ...(payableBani === undefined ? {} : { paidBani: payableBani }),
      ...(vat.length > 0 ? { vat } : {}),
    },
    lines,
    meta: { engine: 'pdfjs', parser: 'metro', parserVersion: METRO_VERSION, warnings },
  };
}
