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
`grandTotalBani` beyond 5 bani, also `paidBani` vs `grandTotalBani - voucherBani`), `LINE_ARITHMETIC` (beyond 1 ban;
only lines that print `unitPriceBani`), `VAT_MISMATCH` (printed
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

- **Kaufland** (PDF with text, `src/parsers/kaufland`): section headers (`Alimente`, `Mopro/Brânză/Ouă`, …) -> `storeCategoryHint`;
  `n * price` lines for multiples (`unitPriceBani` = the printed price); weighed items print `0,920 KG` + line total only
  (no `unitPriceBani`: price/kg = total/weight is derived later by `unitPricing`); an item is its name, an optional
  detail and the amount + VAT class, on one printed row or on two. `GARANTIE AMBALAJ` -> `deposit`, `PUNGA BIO` -> `bag`;
  `Tichet de ambalaje` -> `totals.voucherBani`; `paidBani` = the `Plată card` row (else total - voucher, else absent).
  VAT classes (B=21, C=11, D=0 at the time of writing) are read from the printed `TVA % | Brut | Net | Tva` table into
  `totals.vat` and `vatRate`; without the table `vatRate` stays absent (no default mapping). The receipt number, the
  time (`Data: dd.mm.yy Timp: hh:mm:ss Bon: n`) and `branch.code` (`Magazin: n`) are in the footer; `branch.city`
  comes from the card slip's merchant block when it is there. Card slip, loyalty card and buyer rows are never read.
- **METRO** (invoice PDF, `src/parsers/metro`): prices on the invoice are **ex-VAT**. Use "Valoare totala cu TVA" for
  `lineTotalBani`; the VAT-inclusive list price is not printed, so there is no `unitPriceBani`, and the ex-VAT discount
  (`2,49-`) becomes `discountBani = round(discount * (1 + rate / 100))`. Columns are anchored from the right (8
  numbers, 9 with a discount); the first column is the EAN (kept as printed: a truncated one stays truncated, a code
  shorter than 4 digits is dropped); the description (size, brand, name) is `rawName` as printed, including a stray
  unit token (`... CAPSUNI BUC`), while the two-letter packaging code (`BU`) is not part of it. "Unit. vanz." = consumer
  units per sold pack: it only cross-checks a counted size in the name (`8 ROLE` vs 8, else a `LOW_CONFIDENCE`
  warning); `pack` comes from the name. The invoice's own columns are cross-checked too (value = price x qty, value
  after discount, total with VAT), raising `LINE_ARITHMETIC` for a line that does not add up. Σ lines can differ by 1
  ban from the printed total (rounding per VAT rate). `grandTotalBani` is the invoice gross, `paidBani` the "Total de
  plata" row, `totals.vat` the table under "Total factura". `purchasedAt` is "Data Vanzare", `storeName` the seller as
  printed, `branch.city` the city of "METRO Cash&Carry <city>". Seller, bank, buyer and client-number rows are never read.
- **Lidl** (app screenshot read by OCR, or pasted text; `src/parsers/lidl`): two-line items `n,000 BUC x price` then
  `name total VATclass`, so every product has its `unitPriceBani`; `Reducere ...` rows are discounts. Classes A=21 and
  B=11 (the printed `TVA A 21,00% 5,91` rows fill `totals.vat`; without them the usual rates apply to the lines).
  `grandTotalBani` is `TOTAL` (else `Subtotal`, else what was paid); `TOTAL TVA` is not it. `paidBani` = Σ `CARD` /
  `NUMERAR` rows - `REST`: split card payments are several `CARD` lines. `branch.city` is the city of the postal
  address, `purchasedAt` the `DATA:dd/mm/yyyy ORA:hh-mm-ss` row; no `documentNo`. Card slip, loyalty and footer rows
  are never read. A quantity line whose product row is unreadable stays as `Produs necunoscut` with `LOW_CONFIDENCE`
  on the line. OCR confuses 0/8 and similar; the digit repair (below) fixes a unit price or a VAT rate misread that way
  and flags it; a misread name or time stays as the OCR read it. Review: the date is often after today, so
  `FUTURE_DATE` must be accepted explicitly before the receipt is confirmed; `REPAIRED_DIGITS` stays listed until the
  user edits or verifies that line; line crops show the printed row while the photo is in memory.
- **Mega Image** (photo read by OCR, or pasted text; `src/parsers/mega-image`): `name price` then the EAN on the next
  line (12 digits, kept as printed: a truncated or misread EAN stays so); no store name on the receipt, only a merchant
  line on the card slip (`COMERCIANT MEGA...`). The chain is found from that line or, without it, from the layout (at
  least two products, nearly all followed by an EAN); a different chain is the user's choice in the review. No VAT or
  payment rows are printed, so `totals.vat` and `paidBani` stay absent. Products stop at the `TOTAL` row (else at the
  slip); the digits-only line under it is not a product. The OCR of a low-resolution photo is read literally: when no
  unique confusable-digit fix explains a wrong price, `SUM_MISMATCH` is the flag. Review: the
  store is chosen in the review (the chain may arrive as `unknown`), the receipt follows the store chosen; misread prices
  are corrected against the line crop and the live sum, and `SUM_MISMATCH` stays until the lines add up to the total.
