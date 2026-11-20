import { BaniSchema, type ParsedReceipt, type ParseWarning, type ReceiptSource } from '@/domain';
import { findAmounts } from '../plain-text/amounts';
import { readPurchasedAt } from '../plain-text/dates';
import { readItems } from '../plain-text/items';
import { readQuantityLine } from '../plain-text/quantity-line';
import { buildLine, sourceConfidence } from '../plain-text/receipt';
import { repairReceipt } from '../plain-text/repair';
import {
  isTotalsRow,
  readChangeRow,
  readPaymentRow,
  readSubtotalRow,
  readTotalRow,
} from '../plain-text/rows';
import { textLines, type TextLine } from '../plain-text/text-lines';
import { readVatRate } from '../plain-text/vat-rate';
import { engineForSource } from '../source';

export const LIDL_VERSION = '1.0.1';

const STORE = /\blidl\b/i;
// `2,000 BUC x 4,05`: Lidl prints the pieces with three decimals above every product.
const PIECES_LINE = /^[0-9OoIl|SBZ]+[.,][0-9OoIl|SBZ]{3}\s*buc/i;
const VAT_ROW =
  /^tva\s+(?<klass>[A-Z])\s+(?<rate>[0-9OoIl|SBZ]{1,2}(?:[.,][0-9OoIl|SBZ]{2})?)\s*%\s*(?<amount>.+)$/i;
const POSTAL_CITY = /^\d{5,6}\s+(\p{L}[\p{L}\s.-]*)$/u;

// Where the item list stops: the totals, the VAT table and the payments.
const endsItems = (text: string) => isTotalsRow(text) || VAT_ROW.test(text);

// The class letters Lidl prints next to the prices, used when the VAT table is not on the receipt.
const USUAL_CLASS_RATES: Readonly<Record<string, number>> = { A: 21, B: 11 };

interface VatRow {
  klass: string;
  /** As printed, without the `%`. */
  rate: string;
  vatBani: number;
}

function readVatRows(lines: readonly TextLine[]): VatRow[] {
  return lines.flatMap((line) => {
    const groups = VAT_ROW.exec(line.text)?.groups;
    const vatBani = groups?.amount === undefined ? undefined : findAmounts(groups.amount)[0]?.bani;
    if (!groups?.klass || !groups.rate || vatBani === undefined) return [];
    return [{ klass: groups.klass.toUpperCase(), rate: groups.rate, vatBani }];
  });
}

const sum = (amounts: readonly number[]) => amounts.reduce((total, amount) => total + amount, 0);
const defined = (value: number | undefined): value is number => value !== undefined;

/** The store name and the city of the postal address, printed above the items. */
function readHeader(lines: readonly TextLine[]) {
  const storeName = lines.find((line) => STORE.test(line.text))?.text;
  const city = lines
    .map((line) => POSTAL_CITY.exec(line.text)?.[1])
    .find((found) => found !== undefined)
    ?.trim();
  return { storeName, city };
}

/**
 * 0..1 evidence that `source` is a Lidl receipt (the app screenshot or a copy of its text): the
 * store name, the `n,000 BUC x price` line above every product, the `TVA A ... %` rows. Only Lidl's
 * own quantity format counts (a weighed `0,436 KG x 14,99` line is on many receipts), and one such
 * line alone is not enough to take a store's name away from the receipt.
 */
export function detectLidl(source: ReceiptSource): number {
  const lines = textLines(source);
  let score = lines.some((line) => STORE.test(line.text)) ? 0.6 : 0;
  const quantityLines = lines.filter(
    (line) => PIECES_LINE.test(line.text) && readQuantityLine(line.text),
  ).length;
  score += quantityLines >= 2 ? 0.4 : quantityLines === 1 ? 0.2 : 0;
  if (lines.some((line) => VAT_ROW.test(line.text))) score += 0.1;
  return Math.min(1, score);
}

