# Data contracts (v0)

Shared by parsers, import/review UI, storage and tests. The zod schemas in `src/domain/` are the executable
source of truth; this document is the human-readable twin. **Any contract change updates this file, the zod
schemas and every affected `tests/fixtures/**/expected.json` in the same commit.**

## Conventions

- **Money**: integer *bani* (1 RON = 100 bani). Never floats. VAT-**inclusive** unless a field name says otherwise.
- **Dates**: `purchasedAt` is ISO-8601 local time without zone (`YYYY-MM-DDTHH:mm[:ss]`, Europe/Bucharest implied) or date-only (`YYYY-MM-DD`).
- **Quantities**: plain numbers, up to 3 decimals (`0.920` kg).
- **Text**: `rawName` is exactly what is printed (trimmed). Normalisation for matching is a separate step.
- **Privacy**: no buyer personal data (name, address, client number, card or loyalty numbers) may appear in any field,
  including `raw`. Branch info is limited to store code and city.
- **Parsers are pure**: no DOM, no IndexedDB, no network, deterministic, runnable under Node (Vitest).
  They never throw on malformed input; they return a best-effort receipt plus `warnings`.

## ParsedReceipt (parser output, review-UI input, pre-persistence)

```ts
type Chain = 'kaufland' | 'metro' | 'mega-image' | 'lidl' | 'unknown'; // extend when a store is added
type DocType = 'receipt' | 'invoice';
type LineKind = 'product' | 'deposit' | 'bag' | 'discount' | 'fee';
// deposit = returnable-container deposit (e.g. "GARANTIE AMBALAJ"), bag = carrier bag,
// discount = standalone discount/coupon line (negative lineTotalBani), fee = any other non-product charge
type QtyUnit = 'buc' | 'kg' | 'l';
type PackUnit = 'g' | 'kg' | 'ml' | 'l' | 'buc' | 'm' | 'role';

interface ParsedLine {
  idx: number;                 // 0-based order among printed lines
  rawName: string;
  kind: LineKind;
  ean?: string;                // digits only; may be shorter than 13 when the receipt truncates it
  qty: number;                 // sold units, or kg/l for weighed items
  qtyUnit: QtyUnit;
  unitPriceBani?: number;      // only when printed (or exactly derivable): list price per qty unit, VAT-inclusive, before discount
  discountBani?: number;       // >= 0, VAT-inclusive discount on this line (ex-VAT documents: converted)
  lineTotalBani: number;       // VAT-inclusive amount charged after discount; effective paid unit price = lineTotalBani / qty
  vatRate?: number;            // percent: 21, 11, 9, 5, 0
  vatClass?: string;           // printed class letter ('A'..'D')
  storeCategoryHint?: string;  // section header printed on the receipt (Kaufland)
  pack?: { qty: number; unit: PackUnit }; // size of ONE sold unit parsed from the name: '425ML' -> {425,'ml'}, '8ROLE' -> {8,'role'}
  confidence?: number;         // 0..1, OCR/AI only
  bbox?: { x: number; y: number; w: number; h: number; page?: number }; // source region for review crops
  raw?: string;                // original printed text of the line(s), PII-free
}

interface ParsedReceipt {
  schemaVersion: 1;
  chain: Chain;
  storeName?: string;          // as printed, e.g. 'S.C. LIDL DISCOUNT S.R.L.'
  branch?: { code?: string; city?: string };
  docType: DocType;
  documentNo?: string;
  purchasedAt?: string;
  currency: 'RON';
  totals: {
    grandTotalBani: number;    // printed TOTAL of goods, VAT-inclusive, before payment-side vouchers
    voucherBani?: number;      // payment-side deduction (Kaufland "Tichet de ambalaje"), positive
    paidBani?: number;         // amount actually paid (grandTotal - voucher)
    vat?: Array<{ rate: number; grossBani?: number; netBani?: number; vatBani?: number }>;
  };
  lines: ParsedLine[];
  meta: {
    engine: 'pdfjs' | 'tesseract' | 'gemini' | 'paste' | 'manual' | 'fixture';
    parser: string;            // 'kaufland'
    parserVersion: string;     // semver
    confidence?: number;       // 0..1 overall
    warnings: ParseWarning[];
  };
}

type WarningCode =
  | 'SUM_MISMATCH'      // sum(lines) != grandTotal beyond tolerance (5 bani)
  | 'LINE_ARITHMETIC'   // qty * unitPrice - discount != lineTotal (tolerance 1 ban)
  | 'VAT_MISMATCH'      // per-rate totals disagree with lines
  | 'FUTURE_DATE' | 'MISSING_DATE' | 'MISSING_TOTAL'
  | 'UNKNOWN_CHAIN' | 'LOW_CONFIDENCE'
  | 'REPAIRED_DIGITS'   // an OCR digit-confusion repair was applied
  | 'DUPLICATE';        // same file hash or same store+date+total+documentNo already stored
interface ParseWarning { code: WarningCode; message: string; lineIdx?: number }
```

## Parser input

```ts
interface PdfTextItem { str: string; x: number; y: number; w: number; h: number } // pdf.js user space, origin bottom-left
interface OcrLine { text: string; confidence: number; bbox: { x: number; y: number; w: number; h: number } }

type ReceiptSource =
  | { kind: 'pdf-text'; pages: Array<{ width: number; height: number; items: PdfTextItem[] }> }
  | { kind: 'ocr-text'; text: string; lines?: OcrLine[]; confidence?: number; imageSize?: { w: number; h: number } }
  | { kind: 'pasted-text'; text: string };

interface ReceiptParser {
  id: string;                                  // 'kaufland'
  version: string;
  detect(src: ReceiptSource): number;          // 0..1 confidence that this parser handles the document
  parse(src: ReceiptSource): ParsedReceipt;
}
```

## Per-store notes (verified on real samples)

- **Kaufland** (PDF with text): section headers (`Alimente`, `Mopro/Brânză/Ouă`, …) -> `storeCategoryHint`;
  `n * price` lines for multiples; weighed items print `0,920 KG` + line total only (price/kg = total/weight);
  `GARANTIE AMBALAJ` -> `deposit`, `PUNGA BIO` -> `bag`; `Tichet de ambalaje` -> `totals.voucherBani`; VAT classes B=21, C=11, D=0.
- **METRO** (invoice PDF): prices on the invoice are **ex-VAT**. Use "Valoare totala cu TVA" for `lineTotalBani`;
  discounts are printed as `2,49-` (ex-VAT); first column is the EAN; "Unit. vanz." = consumer units per sold pack
  (cross-check for `pack`, e.g. 8 rolls). Σ lines can differ by 1 ban from the printed total (rounding per VAT rate).
  Name may contain a stray unit token (`... CAPSUNI BUC` + packaging code `BU`).
- **Lidl** (app screenshot, OCR): two-line items `qty BUC x price` then `name total VATclass`; classes A=21, B=11;
  split card payments (several `CARD` lines). OCR confuses 0/8 and similar; arithmetic checks catch it.
- **Mega Image** (photo, OCR): `name price` then the EAN on the next line; no store name on the receipt
  (only a merchant code on the card slip); EAN may be truncated; watermark/low resolution -> expect review.