- **Other stores, OCR or pasted text** (`src/parsers/generic`): the fallback. `detect` is a constant 0.05 (0 for a PDF),
  so every specific parser wins. It reads `name total [class]` rows with the quantity above (`qty BUC x price`) or
  inline (`2 x 2,50`) and an EAN row below, `TOTAL` / `Subtotal` and `DATA ... ORA ...`; the chain is `unknown`
  (`UNKNOWN_CHAIN`) and the whole document carries `LOW_CONFIDENCE` (more clearly when the OCR confidence is low).
- **OCR digit repair** (`src/parsers/plain-text/repair.ts`, run last by the Lidl, Mega Image and generic parsers):
  only when `SUM_MISMATCH` or `LINE_ARITHMETIC` would fire (a receipt that validates is returned untouched). It looks
  for the fewest corrections of confusable digits (0/8, 5/6/9, 1/7) that make the receipt add up, with the checks of
  `validateReceipt`: every line that prints a unit price and fails `qty x unit = total` has to be fixed in its own
  numbers, a line that holds is never touched, and at most one more number may change (the total of a line without a
  unit price, or the grand total): at most 3 corrections. It is applied **only when that fix is unique**; each repaired
  line gets `REPAIRED_DIGITS` with its `lineIdx` (the VAT rate of a store's `TVA` table is document-level, without
  `lineIdx`). When several fixes tie, nothing is changed and the lines that could hold the error get `LOW_CONFIDENCE`;
  when none exists, nothing is flagged beyond the validation warnings. A repair is evidence, not proof: a lost or
  inserted digit is never repaired, and the review shows the line crop.
- **Kaufland / METRO** (review): `totalBani` is the goods total and `paidBani` ("Plătit") the amount after a voucher; a
  METRO difference of 1 ban between Σ lines and the total is inside the tolerance and raises no warning.

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
| `aliases`            | `chain?` (absent = every chain), `normName` (`normalizeName(rawName)`, or `ean:<digits>` for an EAN-only alias that `mergeProducts` leaves so a merged product's code still finds the survivor: it can never equal a normalised printed name), `rawName?`, `ean?`, `productId`, `defaultPack?` `{qty, unit, unitsPerPack?}` |
| `categories`         | `name`, `parentId?`, `color` (`#rrggbb`), `icon` (emoji), `order`, `system?`                                     |
| `lists` / `listItems` | list: `name`, `archivedAt?`; item: `listId`, `productId?`, `label`, `qty?`, `unit?`, `note?`, `checked`, `checkedAt?`, `order` |

Derived line fields are computed only by `unitPricing()` (through `saveReceipt`), never written by hand:
`paidUnitBani = round(lineTotalBani / qty)` and `pricePerBaseMilliBani` is the price per `baseUnit` in **milli-bani**
(1/1000 ban). `baseUnit` is `kg`/`l` for weighed items, otherwise the base of `packUnit`, or `buc` when the size is
unknown; compare prices only between lines that have the same `baseUnit`.

**Written by the import and review screens** (`src/import`, docs/architecture.md §12):

- A receipt is saved as `draft` right after the import, so that `bonuri/:receiptId` can open it, and becomes `confirmed`
  when the user confirms it (which needs `purchasedAt`). Originals are never stored: `source.fileHash` is the SHA-256 of
  the picked file (or of the pasted text), `source.fileName` the file's name, and `source.rawText` only the PII-free
  `raw` text of the parsed lines (absent when the parser gave none).
- `extraction.warnings` are the warnings standing at the last save: the review recomputes them after every edit, so a
  corrected price drops its `SUM_MISMATCH`, while an accepted `FUTURE_DATE`, `DUPLICATE` or `SUM_MISMATCH` stays listed.
- `lines.idx` keeps the printed order; deleting a line leaves a gap and new lines go last. A line's `productId`,
  `categoryId` and pack come from the catalog's suggestions or the user's choice; non-product lines never carry a product.

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

**Sync repository (`pretometru-data`, a private GitHub repository; docs/architecture.md §13)**: the same records as the
backup, tombstones included, one JSON file per table and creation month: `data/<table>/<YYYY-MM>.json` =
`{ "records": [...] }` with one record per line, sorted by id (the month comes from the record's ULID, so a record never
changes file). Also `data/settings.json` (portable settings only) and `data/pretometru.json`
(`{ "format": "pretometru-data", "formatVersion": 1 }`). The merge is the backup's `merge` import: last write wins per
record on `updatedAt`, and the lines of every touched receipt are reconciled. A change that an older app cannot read
bumps `formatVersion` (`SYNC_FORMAT_VERSION`; the older app then refuses to sync instead of dropping data) and, like
every contract change, updates this file, the zod schemas and the fixtures together. The GitHub token is never part of it.