export function parseLidl(source: ReceiptSource): ParsedReceipt {
  const lines = textLines(source);
  const stop = lines.findIndex((line) => endsItems(line.text));
  const end = stop < 0 ? lines.length : stop;
  const after = lines.slice(end);

  const { drafts, unreadable } = readItems(lines, end);
  const warnings: ParseWarning[] = unreadable.map((lineIdx) => ({
    code: 'LOW_CONFIDENCE',
    lineIdx,
    message:
      'Linia produsului nu a putut fi citită; s-au păstrat doar cantitatea și prețul unitar.',
  }));

  // The VAT table gives each class its rate. OCR can misread a rate (`11,80%` for 11,00%): the
  // nearest real rate is taken, with the class's usual rate and the printed VAT amount as tiebreak.
  const grossOfClass = new Map<string, number>();
  for (const { vatClass, lineTotalBani } of drafts) {
    if (vatClass) grossOfClass.set(vatClass, (grossOfClass.get(vatClass) ?? 0) + lineTotalBani);
  }
  const rateOfClass = new Map(Object.entries(USUAL_CLASS_RATES));
  const vat: Array<{ rate: number; vatBani: number }> = [];
  for (const row of readVatRows(after)) {
    const classRate = USUAL_CLASS_RATES[row.klass];
    const grossBani = grossOfClass.get(row.klass);
    const printed = row.rate.replace('.', ',');
    const reading = readVatRate(row.rate, {
      ...(classRate !== undefined && { classRate }),
      ...(grossBani !== undefined && { grossBani }),
      vatBani: row.vatBani,
    });
    if (!reading) {
      warnings.push({
        code: 'LOW_CONFIDENCE',
        message: `Cota TVA a clasei ${row.klass} (${printed}%) nu a putut fi citită.`,
      });
      continue;
    }
    rateOfClass.set(row.klass, reading.rate);
    vat.push({ rate: reading.rate, vatBani: row.vatBani });
    if (reading.repaired) {
      warnings.push({
        code: 'REPAIRED_DIGITS',
        message: `Cota TVA ${printed}% a fost corectată la ${reading.rate}%. Verifică în imagine.`,
      });
    }
  }

  const receiptLines = drafts.map((draft, idx) => {
    const vatRate = draft.vatClass === undefined ? undefined : rateOfClass.get(draft.vatClass);
    return buildLine(idx, { ...draft, ...(vatRate !== undefined && { vatRate }) });
  });

  // TOTAL, else the subtotal, else what was paid; the CARD/NUMERAR rows are the payments.
  const total = after.map((line) => readTotalRow(line.text)).find(defined);
  const subtotal = after.map((line) => readSubtotalRow(line.text)).find(defined);
  const payments = after.flatMap((line) => readPaymentRow(line.text)?.bani ?? []);
  const change = after.flatMap((line) => readChangeRow(line.text) ?? []);
  // Many payments or a silly change can add up beyond what the contract allows: then none is kept.
  const paid = payments.length === 0 ? undefined : sum(payments) - sum(change);
  const paidBani = paid !== undefined && BaniSchema.safeParse(paid).success ? paid : undefined;
  const grandTotalBani = total ?? subtotal ?? paidBani ?? 0;

  const { storeName, city } = readHeader(lines.slice(0, end));
  const { purchasedAt, warnings: dateWarnings } = readPurchasedAt(lines);
  warnings.push(...dateWarnings);
  const confidence = sourceConfidence(source);

  const receipt: ParsedReceipt = {
    schemaVersion: 1,
    chain: 'lidl',
    ...(storeName && { storeName }),
    ...(city && { branch: { city } }),
    docType: 'receipt',
    ...(purchasedAt && { purchasedAt }),
    currency: 'RON',
    totals: {
      grandTotalBani,
      ...(paidBani !== undefined && { paidBani }),
      ...(vat.length > 0 && { vat }),
    },
    lines: receiptLines,
    meta: {
      engine: engineForSource(source),
      parser: 'lidl',
      parserVersion: LIDL_VERSION,
      ...(confidence !== undefined && { confidence }),
      warnings,
    },
  };
  return repairReceipt(receipt);
}
