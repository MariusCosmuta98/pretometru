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
- **Schema strictness**: the zod schemas reject unknown keys (a typo must not pass silently) and bound every amount to
  ±10,000,000 RON (1,000,000,000 bani) to catch runaway parses. Text fields that exist must be non-empty (`rawName`,
  `storeName`, `documentNo`, `parser`, `storeCategoryHint`, `branch.code`, `branch.city`) and `rawName` must be trimmed.
  `ean` is 4 to 14 digits, `vatClass` is 1 to 3 characters `A-Z0-9`, `unitPriceBani` and `discountBani` are >= 0,
  `qty` and `pack.qty` are > 0 and <= 1,000,000 with at most 3 decimals, `lines[].idx` is strictly increasing,
  `bbox.w`/`bbox.h` are >= 0, source `pages[].width`/`height` are > 0, `confidence` is 0..1 (OCR sources: 0-100), and a
  warning's `lineIdx` must point at an existing line. A `purchasedAt` in the future is **valid** (it earns a
  `FUTURE_DATE` warning, not a schema error); date checks take an injectable `now`.
- **`lineTotalBani` is net of the line's discount**, so sum(`lineTotalBani`) = `grandTotalBani` holds whether a
  discount is folded into its product line (`discountBani` > 0) or printed as a standalone `discount` line. Plan §7.2's
  `(lineTotal - discount) / qty` therefore reads `lineTotalBani / qty`; `discountBani` only tells regular prices from sale prices.

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

Warnings: `code` is the stable identifier, `message` a short **Romanian** sentence for the review screen, `lineIdx` the
`idx` of the line it is about. `validateReceipt` (`src/parsers/validate.ts`) raises `SUM_MISMATCH` (Σ lines vs
`grandTotalBani` beyond 5 bani, also `paidBani` vs `grandTotalBani - voucherBani`), `LINE_ARITHMETIC` (1 ban, plus half a
ban per sold unit because the unit price is rounded; only lines that print `unitPriceBani`), `VAT_MISMATCH` (printed
`totals.vat` against itself and against the lines of each rate: 5 bani on a rate's gross, 2 on derived VAT amounts),
`FUTURE_DATE`, `MISSING_DATE` and `MISSING_TOTAL`; the import orchestrator adds `DUPLICATE` (it needs the database).
`grandTotalBani` is required, so **a parser that cannot find the total writes 0**: a 0 total over lines worth money, or
over no lines, is reported as `MISSING_TOTAL` (and then `SUM_MISMATCH` stays quiet).

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

`OcrLine.confidence` and the `ocr-text` `confidence` use Tesseract's **0-100** scale; parsers normalise to **0..1** in
`ParsedLine.confidence` and `meta.confidence`.

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

## Persisted model (IndexedDB)

Defined by the zod schemas in `src/domain/entities.ts` and by `src/storage/` (Dexie tables, indexes, migrations); plan §6
is the product-level description. English enum values replace the Romanian ones of the plan (`receipt`/`invoice`,
`product`/`deposit`/`bag`/`discount`/`fee`, base unit `role`).

Every synced record has `id` (ULID), `updatedAt` (UTC instant with exactly 3 ms digits, as `Date.toISOString()` writes it,
because last-write-wins compares the strings) and an optional
`deletedAt` (tombstone: records are soft-deleted so deletions can sync; only `purgeTombstones` and a `replace` import
remove rows; a deleted key-value row also drops its value so a deleted token does not stay on disk). `settings` and
`syncState` are key-value rows `{ key, value (any JSON), updatedAt, deletedAt? }`.

| Table                | Fields beyond the sync fields                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `stores`             | `chain`, `name`, `branchCode?`, `city?`, `address?`                                                              |
| `receipts`           | `storeId`, `purchasedAt?` (required once `confirmed`), `receiptNo?`, `docType`, `totalBani`, `paidBani?`, `linesUpdatedAt?` (when the line set was last replaced; older live lines are tombstoned on merge), `source` `{kind: pdf\|image\|text\|manual, fileHash? (sha-256 hex), fileName?, rawText? (PII-free, for re-processing)}`, `extraction` `{engine, parser, version, confidence?, warnings[]}`, `status` (`draft`\|`confirmed`) |
| `lines`              | `receiptId`, `idx`, `rawName`, `ean?`, `qty`, `unit`, `lineTotalBani`, `discountBani` (>= 0, already inside the total), `vatRate?`, `kind`, `storeCategoryHint?`, `productId?`, `categoryId?`, `packQty?` + `packUnit?` (together: content of ONE sold unit), `unitsPerPack?`; derived: `paidUnitBani`, `baseUnit`, `pricePerBaseMilliBani` |
| `products`           | `name`, `brand?`, `categoryId`, `ean?`, `baseUnit` (`kg`, `l`, `buc`, `role`, `m`)                               |
| `aliases`            | `chain?` (absent = every chain), `normName` (`normalizeName(rawName)`), `rawName?`, `ean?`, `productId`, `defaultPack?` `{qty, unit, unitsPerPack?}` |
| `categories`         | `name`, `parentId?`, `color` (`#rrggbb`), `icon` (emoji), `order`, `system?`                                     |
| `lists` / `listItems` | list: `name`, `archivedAt?`; item: `listId`, `productId?`, `label`, `qty?`, `unit?`, `note?`, `checked`, `checkedAt?`, `order` |

Derived line fields are computed only by `unitPricing()` (through `saveReceipt`), never written by hand:
`paidUnitBani = round(lineTotalBani / qty)` and `pricePerBaseMilliBani` is the price per `baseUnit` in **milli-bani**
(1/1000 ban). `baseUnit` is `kg`/`l` for weighed items, otherwise the base of `packUnit`, or `buc` when the size is
unknown; compare prices only between lines that have the same `baseUnit`.

**Deviations from plan §6**

- `pricePerBaseBani` is stored as `pricePerBaseMilliBani` (integer milli-bani). Whole bani lose too much precision for
  cheap pieces (120 wet wipes at 3,98 lei are 3,317 bani each) and ties would corrupt "cheapest" rankings.
- Additions: `lines.baseUnit` (needed to interpret the price), `aliases.rawName`, `receipts.source.rawText` (plan risk 4:
  keep text for re-processing), `categories.system`, `lists.archivedAt` and the list item fields.
- No `createdAt`: the creation time is inside the ULID (`idTimestamp`).
- Seed categories have well-known ids (`0000000000SEEDCATEG0000001` to `...16`) and `updatedAt` = epoch, so devices that
  seed independently converge and any user edit wins.

**Backup file (`*.pretometru-backup.json`)**:
`{ format: 'pretometru-backup', formatVersion: 1, exportedAt, data: { stores, receipts, lines, products, aliases,
categories, lists, listItems, settings } }`. Tombstones are included. Sync state and settings that are not marked
`portable` in `SETTING_DEFINITIONS` (tokens, API keys, device values) are never exported or imported. Import is `merge`
(the newer `updatedAt` wins per record, a newer tombstone deletes) or `replace`, in one transaction, and afterwards
reconciles the lines of every touched receipt (`linesUpdatedAt`), because two devices can re-save the same receipt
with different line sets. A newer `formatVersion` is refused rather than imported lossily. Export leaves out (and
reports as `skipped`) stored records that no longer satisfy their schema instead of failing.
