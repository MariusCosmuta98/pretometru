import { formatLei, formatMilliBani, unitPricing } from '@/domain';
import {
  formatLeiInput,
  formatQtyInput,
  parseLeiInput,
  parseQtyInput,
  type AckCode,
  type Analysis,
  type Blocker,
  type DraftLine,
  type FieldError,
  type FieldTarget,
  type LineField,
  type ReceiptField,
} from '@/import';
import { BASE_UNIT_LABELS, formatPurchasedAt } from '../labels';

export type ErrorCode = FieldError | 'not-positive';

const RECEIPT_FIELD_LABELS: Record<ReceiptField, string> = {
  date: 'Data',
  time: 'Ora',
  total: 'Totalul bonului',
  paid: 'Suma plătită',
};

const LINE_FIELD_LABELS: Record<LineField, string> = {
  rawName: 'Denumirea',
  qty: 'Cantitatea',
  total: 'Totalul liniei',
  discount: 'Reducerea',
  unitPrice: 'Prețul unitar',
  ean: 'EAN-ul',
  packQty: 'Mărimea ambalajului',
  unitsPerPack: 'Numărul de bucăți',
};

/** What to tell the user about an invalid or missing field. */
export function fieldErrorText(field: ReceiptField | LineField, error: ErrorCode): string {
  if (error === 'not-positive') return 'Totalul trebuie să fie mai mare ca 0.';
  if (error === 'required') {
    if (field === 'date') return 'Alege data bonului.';
    if (field === 'rawName') return 'Completează denumirea.';
    return 'Completează acest câmp.';
  }
  switch (field) {
    case 'date':
      return 'Data nu este validă.';
    case 'time':
      return 'Ora nu este validă.';
    case 'qty':
      return 'Cantitate invalidă (ex. 2 sau 0,920).';
    case 'packQty':
      return 'Mărime invalidă (ex. 425 sau 0,5).';
    case 'unitsPerPack':
      return 'Introdu un număr întreg, cel puțin 1.';
    case 'ean':
      return 'EAN invalid: 4 până la 14 cifre.';
    case 'rawName':
      return 'Completează denumirea.';
    case 'total':
    case 'paid':
    case 'discount':
    case 'unitPrice':
      return 'Sumă invalidă (ex. 12,50).';
  }
}

export function fieldDomId(target: FieldTarget): string {
  return target.scope === 'receipt'
    ? `receipt-${target.field}`
    : `line-${target.lineId}-${target.field}`;
}

export const ackDomId = (code: AckCode) => `ack-${code}`;

export const ADD_LINE_DOM_ID = 'add-line';

/** The element a blocker is about, so the screen can move focus to it. */
export function blockerDomId(blocker: Blocker): string {
  switch (blocker.kind) {
    case 'field':
      return fieldDomId(blocker.target);
    case 'no-lines':
      return ADD_LINE_DOM_ID;
    case 'ack':
      return ackDomId(blocker.code);
  }
}

const ACK_BLOCKER_TEXT: Record<AckCode, string> = {
  FUTURE_DATE: 'Confirmă că data din viitor este corectă.',
  DUPLICATE: 'Confirmă că acesta nu este un duplicat.',
  SUM_MISMATCH: 'Confirmă diferența dintre suma liniilor și total.',
};

/** One line of the "what is left to fix" list. */
export function blockerText(blocker: Blocker, lineNumber: (lineId: string) => number): string {
  switch (blocker.kind) {
    case 'no-lines':
      return 'Adaugă cel puțin o linie.';
    case 'ack':
      return ACK_BLOCKER_TEXT[blocker.code];
    case 'field': {
      const { target, error } = blocker;
      return target.scope === 'receipt'
        ? `${RECEIPT_FIELD_LABELS[target.field]}: ${fieldErrorText(target.field, error)}`
        : `Linia ${lineNumber(target.lineId)}, ${LINE_FIELD_LABELS[target.field].toLowerCase()}: ${fieldErrorText(target.field, error)}`;
    }
  }
}

