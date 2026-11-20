import { formatBani, type ParsedLine, type ParsedReceipt, type ParseWarning } from '@/domain';
import {
  checkLineArithmetic,
  checkSumMismatch,
  checkVatTotals,
  expectedLineTotal,
  isTotalMissing,
  LINE_TOLERANCE_BANI,
  SUM_TOLERANCE_BANI,
  sumOfLines,
} from '../validate';

/**
 * OCR digit repair (plan §4). When a receipt read by OCR does not add up, look for the fewest
 * corrections of **confusable digits** (0↔8, 5↔6↔9, 1↔7) that make it add up, and apply them only
 * when that fix is **unique**. Otherwise nothing is changed and, when several fixes are equally
 * good, the lines that could hold the error are reported so the review screen can show their crops.
 *
 * "Adds up" is `../validate`, not a second implementation: a receipt without SUM_MISMATCH and
 * LINE_ARITHMETIC is returned untouched, and a repaired one passes both checks.
 *
 * What may change:
 * - a line that prints a unit price and fails `qty × unit price = total`: any of its three numbers
 *   (a line that holds is never touched: two consistent misreads in one line are not a thing);
 * - one more number, beyond what those lines need: the total of a line that prints no unit price,
 *   or the receipt total, because the sum of the lines has to come out right too.
 * So a receipt whose lines all hold gets at most one correction, and each violated line adds one.
 *
 * Which fix wins: the sum must come out exact when it was off (a receipt that was within the 5 bani
 * tolerance may not get worse), then the fewest digits changed, then the closest sum, then the
 * fewest VAT warnings. A tie for the best is "ambiguous" and nothing is changed.
 *
 * A repair is evidence, not proof. It is exact when the real error is a confusable digit; when it
 * is something else (a digit that was lost, a 3 read as a 9) a coincidental fix can still be the
 * only one, so every repair is reported as REPAIRED_DIGITS on the line it touched, with the old and
 * the new value, for the review screen.
 */

export type Confusions = Readonly<Record<string, string>>;

function symmetric(pairs: readonly string[]): Confusions {
  const table: Record<string, string> = {};
  for (const [a = '', b = ''] of pairs) {
    table[a] = (table[a] ?? '') + b;
    table[b] = (table[b] ?? '') + a;
  }
  return table;
}

/** Digits that Tesseract confuses on receipts (plan §4). */
export const CONFUSABLE_DIGITS: Confusions = symmetric(['08', '56', '59', '69', '17']);

/** Most digit corrections in one receipt: a repair needs evidence, and more digits mean less of it. */
export const MAX_CORRECTIONS = 3;
// The search is cheap for a real receipt; this only bounds the work on garbage input.
const MAX_LINES = 80;
const MAX_SUSPECT_LINES = 5;
const MAX_QTY = 1_000_000;
// The domain bounds every amount to ±10,000,000 RON (1e9 bani); a quantity in thousandths is
// bounded the same way by MAX_QTY. A correction never leaves that range.
const MAX_VALUE = 1_000_000_000;

export interface Alternative {
  value: number;
  /** Digits changed. */
  cost: number;
}

/**
 * Every value that differs from `value` in at most `maxCost` digits, each changed to a digit it is
 * confused with. The value is padded to `width` digits first, so `0,50` (50) can become `8,50`.
 * A negative value keeps its sign. A number never gains a leading zero beyond that width (`8007`
 * does not become `0007`): no receipt prints `00,07`, so that is not a misread but a lost digit.
 */
export function digitAlternatives(value: number, width: number, maxCost: number): Alternative[] {
  if (!Number.isSafeInteger(value)) return [];
  const sign = value < 0 ? -1 : 1;
  const original = String(Math.abs(value)).padStart(width, '0').split('');
  const found: Alternative[] = [];

  const walk = (from: number, digits: string[], cost: number) => {
    const shrunk = digits[0] === '0' && digits.length > width;
    if (cost > 0 && !shrunk) found.push({ value: sign * Number(digits.join('')), cost });
    if (cost === maxCost) return;
    for (let position = from; position < digits.length; position++) {
      for (const replacement of CONFUSABLE_DIGITS[original[position] ?? ''] ?? '') {
        const next = digits.slice();
        next[position] = replacement;
        walk(position + 1, next, cost + 1);
      }
    }
  };
  walk(0, original, 0);
  return found.filter(
    (alternative) =>
      Number.isSafeInteger(alternative.value) && Math.abs(alternative.value) <= MAX_VALUE,
  );
}

