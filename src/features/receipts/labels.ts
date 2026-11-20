import {
  parsePurchasedAt,
  type BaseUnit,
  type DocType,
  type LineKind,
  type PackUnit,
  type QtyUnit,
  type ReceiptStatus,
  type WarningCode,
} from '@/domain';

export const LINE_KIND_LABELS: Record<LineKind, string> = {
  product: 'Produs',
  deposit: 'Garanție ambalaj',
  bag: 'Pungă',
  discount: 'Reducere',
  fee: 'Taxă',
};

export const QTY_UNIT_LABELS: Record<QtyUnit, string> = { buc: 'buc', kg: 'kg', l: 'l' };

export const PACK_UNIT_LABELS: Record<PackUnit, string> = {
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  buc: 'buc',
  m: 'm',
  role: 'role',
};

/** Price comparison units: "lei / rolă". */
export const BASE_UNIT_LABELS: Record<BaseUnit, string> = {
  kg: 'kg',
  l: 'l',
  buc: 'buc',
  role: 'rolă',
  m: 'm',
};

export const DOC_TYPE_LABELS: Record<DocType, string> = { receipt: 'Bon', invoice: 'Factură' };

export const STATUS_LABELS: Record<ReceiptStatus, string> = {
  draft: 'Ciornă',
  confirmed: 'Confirmat',
};

export const SOURCE_LABELS = {
  pdf: 'PDF',
  image: 'Poză',
  text: 'Text',
  manual: 'Manual',
} as const;

/** Short headings for the warnings panel; the detail comes from the warning's own (Romanian) message. */
export const WARNING_TITLES: Record<WarningCode, string> = {
  SUM_MISMATCH: 'Suma nu se potrivește',
  LINE_ARITHMETIC: 'Linie care nu se potrivește',
  VAT_MISMATCH: 'TVA nu se potrivește',
  FUTURE_DATE: 'Dată în viitor',
  MISSING_DATE: 'Lipsește data',
  MISSING_TOTAL: 'Lipsește totalul',
  UNKNOWN_CHAIN: 'Magazin necunoscut',
  LOW_CONFIDENCE: 'Citire nesigură',
  REPAIRED_DIGITS: 'Cifre corectate automat',
  DUPLICATE: 'Posibil duplicat',
};

const MONTHS = [
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie',
];

/** `2026-11-07T18:31:47` -> `07.11.2026 18:31`; a bare date stays a bare date. */
export function formatPurchasedAt(purchasedAt: string | undefined): string {
  const moment = purchasedAt ? parsePurchasedAt(purchasedAt) : undefined;
  if (!moment) return 'Fără dată';
  const [year, month, day] = moment.date.split('-');
  return `${day}.${month}.${year}${moment.time ? ` ${moment.time.slice(0, 5)}` : ''}`;
}

/** `2026-11` -> `noiembrie 2026`. */
export function formatMonth(month: string): string {
  const [year, number] = month.split('-');
  const name = MONTHS[Number(number) - 1];
  return name ? `${name} ${year}` : month;
}