/** The sentence next to a checkbox that accepts a warning. */
export function ackLabel(
  code: AckCode,
  context: { purchasedAt: string | undefined; differenceBani: number },
): string {
  switch (code) {
    case 'FUTURE_DATE':
      return `Confirm că data bonului (${formatPurchasedAt(context.purchasedAt)}) este corectă`;
    case 'DUPLICATE':
      return 'Confirm că este un bon diferit de cel deja salvat';
    case 'SUM_MISMATCH':
      return `Confirm că diferența de ${formatLei(Math.abs(context.differenceBani))} față de total este corectă`;
  }
}

type SumFacts = Pick<Analysis, 'differenceBani' | 'sumMatch' | 'toleranceBani'>;

const signedLei = (bani: number) => `${bani > 0 ? '+' : '−'}${formatLei(Math.abs(bani))}`;

/**
 * How the sum line ends. The sum line and the warnings panel (`noWarningsText`) tell the same
 * story from the same value, `Analysis.sumMatch`. Tests of other screens find the sum line by
 * "diferență" or "se potrivesc", one element each: keep those words out of the rest of the screen.
 */
export function sumStatusText({ differenceBani, sumMatch, toleranceBani }: SumFacts): string {
  const limit = `±${formatLei(toleranceBani)}`;
  switch (sumMatch) {
    case 'exact':
      return 'se potrivesc';
    case 'within-tolerance':
      return `diferență ${signedLei(differenceBani)}, acceptată (în limita de ${limit})`;
    case 'outside-tolerance':
      return `diferență ${signedLei(differenceBani)}, peste limita de ${limit}`;
  }
}

/** What the warnings panel says when it has no warning to list. */
export function noWarningsText({ differenceBani, sumMatch, toleranceBani }: SumFacts): string {
  const limit = `±${formatLei(toleranceBani)}`;
  switch (sumMatch) {
    case 'exact':
      return 'Nu am găsit nicio problemă: suma liniilor se potrivește cu totalul.';
    case 'within-tolerance':
      return `Nu am găsit nicio problemă: suma liniilor diferă de total cu ${signedLei(differenceBani)}, în limita acceptată de ${limit}.`;
    // Not reached with the real validation, which flags such a difference.
    case 'outside-tolerance':
      return `Suma liniilor diferă de total cu ${signedLei(differenceBani)}, peste limita acceptată de ${limit}.`;
  }
}

/** Rewrites a valid amount in its canonical form; leaves invalid text alone for the user to fix. */
export function normalizeLei(text: string): string {
  const bani = parseLeiInput(text);
  return bani === undefined ? text : formatLeiInput(bani);
}

export function normalizeQty(text: string): string {
  const qty = parseQtyInput(text);
  return qty === undefined ? text : formatQtyInput(qty);
}

/** What the line costs per unit, as `saveReceipt` will store it, so a wrong price is easy to spot. */
export function priceSummary(line: DraftLine | undefined): string | undefined {
  if (!line || line.kind !== 'product') return undefined;
  try {
    const { paidUnitBani, baseUnit, pricePerBaseMilliBani } = unitPricing({
      lineTotalBani: line.lineTotalBani,
      qty: line.qty,
      qtyUnit: line.qtyUnit,
      pack: line.pack ? { qty: line.pack.qty, unit: line.pack.unit } : undefined,
    });
    // Cheap pieces need more decimals to show a difference at all.
    const decimals = pricePerBaseMilliBani >= 100_000 ? 2 : pricePerBaseMilliBani >= 10_000 ? 3 : 4;
    const perBase = `${formatMilliBani(pricePerBaseMilliBani, decimals)} lei / ${BASE_UNIT_LABELS[baseUnit]}`;
    if (line.qtyUnit !== 'buc') return `Preț plătit: ${perBase}`;
    if (!line.pack) return `Preț plătit: ${formatLei(paidUnitBani)} / buc`;
    return `Preț plătit: ${formatLei(paidUnitBani)} / buc vândută · ${perBase}`;
  } catch {
    return undefined;
  }
}
