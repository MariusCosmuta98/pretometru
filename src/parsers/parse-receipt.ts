import type { ParsedReceipt, ParseWarning, ReceiptParser, ReceiptSource } from '@/domain';
import { parsers, rankParsers } from './registry';
import { engineForSource } from './source';
import { validateReceipt } from './validate';

export interface ParseReceiptOptions {
  /** The clock, injected so date checks are deterministic (the Lidl sample is dated in the future). */
  now: Date;
}

type Attempt = { ok: true; receipt: ParsedReceipt } | { ok: false; reason: string };

function attempt(parser: ReceiptParser, source: ReceiptSource): Attempt {
  try {
    const receipt = parser.parse(source);
    const usable =
      typeof receipt === 'object' &&
      receipt !== null &&
      Array.isArray(receipt.lines) &&
      typeof receipt.totals === 'object' &&
      Array.isArray(receipt.meta?.warnings);
    return usable ? { ok: true, receipt } : { ok: false, reason: 'rezultat invalid' };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** What a document that no parser recognised turns into: nothing extracted, all warnings on. */
function unrecognized(source: ReceiptSource): ParsedReceipt {
  return {
    schemaVersion: 1,
    chain: 'unknown',
    docType: 'receipt',
    currency: 'RON',
    totals: { grandTotalBani: 0 },
    lines: [],
    meta: { engine: engineForSource(source), parser: 'none', parserVersion: '0.0.0', warnings: [] },
  };
}

const warningKey = (warning: ParseWarning) => `${warning.code}:${warning.lineIdx ?? ''}`;

/**
 * Parser warnings come first. A validation warning is dropped when the parser already reported
 * the same code for the same line (or for the document), so nothing shows up twice.
 */
function finish(
  receipt: ParsedReceipt,
  notes: readonly ParseWarning[],
  opts: ParseReceiptOptions,
): ParsedReceipt {
  const own = [...receipt.meta.warnings, ...notes];
  if (receipt.chain === 'unknown' && !own.some((warning) => warning.code === 'UNKNOWN_CHAIN')) {
    own.push({ code: 'UNKNOWN_CHAIN', message: 'Magazinul nu a fost recunoscut.' });
  }
  const reported = new Set(own.map(warningKey));
  const validation = validateReceipt(receipt, opts).filter(
    (warning) => !reported.has(warningKey(warning)),
  );
  return { ...receipt, meta: { ...receipt.meta, warnings: [...own, ...validation] } };
}

/**
 * `parseReceipt` over an explicit parser set (tests, or code that needs a subset). Tries the
 * parsers that recognise the source best first; one that throws is skipped (and noted as a
 * LOW_CONFIDENCE warning) in favour of the next.
 */
export function parseReceiptWith(
  candidates: readonly ReceiptParser[],
  source: ReceiptSource,
  opts: ParseReceiptOptions,
): ParsedReceipt {
  const notes: ParseWarning[] = [];
  for (const { parser } of rankParsers(source, candidates)) {
    const result = attempt(parser, source);
    if (result.ok) return finish(result.receipt, notes, opts);
    notes.push({
      code: 'LOW_CONFIDENCE',
      message: `Parserul „${parser.id}” a eșuat: ${result.reason}`,
    });
  }
  return finish(unrecognized(source), notes, opts);
}

/**
 * Parses a document with the registered parser that recognises it best, then appends the
 * `validateReceipt` warnings. Never throws: a document nobody recognises comes back empty, with
 * UNKNOWN_CHAIN, MISSING_TOTAL and MISSING_DATE warnings.
 */
export function parseReceipt(source: ReceiptSource, opts: ParseReceiptOptions): ParsedReceipt {
  return parseReceiptWith(parsers, source, opts);
}
