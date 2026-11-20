import {
  formatLei,
  isFutureDate,
  mulDiv,
  parsePurchasedAt,
  vatFromGross,
  type ParsedLine,
  type ParsedReceipt,
  type ParseWarning,
} from '@/domain';

// Tolerances, in bani (plan §4 and docs/contracts.md).

/** Σ lines vs the printed TOTAL: some documents round VAT per rate (METRO is 1 ban off). */
export const SUM_TOLERANCE_BANI = 5;
/** qty × unit price - discount vs the line total. */
export const LINE_TOLERANCE_BANI = 1;
/** Σ lines of one VAT rate vs the printed total of that rate: the same rounding as the grand total. */
export const VAT_TOLERANCE_BANI = SUM_TOLERANCE_BANI;
/** A printed VAT amount vs the VAT derived from its gross (or base + VAT vs gross). */
export const VAT_AMOUNT_TOLERANCE_BANI = 2;

const isAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

// Messages are user-facing (review screen), hence Romanian. They must not throw on broken amounts.
const lei = (bani: number): string => (isAmount(bani) ? formatLei(bani) : String(bani));
const formatQty = (qty: number): string => String(qty).replace('.', ',');
// `vatFromGross` rejects anything but whole percentages.
const isWholeRate = (rate: number): boolean => Number.isInteger(rate) && rate >= 0 && rate <= 100;

function formatPurchasedAt(purchasedAt: string): string {
  const moment = parsePurchasedAt(purchasedAt);
  if (!moment) return purchasedAt;
  const [year, month, day] = moment.date.split('-');
  return `${day}.${month}.${year}${moment.time ? ` ${moment.time.slice(0, 5)}` : ''}`;
}

/** Σ `lineTotalBani` over every printed line, including deposits, bags and discount lines. */
export function sumOfLines(receipt: ParsedReceipt): number {
  let sum = 0;
  for (const line of receipt.lines) {
    if (isAmount(line.lineTotalBani)) sum += line.lineTotalBani;
  }
  return sum;
}

/**
 * Parsers that cannot find the total set `grandTotalBani` to 0 (the field is required). A zero
 * total over lines that are worth money, or over no lines at all, is "missing", not "0,00 lei".
 */
export function isTotalMissing(receipt: ParsedReceipt): boolean {
  const total = receipt.totals.grandTotalBani;
  if (!isAmount(total)) return true;
  return total === 0 && (receipt.lines.length === 0 || sumOfLines(receipt) !== 0);
}

export function checkMissingTotal(receipt: ParsedReceipt): ParseWarning[] {
  return isTotalMissing(receipt)
    ? [{ code: 'MISSING_TOTAL', message: 'Totalul bonului nu a putut fi citit.' }]
    : [];
}

/**
 * SUM_MISMATCH: Σ lines vs the printed TOTAL (±5 bani), and `paidBani` vs TOTAL - voucher when
 * both were printed. A missing total is reported by `checkMissingTotal` instead.
 */
export function checkSumMismatch(receipt: ParsedReceipt): ParseWarning[] {
  if (isTotalMissing(receipt)) return [];
  const { grandTotalBani: total, voucherBani, paidBani } = receipt.totals;
  const warnings: ParseWarning[] = [];

  const sum = sumOfLines(receipt);
  if (Math.abs(sum - total) > SUM_TOLERANCE_BANI) {
    warnings.push({
      code: 'SUM_MISMATCH',
      message: `Suma liniilor (${lei(sum)}) diferă de totalul bonului (${lei(total)}) cu ${lei(Math.abs(sum - total))}.`,
    });
  }

  if (
    isAmount(voucherBani) &&
    isAmount(paidBani) &&
    Math.abs(total - voucherBani - paidBani) > SUM_TOLERANCE_BANI
  ) {
    warnings.push({
      code: 'SUM_MISMATCH',
      message: `Suma plătită (${lei(paidBani)}) nu corespunde totalului (${lei(total)}) minus tichetul (${lei(voucherBani)}).`,
    });
  }
  return warnings;
}

/**
 * The line total that the printed quantity, unit price and discount imply, rounded to the ban.
 * `undefined` when the line has no (usable) unit price: nothing to cross-check. A unit price is
 * only reported when it is printed, so there is no rounding drift to allow for beyond 1 ban.
 */
export function expectedLineTotal(line: ParsedLine): number | undefined {
  const { qty, unitPriceBani, discountBani = 0 } = line;
  if (!isAmount(unitPriceBani) || !isAmount(discountBani)) return undefined;
  const qtyMilli = Math.round(qty * 1000);
  if (!Number.isSafeInteger(qtyMilli) || qtyMilli <= 0) return undefined;
  try {
    return mulDiv(qtyMilli, unitPriceBani, 1000) - discountBani;
  } catch {
    return undefined;
  }
}

/** LINE_ARITHMETIC: qty × unit price - discount vs the line total (±1 ban). */
export function checkLineArithmetic(receipt: ParsedReceipt): ParseWarning[] {
  const warnings: ParseWarning[] = [];
  for (const line of receipt.lines) {
    const expected = expectedLineTotal(line);
    if (expected === undefined || !isAmount(line.lineTotalBani)) continue;
    if (Math.abs(expected - line.lineTotalBani) <= LINE_TOLERANCE_BANI) continue;

    const discount = line.discountBani ? ` − ${lei(line.discountBani)}` : '';
    warnings.push({
      code: 'LINE_ARITHMETIC',
      lineIdx: line.idx,
      message: `Linia „${line.rawName}”: ${formatQty(line.qty)} × ${lei(line.unitPriceBani ?? 0)}${discount} = ${lei(expected)}, dar totalul liniei este ${lei(line.lineTotalBani)}.`,
    });
  }
  return warnings;
}

