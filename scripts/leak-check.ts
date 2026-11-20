/**
 * Pure leak scanner shared by the pre-commit hook and CI (`scripts/check-leaks.ts`).
 *
 * The repository is public, so personal data from receipts (buyer names, addresses, card and loyalty
 * numbers, IBANs, phone numbers) and credentials must never be committed. The generic rules below
 * catch the formats; a private denylist (kept outside the repository) catches the exact values
 * that were removed from a real receipt.
 *
 * A finding never contains the matched value, only where it is and which rule fired.
 */

export type LeakRule =
  'iban' | 'card-number' | 'email' | 'phone' | 'token' | 'labelled-id' | 'denylist';

export interface Finding {
  rule: LeakRule;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  /** Describes the match without revealing it. */
  excerpt: string;
}

export interface ScanOptions {
  /** Exact private terms, e.g. the output of `parseDenylist`. */
  denylist?: readonly string[];
}

const MIN_DENYLIST_TERM_LENGTH = 4;
// All-zero (or almost all-zero) digit runs are the sanitised placeholders, not data.
const MIN_NON_ZERO_DIGITS_IN_CARD_RUN = 8;

const digitsOf = (text: string): string => text.replace(/\D/g, '');
const nonZeroDigitCount = (text: string): number => digitsOf(text).replaceAll('0', '').length;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function passesIbanChecksum(candidate: string): boolean {
  const iban = candidate.replaceAll(' ', '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  let remainder = 0;
  for (const char of iban.slice(4) + iban.slice(0, 4)) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

interface PatternRule {
  rule: LeakRule;
  pattern: RegExp;
  /** Dismisses a candidate that only looks like a leak. */
  accept?: (match: RegExpMatchArray) => boolean;
}

const AT_WORD_START = '(?<![A-Za-z0-9_])';

const PATTERN_RULES: readonly PatternRule[] = [
  {
    rule: 'iban',
    pattern:
      /(?<![A-Za-z0-9])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![A-Za-z0-9])/gi,
    accept: (match) => passesIbanChecksum(match[0]),
  },
  {
    rule: 'card-number',
    // 15-19 digits, ungrouped or grouped (4-4-4-4[-n] or 4-6-5), that pass the Luhn check. The
    // fraction of a decimal number (`4.666666666666667`) is not a card number.
    pattern:
      /(?<![\p{L}\d_])(?<!\d[.,])(?:\d{4}(?:[ -]\d{4}){3}(?:[ -]\d{1,3})?|\d{4}[ -]\d{6}[ -]\d{5}|\d{15,19})(?![\p{L}\d_])/gu,
    accept: (match) =>
      nonZeroDigitCount(match[0]) >= MIN_NON_ZERO_DIGITS_IN_CARD_RUN &&
      passesLuhn(digitsOf(match[0])),
  },
  {
    rule: 'card-number',
    // Masked card numbers: optional leading digits, a run of mask characters, then the last four.
    pattern: /(?<![\p{L}\d])(?:\d{4,6}[ -]?)?(?:[*#xX•][ -]?){4,}\d{4}(?!\d)/gu,
    accept: (match) => nonZeroDigitCount(match[0]) > 0,
  },
  {
    rule: 'email',
    pattern: /[\p{L}\d._%+-]+@[\p{L}\d-]+(?:\.[\p{L}\d-]+)+/gu,
  },
  {
    rule: 'phone',
    // Romanian mobile and landline numbers, with or without the +40 / 0040 prefix.
    pattern:
      /(?<![\d.,])(?:(?:\+ ?40|0040)[ .-]?\(?0?\)?[ .-]?|0)[2-37]\d{1,2}[ .-]?\d{3}[ .-]?\d{3,4}(?!\d)/g,
    accept: (match) => nonZeroDigitCount(match[0].replace(/^(?:\+ ?40|0040)/, '')) >= 4,
  },
  {
    rule: 'token',
    pattern: new RegExp(
      [
        `${AT_WORD_START}gh[pousr]_[A-Za-z0-9]{36,}`,
        `${AT_WORD_START}github_pat_[A-Za-z0-9_]{22,}`,
        `${AT_WORD_START}AIza[\\w-]{35}`,
        `${AT_WORD_START}sk-[A-Za-z0-9_-]{20,}`,
        `${AT_WORD_START}AKIA[0-9A-Z]{16}`,
        `${AT_WORD_START}xox[abprs]-[A-Za-z0-9-]{10,}`,
        '-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----',
      ].join('|'),
      'g',
    ),
  },
  {
    rule: 'labelled-id',
    // Loyalty / client / personal-id numbers right after their label. Amounts such as
    // `CARD 20,69` have a decimal mark and fewer than five digits, so they never match.
    pattern:
      /(?<![\p{L}\d])(?:client|card(?: xtra| fidelitate| plus| club)?|lidl plus|fidelitate|loyalty|cnp|c\.n\.p\.?)(?:[ \t]*(?:nr|no|numar|număr)\.?)?[ \t:=.-]*(\d{5,})(?!\d)/giu,
    accept: (match) => nonZeroDigitCount(match[1] ?? '') > 0,
  },
];

/** Lower-cases, strips diacritics and collapses whitespace, remembering where each character came from. */
function fold(text: string): { text: string; offsets: number[] } {
  let folded = '';
  const offsets: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < text.length; i++) {
    const char = text.charAt(i);
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        folded += ' ';
        offsets.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    lastWasSpace = false;
    const plain = char.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < plain.length; k++) offsets.push(i);
    folded += plain;
  }
  return { text: folded, offsets };
}

interface DenylistTerm {
  text: string;
  numeric: boolean;
}

function prepareDenylist(entries: readonly string[]): DenylistTerm[] {
  const seen = new Set<string>();
  const terms: DenylistTerm[] = [];
  for (const entry of entries) {
    const text = fold(entry).text.trim();
    if (text.length < MIN_DENYLIST_TERM_LENGTH || seen.has(text)) continue;
    seen.add(text);
    terms.push({ text, numeric: /^\d+$/.test(text) });
  }
  return terms;
}

/** One term per line; blank lines and `#` comments are ignored. */
export function parseDenylist(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

export function scanText(text: string, options: ScanOptions = {}): Finding[] {
  const terms = prepareDenylist(options.denylist ?? []);
  const findings: Finding[] = [];

  text.split(/\r?\n/).forEach((lineText, index) => {
    const line = index + 1;

    for (const { rule, pattern, accept } of PATTERN_RULES) {
      for (const match of lineText.matchAll(pattern)) {
        if (accept && !accept(match)) continue;
        findings.push({ rule, line, column: match.index + 1, excerpt: `${match[0].length} chars` });
      }
    }

    if (terms.length === 0) return;
    const { text: folded, offsets } = fold(lineText);
    for (const term of terms) {
      for (let at = folded.indexOf(term.text); at !== -1; at = folded.indexOf(term.text, at + 1)) {
        const touchesDigit =
          /\d/.test(folded.charAt(at - 1)) || /\d/.test(folded.charAt(at + term.text.length));
        if (term.numeric && touchesDigit) continue;
        findings.push({
          rule: 'denylist',
          line,
          column: (offsets[at] ?? 0) + 1,
          excerpt: 'private term',
        });
      }
    }
  });

  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}

const UNSCANNED_PATH =
  /(?:^|\/)package-lock\.json$|\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|gz|wasm)$/i;

/** Lockfiles and binary assets carry hashes and byte noise, never prose. */
export function isScannablePath(path: string): boolean {
  return !UNSCANNED_PATH.test(path);
}
