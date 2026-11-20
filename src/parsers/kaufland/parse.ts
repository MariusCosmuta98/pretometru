import { parsePackSize, type ParsedLine, type ParsedReceipt, type ParseWarning } from '@/domain';
import { lineKindOf } from '../line-kind';
import { pdfRows, type PdfCell, type PdfRow, type PdfTextSource } from '../pdf-rows';
import { parseAmount, parseQuantity, toPurchasedAt } from '../text';

export const KAUFLAND_VERSION = '1.0.0';

// Titles repeated at the top of every page; never part of the item list.
const NOISE = /^(Receipt copy|Pre[țţt]\s*RON)$/i;
const PRICE_HEADER = /^Pre[țţt]\s*RON$/i;
const TOTAL_LABEL = /^TOTAL$/i;
const VAT_HEADER = /^TVA\s*%$/i;
const VAT_CLASS_ROW = /^([A-Z])\s*=\s*(\d+(?:[.,]\d+)?)\s*%$/;
const VOUCHER_LABEL = /^tichet/i;
const CARD_PAYMENT_LABEL = /^plat[ăa]\s+card$/i;
// Where the item list stops: the total and what follows it (voucher, payment, change, VAT table).
const END_OF_ITEMS = /^(TOTAL|TVA\s*%|tichet.*|plat[ăa]\s.*|rest)$/i;
const AMOUNT_WITH_CLASS = /^(-?\d[\d.]*,\d{2})(?:\s+([A-Z]))?$/;
const MULTIPLE = /^(\d+)\s*\*\s*(\d+[.,]\d{2})$/;
const WEIGHT = /^(\d+[.,]\d{1,3})\s*KG$/i;

const labelOf = (row: PdfRow): string => row.cells[0]?.text ?? '';

interface Amount {
  bani: number;
  vatClass?: string;
}

function readAmount(text: string): Amount | undefined {
  const match = AMOUNT_WITH_CLASS.exec(text);
  const bani = match?.[1] === undefined ? undefined : parseAmount(match[1]);
  if (bani === undefined) return undefined;
  return match?.[2] === undefined ? { bani } : { bani, vatClass: match[2] };
}

interface Split {
  amount: Amount;
  /** The cells before the amount. */
  leading: PdfCell[];
}

/** A row's trailing amount (`15,57 C`, or just `208,79`) and the cells before it. */
function splitAmount(row: PdfRow): Split | undefined {
  const cells = [...row.cells];
  let last = cells.pop();
  // pdf.js may put the VAT class in an item of its own.
  const klass = last && /^[A-Z]$/.test(last.text) ? last.text : undefined;
  if (klass) last = cells.pop();
  const amount = last ? readAmount(last.text) : undefined;
  if (!amount) return undefined;
  return { amount: klass ? { ...amount, vatClass: klass } : amount, leading: cells };
}

type Detail =
  { type: 'multiple'; qty: number; unitPriceBani: number } | { type: 'weight'; qtyKg: number };

/** `3 * 5,19` (several units at a printed price) or `0,920 KG` (a weighed item). */
function readDetail(text: string): Detail | undefined {
  const multiple = MULTIPLE.exec(text);
  if (multiple?.[1] !== undefined && multiple[2] !== undefined) {
    const qty = Number(multiple[1]);
    const unitPriceBani = parseAmount(multiple[2]);
    const valid = unitPriceBani !== undefined && qty > 0 && qty <= 1_000_000;
    return valid ? { type: 'multiple', qty, unitPriceBani } : undefined;
  }
  const weight = WEIGHT.exec(text);
  const qtyKg = weight?.[1] === undefined ? undefined : parseQuantity(weight[1]);
  return qtyKg === undefined ? undefined : { type: 'weight', qtyKg };
}

function buildLine(
  idx: number,
  name: string,
  detail: Detail | undefined,
  amount: Amount,
  hint: string | undefined,
  vatRates: ReadonlyMap<string, number>,
): ParsedLine {
  const kind = lineKindOf(name, amount.bani);
  const line: ParsedLine = {
    idx,
    rawName: name,
    kind,
    qty: 1,
    qtyUnit: 'buc',
    lineTotalBani: amount.bani,
  };

  if (detail?.type === 'multiple') {
    line.qty = detail.qty;
    line.unitPriceBani = detail.unitPriceBani;
  } else if (detail?.type === 'weight') {
    // A weighed item prints the weight and the line total only: no unit price.
    line.qty = detail.qtyKg;
    line.qtyUnit = 'kg';
  }

  if (amount.vatClass) {
    line.vatClass = amount.vatClass;
    const rate = vatRates.get(amount.vatClass);
    if (rate !== undefined) line.vatRate = rate;
  }
  if (hint) line.storeCategoryHint = hint;

  if (kind === 'product' && line.qtyUnit === 'buc') {
    const size = parsePackSize(name);
    if (size) line.pack = { qty: size.qty, unit: size.unit };
  }
  return line;
}