type Target = { kind: 'qty' | 'unit' | 'total'; position: number } | { kind: 'grand' };

interface Edit {
  target: Target;
  /** Bani, or thousandths for a quantity. */
  to: number;
}

interface Move {
  edits: Edit[];
  cost: number;
  /** Change of this line's total (0 when only its unit price or quantity moved). */
  dLineTotal: number;
  dGrand: number;
}

function applyEdits(receipt: ParsedReceipt, edits: readonly Edit[]): ParsedReceipt {
  const lines = receipt.lines.slice();
  let grandTotalBani = receipt.totals.grandTotalBani;
  for (const { target, to } of edits) {
    if (target.kind === 'grand') {
      grandTotalBani = to;
      continue;
    }
    const line = lines[target.position];
    if (!line) continue;
    lines[target.position] =
      target.kind === 'total'
        ? { ...line, lineTotalBani: to }
        : target.kind === 'unit'
          ? { ...line, unitPriceBani: to }
          : { ...line, qty: to / 1000 };
  }
  return { ...receipt, lines, totals: { ...receipt.totals, grandTotalBani } };
}

/** Every way to fix a violated line with at most `maxCost` confusable digits in its three numbers. */
function localMoves(line: ParsedLine, position: number, maxCost: number): Move[] {
  const qtyMilli = Math.round(line.qty * 1000);
  const unit = line.unitPriceBani ?? 0;
  const options = {
    qty: [{ value: qtyMilli, cost: 0 }, ...digitAlternatives(qtyMilli, 4, maxCost)],
    unit: [{ value: unit, cost: 0 }, ...digitAlternatives(unit, 3, maxCost)],
    total: [
      { value: line.lineTotalBani, cost: 0 },
      ...digitAlternatives(line.lineTotalBani, 3, maxCost),
    ],
  };

  const moves: Move[] = [];
  for (const q of options.qty) {
    if (q.value <= 0 || q.value / 1000 > MAX_QTY) continue;
    for (const u of options.unit) {
      if (q.cost + u.cost > maxCost) continue;
      for (const t of options.total) {
        const cost = q.cost + u.cost + t.cost;
        if (cost === 0 || cost > maxCost) continue;
        const expected = expectedLineTotal({
          ...line,
          qty: q.value / 1000,
          unitPriceBani: u.value,
        });
        if (expected === undefined || Math.abs(expected - t.value) > LINE_TOLERANCE_BANI) continue;

        const edits: Edit[] = [];
        if (q.cost > 0) edits.push({ target: { kind: 'qty', position }, to: q.value });
        if (u.cost > 0) edits.push({ target: { kind: 'unit', position }, to: u.value });
        if (t.cost > 0) edits.push({ target: { kind: 'total', position }, to: t.value });
        moves.push({ edits, cost, dLineTotal: t.value - line.lineTotalBani, dGrand: 0 });
      }
    }
  }
  return moves;
}

export interface Correction {
  /** `ParsedLine.idx`; absent for the receipt total. */
  lineIdx?: number;
  field: 'qty' | 'unitPrice' | 'lineTotal' | 'grandTotal';
  /** Bani, or thousandths for `qty`. */
  from: number;
  to: number;
}

export type RepairStatus =
  /** Already adds up (or there is nothing to check): returned untouched. */
  | 'valid'
  /** One best fix existed and was applied. */
  | 'repaired'
  /** Several fixes are equally good: nothing was changed. */
  | 'ambiguous'
  /** No fix of a few confusable digits makes it add up: nothing was changed. */
  | 'unrepairable';

export interface RepairOutcome {
  status: RepairStatus;
  /** The repaired receipt, or the input itself (same object) when nothing was changed. */
  receipt: ParsedReceipt;
  corrections: Correction[];
  /** `ParsedLine.idx` of the lines that may hold the error: only for `ambiguous`. */
  suspects: number[];
}

interface Candidate {
  edits: Edit[];
  cost: number;
  /** |total - Σ lines| after the fix. */
  residual: number;
  vatWarnings: number;
}