/**
 * VAT_MISMATCH: the printed per-rate table (`totals.vat`) against itself (base + VAT = gross, VAT
 * = gross × rate / (100 + rate)) and against the VAT-inclusive lines of each rate. Lines are only
 * compared when every line carries its rate; without a printed table there is nothing to check.
 */
export function checkVatTotals(receipt: ParsedReceipt): ParseWarning[] {
  const printed = receipt.totals.vat ?? [];
  if (printed.length === 0) return [];

  const warnings: ParseWarning[] = [];
  const mismatch = (message: string) => warnings.push({ code: 'VAT_MISMATCH', message });

  const everyLineRated = receipt.lines.every((line) => typeof line.vatRate === 'number');
  const linesByRate = new Map<number, number>();
  if (everyLineRated) {
    for (const line of receipt.lines) {
      if (line.vatRate === undefined || !isAmount(line.lineTotalBani)) continue;
      linesByRate.set(line.vatRate, (linesByRate.get(line.vatRate) ?? 0) + line.lineTotalBani);
    }
  }

  for (const entry of printed) {
    const { rate, grossBani, netBani, vatBani } = entry;
    if (!Number.isFinite(rate)) continue;
    const label = `TVA ${formatQty(rate)}%`;

    if (isAmount(netBani) && isAmount(vatBani) && isAmount(grossBani)) {
      if (Math.abs(netBani + vatBani - grossBani) > VAT_AMOUNT_TOLERANCE_BANI) {
        mismatch(
          `${label}: baza (${lei(netBani)}) plus TVA (${lei(vatBani)}) nu dă totalul tipărit (${lei(grossBani)}).`,
        );
      }
    }
    if (isAmount(grossBani) && isAmount(vatBani) && isWholeRate(rate)) {
      if (Math.abs(vatFromGross(grossBani, rate) - vatBani) > VAT_AMOUNT_TOLERANCE_BANI) {
        mismatch(
          `${label}: valoarea TVA (${lei(vatBani)}) nu corespunde totalului tipărit (${lei(grossBani)}).`,
        );
      }
    }
    if (!everyLineRated) continue;

    const linesGross = linesByRate.get(rate) ?? 0;
    const printedGross =
      grossBani ?? (isAmount(netBani) && isAmount(vatBani) ? netBani + vatBani : undefined);
    if (isAmount(printedGross)) {
      if (Math.abs(linesGross - printedGross) > VAT_TOLERANCE_BANI) {
        mismatch(
          `${label}: liniile însumează ${lei(linesGross)}, dar bonul tipărește ${lei(printedGross)}.`,
        );
      }
    } else if (isAmount(vatBani) && isWholeRate(rate)) {
      if (Math.abs(vatFromGross(linesGross, rate) - vatBani) > VAT_AMOUNT_TOLERANCE_BANI) {
        mismatch(
          `${label}: liniile dau TVA ${lei(vatFromGross(linesGross, rate))}, dar bonul tipărește ${lei(vatBani)}.`,
        );
      }
    }
  }

  for (const [rate, linesGross] of linesByRate) {
    if (rate > 0 && linesGross !== 0 && !printed.some((entry) => entry.rate === rate)) {
      mismatch(
        `Liniile au cota TVA ${formatQty(rate)}% (${lei(linesGross)}), care lipsește din sumarul TVA al bonului.`,
      );
    }
  }
  return warnings;
}

/** MISSING_DATE: no purchase date, or one that is not a real calendar date. */
export function checkMissingDate(receipt: ParsedReceipt): ParseWarning[] {
  const { purchasedAt } = receipt;
  if (purchasedAt === undefined) {
    return [{ code: 'MISSING_DATE', message: 'Data bonului nu a putut fi citită.' }];
  }
  return parsePurchasedAt(purchasedAt)
    ? []
    : [{ code: 'MISSING_DATE', message: `Data bonului („${purchasedAt}”) nu este validă.` }];
}

/** FUTURE_DATE: the purchase is after `now` (injected; the Lidl sample is dated in the future). */
export function checkFutureDate(receipt: ParsedReceipt, now: Date): ParseWarning[] {
  const { purchasedAt } = receipt;
  if (purchasedAt === undefined || Number.isNaN(now.getTime())) return [];
  return isFutureDate(purchasedAt, now)
    ? [
        {
          code: 'FUTURE_DATE',
          message: `Data bonului (${formatPurchasedAt(purchasedAt)}) este în viitor.`,
        },
      ]
    : [];
}

/**
 * Every arithmetic and plausibility check of plan §4 except DUPLICATE (it needs the database, so
 * the import orchestrator adds it). Pure: the clock is injected.
 */
export function validateReceipt(receipt: ParsedReceipt, opts: { now: Date }): ParseWarning[] {
  return [
    ...checkMissingTotal(receipt),
    ...checkSumMismatch(receipt),
    ...checkLineArithmetic(receipt),
    ...checkVatTotals(receipt),
    ...checkMissingDate(receipt),
    ...checkFutureDate(receipt, opts.now),
  ];
}