/**
 * The item list between the `Preț RON` header and `TOTAL`. Section headers (`Alimente`,
 * `Mopro/Brânză/Ouă`) are rows with text only; an item is its name and a `qty * price` or
 * `weight KG` detail plus the line total and VAT class, on one row or on two.
 */
function readItems(rows: PdfRow[], vatRates: ReadonlyMap<string, number>) {
  const lines: ParsedLine[] = [];
  const warnings: ParseWarning[] = [];
  const splits = rows.map(splitAmount);
  let hint: string | undefined;
  let pendingName: string | undefined;

  rows.forEach((row, index) => {
    if (NOISE.test(row.text)) return;
    const split = splits[index];

    if (!split) {
      const nextFirst = splits[index + 1]?.leading[0];
      if (nextFirst && readDetail(nextFirst.text)) {
        pendingName = row.text;
      } else {
        hint = row.text;
        pendingName = undefined;
      }
      return;
    }

    const { amount, leading } = split;
    const detailAt = leading.findIndex((cell) => readDetail(cell.text) !== undefined);
    const detail = detailAt < 0 ? undefined : readDetail(leading[detailAt]?.text ?? '');
    const ownName = (detailAt < 0 ? leading : leading.slice(0, detailAt))
      .map((cell) => cell.text)
      .join(' ');
    const name = ownName || pendingName || '';
    pendingName = undefined;

    const idx = lines.length;
    if (name === '') {
      warnings.push({
        code: 'LOW_CONFIDENCE',
        lineIdx: idx,
        message: 'Linie fără denumire pe bon; verifică produsul.',
      });
    }
    lines.push(buildLine(idx, name || 'Produs necunoscut', detail, amount, hint, vatRates));
  });

  return { lines, warnings };
}

interface VatEntry {
  rate: number;
  grossBani?: number;
  netBani?: number;
  vatBani?: number;
}

/** The `TVA % | Brut | Net | Tva` table: one entry per class (`B=21,00%`), in the printed column order. */
function readVatTable(rows: PdfRow[], headerAt: number): Map<string, VatEntry> {
  const printed = (rows[headerAt]?.cells ?? []).slice(1).map((cell) => cell.text.toLowerCase());
  const order = printed.length === 3 ? printed : ['brut', 'net', 'tva'];
  const table = new Map<string, VatEntry>();

  for (const row of rows.slice(headerAt + 1)) {
    const label = VAT_CLASS_ROW.exec(labelOf(row));
    if (!label?.[1] || label[2] === undefined) break;
    const rate = Number(label[2].replace(',', '.'));
    if (!(rate >= 0 && rate <= 100)) break;
    const entry: VatEntry = { rate };
    row.cells.slice(1).forEach((cell, column) => {
      const bani = parseAmount(cell.text);
      if (bani === undefined) return;
      const name = order[column];
      if (name === 'brut') entry.grossBani = bani;
      else if (name === 'net') entry.netBani = bani;
      else if (name === 'tva') entry.vatBani = bani;
    });
    table.set(label[1], entry);
  }
  return table;
}

const lastAmount = (row: PdfRow): number | undefined => splitAmount(row)?.amount.bani;

interface Footer {
  purchasedAt?: string;
  documentNo?: string;
  branchCode?: string;
  city?: string;
}