function correctionsOf(receipt: ParsedReceipt, edits: readonly Edit[]): Correction[] {
  return edits.map(({ target, to }): Correction => {
    if (target.kind === 'grand') {
      return { field: 'grandTotal', from: receipt.totals.grandTotalBani, to };
    }
    const line = receipt.lines[target.position];
    const from =
      target.kind === 'qty'
        ? Math.round((line?.qty ?? 0) * 1000)
        : target.kind === 'unit'
          ? (line?.unitPriceBani ?? 0)
          : (line?.lineTotalBani ?? 0);
    const field =
      target.kind === 'qty' ? 'qty' : target.kind === 'unit' ? 'unitPrice' : 'lineTotal';
    return { ...(line && { lineIdx: line.idx }), field, from, to };
  });
}

const compare = (a: Candidate, b: Candidate): number =>
  a.cost - b.cost || a.residual - b.residual || a.vatWarnings - b.vatWarnings;

/**
 * Looks for the fewest confusable-digit corrections that make `receipt` pass the sum and line
 * checks of `../validate`. See the module comment for the rules. Pure and deterministic; for a
 * receipt that satisfies the domain schema it does not throw.
 */
export function repairDigits(receipt: ParsedReceipt): RepairOutcome {
  const keep = (status: RepairStatus, suspects: number[] = []): RepairOutcome => ({
    status,
    receipt,
    corrections: [],
    suspects,
  });

  const lineWarnings = checkLineArithmetic(receipt);
  if (checkSumMismatch(receipt).length === 0 && lineWarnings.length === 0) return keep('valid');
  if (receipt.lines.length === 0 || receipt.lines.length > MAX_LINES) return keep('unrepairable');

  // Without a printed total there is no sum to satisfy: only the lines can be checked.
  const sumKnown = !isTotalMissing(receipt);
  const sum0 = sumOfLines(receipt);
  const grand0 = receipt.totals.grandTotalBani;
  const deviation0 = grand0 - sum0;
  // A sum that was off has to come out exact; one within tolerance may not get worse.
  const residualLimit = !sumKnown
    ? Number.POSITIVE_INFINITY
    : Math.abs(deviation0) > SUM_TOLERANCE_BANI
      ? 0
      : Math.abs(deviation0);
  const vatWarnings0 = checkVatTotals(receipt).length;

  const violated = new Set(lineWarnings.map((warning) => warning.lineIdx));
  const positions = receipt.lines.flatMap((line, position) =>
    violated.has(line.idx) ? [position] : [],
  );
  const budget = Math.min(MAX_CORRECTIONS, positions.length + 1);

  const mandatory = positions.map((position) =>
    localMoves(receipt.lines[position] as ParsedLine, position, budget),
  );
  if (mandatory.some((moves) => moves.length === 0)) return keep('unrepairable');

  // One extra correction may balance the sum: a line that prints no unit price, or the total.
  const free: Move[] = [];
  receipt.lines.forEach((line, position) => {
    if (violated.has(line.idx) || Number.isSafeInteger(line.unitPriceBani)) return;
    for (const { value } of digitAlternatives(line.lineTotalBani, 3, 1)) {
      free.push({
        edits: [{ target: { kind: 'total', position }, to: value }],
        cost: 1,
        dLineTotal: value - line.lineTotalBani,
        dGrand: 0,
      });
    }
  });
  if (sumKnown) {
    for (const { value } of digitAlternatives(grand0, 3, 1)) {
      free.push({
        edits: [{ target: { kind: 'grand' }, to: value }],
        cost: 1,
        dLineTotal: 0,
        dGrand: value - grand0,
      });
    }
  }

  const candidates: Candidate[] = [];
  const consider = (moves: readonly Move[], cost: number) => {
    const dSum = moves.reduce((total, move) => total + move.dLineTotal, 0);
    const dGrand = moves.reduce((total, move) => total + move.dGrand, 0);
    const residual = sumKnown ? Math.abs(grand0 + dGrand - (sum0 + dSum)) : 0;
    if (residual > residualLimit) return;

    const edits = moves.flatMap((move) => move.edits);
    const fixed = applyEdits(receipt, edits);
    if (checkLineArithmetic(fixed).length > 0 || checkSumMismatch(fixed).length > 0) return;
    const vatWarnings = checkVatTotals(fixed).length;
    if (vatWarnings > vatWarnings0) return;
    candidates.push({ edits, cost, residual, vatWarnings });
  };

  const walk = (slot: number, spent: number, picked: readonly Move[]) => {
    const moves = mandatory[slot];
    if (!moves) {
      consider(picked, spent);
      if (spent < budget) for (const move of free) consider([...picked, move], spent + move.cost);
      return;
    }
    for (const move of moves) {
      if (spent + move.cost <= budget) walk(slot + 1, spent + move.cost, [...picked, move]);
    }
  };
  walk(0, 0, []);

  const [best, ...rest] = candidates.sort(compare);
  if (!best) return keep('unrepairable');
  const tied = rest.filter((candidate) => compare(candidate, best) === 0);
  if (tied.length === 0) {
    return {
      status: 'repaired',
      receipt: applyEdits(receipt, best.edits),
      corrections: correctionsOf(receipt, best.edits),
      suspects: [],
    };
  }

  const suspects = new Set<number>();
  for (const candidate of [best, ...tied]) {
    for (const { target } of candidate.edits) {
      const line = target.kind === 'grand' ? undefined : receipt.lines[target.position];
      if (line) suspects.add(line.idx);
    }
  }
  const lines = [...suspects].sort((a, b) => a - b);
  return keep('ambiguous', lines.length <= MAX_SUSPECT_LINES ? lines : []);
}

const qtyText = (milli: number): string => String(milli / 1000).replace('.', ',');

function describe(correction: Correction): string {
  const bani = (from: number, to: number) => `${formatBani(from)} → ${formatBani(to)}`;
  switch (correction.field) {
    case 'qty':
      return `cantitatea ${qtyText(correction.from)} → ${qtyText(correction.to)}`;
    case 'unitPrice':
      return `prețul unitar ${bani(correction.from, correction.to)}`;
    case 'lineTotal':
      return `totalul liniei ${bani(correction.from, correction.to)}`;
    case 'grandTotal':
      return `totalul bonului ${bani(correction.from, correction.to)}`;
  }
}

/** The warnings that tell the review screen what the repair did, or which lines it could not decide. */
export function repairWarnings(outcome: RepairOutcome): ParseWarning[] {
  const nameOf = (idx: number) =>
    outcome.receipt.lines.find((line) => line.idx === idx)?.rawName ?? '';
  const warnings: ParseWarning[] = [];

  const byLine = new Map<number | undefined, Correction[]>();
  for (const correction of outcome.corrections) {
    byLine.set(correction.lineIdx, [...(byLine.get(correction.lineIdx) ?? []), correction]);
  }
  for (const [lineIdx, corrections] of byLine) {
    const what = corrections.map(describe).join(', ');
    warnings.push({
      code: 'REPAIRED_DIGITS',
      ...(lineIdx !== undefined && { lineIdx }),
      message:
        lineIdx === undefined
          ? `Cifre citite greșit, corectate automat: ${what}. Verifică în imagine.`
          : `Cifre citite greșit la „${nameOf(lineIdx)}”, corectate automat: ${what}. Verifică în imagine.`,
    });
  }
  for (const lineIdx of outcome.suspects) {
    warnings.push({
      code: 'LOW_CONFIDENCE',
      lineIdx,
      message: `Suma bonului nu se potrivește, iar „${nameOf(lineIdx)}” poate avea o cifră citită greșit. Verifică în imagine.`,
    });
  }
  return warnings;
}

/**
 * What the OCR parsers call once the lines are read: repairs the receipt when one best fix exists
 * and appends the warnings about it. Never throws; on anything unexpected the receipt comes back as
 * it was.
 */
export function repairReceipt(receipt: ParsedReceipt): ParsedReceipt {
  try {
    const outcome = repairDigits(receipt);
    if (outcome.status === 'valid' || outcome.status === 'unrepairable') return receipt;
    return {
      ...outcome.receipt,
      meta: {
        ...outcome.receipt.meta,
        warnings: [...outcome.receipt.meta.warnings, ...repairWarnings(outcome)],
      },
    };
  } catch {
    return receipt;
  }
}