const RECEIPT_DATE =
  /Data:\s*(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s+Timp:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/;
const SLIP_DATE = /Date:\s*(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:\s+Time:\s*(\d{1,2}):(\d{2}))?/;
const MERCHANT = /^Kaufland\s+RO\s+(\d+)$/i;
const POSTAL_CITY = /^\d{5,6}\s+(\p{L}[\p{L}\s.-]*)$/u;

/**
 * Date, receipt number and store, from the footer and the card slip's merchant block. Nothing
 * about the buyer or the payment card is read.
 */
function readFooter(rows: PdfRow[]): Footer {
  const footer: Footer = {};

  rows.forEach((row, index) => {
    const date = RECEIPT_DATE.exec(row.text);
    if (date && footer.purchasedAt === undefined) {
      footer.purchasedAt = toPurchasedAt(
        { day: date[1] ?? '', month: date[2] ?? '', year: date[3] ?? '' },
        { hour: date[4] ?? '', minute: date[5] ?? '', ...(date[6] ? { second: date[6] } : {}) },
      );
    }
    const receiptNo = /\bBon:\s*(\d+)/.exec(row.text);
    if (receiptNo?.[1] && footer.documentNo === undefined) footer.documentNo = receiptNo[1];
    const store = /\bMagazin:\s*(\d+)/.exec(row.text);
    if (store?.[1] && footer.branchCode === undefined) footer.branchCode = store[1];

    const merchant = MERCHANT.exec(row.text);
    if (merchant?.[1] && footer.city === undefined) {
      footer.branchCode ??= merchant[1];
      // The address follows: street (skipped), then postal code and city.
      for (const next of rows.slice(index + 1, index + 4)) {
        const city = POSTAL_CITY.exec(next.text)?.[1];
        if (city) {
          footer.city = city.trim();
          break;
        }
      }
    }
  });

  if (footer.purchasedAt === undefined) {
    for (const row of rows) {
      const slip = SLIP_DATE.exec(row.text);
      if (slip) {
        footer.purchasedAt = toPurchasedAt(
          { day: slip[1] ?? '', month: slip[2] ?? '', year: slip[3] ?? '' },
          slip[4] === undefined ? undefined : { hour: slip[4], minute: slip[5] ?? '' },
        );
        break;
      }
    }
  }
  return footer;
}

/** 0..1 evidence that the rows are a Kaufland receipt: the name, the table header, TOTAL, the VAT table. */
export function detectKaufland(rows: PdfRow[]): number {
  let score = 0;
  if (rows.some((row) => /kaufland/i.test(row.text))) score += 0.5;
  if (rows.some((row) => PRICE_HEADER.test(row.text))) score += 0.2;
  if (rows.some((row) => TOTAL_LABEL.test(labelOf(row)) && lastAmount(row) !== undefined)) {
    score += 0.1;
  }
  if (rows.some((row) => VAT_HEADER.test(labelOf(row)))) score += 0.1;
  if (rows.some((row) => VAT_CLASS_ROW.test(labelOf(row)))) score += 0.1;
  return Math.min(1, score);
}

export function parseKaufland(source: PdfTextSource): ParsedReceipt {
  const rows = pdfRows(source);
  const start = rows.findIndex((row) => PRICE_HEADER.test(row.text)) + 1;
  const stop = rows.findIndex((row, index) => index >= start && END_OF_ITEMS.test(labelOf(row)));
  const end = stop < 0 ? rows.length : stop;

  const vatHeaderAt = rows.findIndex((row, index) => index >= end && VAT_HEADER.test(labelOf(row)));
  const vatTable = vatHeaderAt < 0 ? new Map<string, VatEntry>() : readVatTable(rows, vatHeaderAt);
  const vatRates = new Map([...vatTable].map(([vatClass, entry]) => [vatClass, entry.rate]));

  const { lines, warnings } = readItems(rows.slice(start, end), vatRates);

  let grandTotalBani: number | undefined;
  let voucherBani: number | undefined;
  let cardBani: number | undefined;
  for (const row of rows.slice(end)) {
    const label = labelOf(row);
    const amount = lastAmount(row);
    if (amount === undefined) continue;
    if (TOTAL_LABEL.test(label)) grandTotalBani ??= amount;
    else if (VOUCHER_LABEL.test(label)) voucherBani ??= amount;
    else if (CARD_PAYMENT_LABEL.test(label)) cardBani = (cardBani ?? 0) + amount;
  }
  const paidBani =
    cardBani ??
    (grandTotalBani === undefined || voucherBani === undefined
      ? undefined
      : grandTotalBani - voucherBani);

  const footer = readFooter(rows);
  const branch = {
    ...(footer.branchCode ? { code: footer.branchCode } : {}),
    ...(footer.city ? { city: footer.city } : {}),
  };

  return {
    schemaVersion: 1,
    chain: 'kaufland',
    ...(Object.keys(branch).length > 0 ? { branch } : {}),
    docType: 'receipt',
    ...(footer.documentNo ? { documentNo: footer.documentNo } : {}),
    ...(footer.purchasedAt ? { purchasedAt: footer.purchasedAt } : {}),
    currency: 'RON',
    totals: {
      // A total that cannot be found is 0: validateReceipt reports MISSING_TOTAL.
      grandTotalBani: grandTotalBani ?? 0,
      ...(voucherBani === undefined ? {} : { voucherBani }),
      ...(paidBani === undefined ? {} : { paidBani }),
      ...(vatTable.size > 0 ? { vat: [...vatTable.values()] } : {}),
    },
    lines,
    meta: { engine: 'pdfjs', parser: 'kaufland', parserVersion: KAUFLAND_VERSION, warnings },
  };
}
