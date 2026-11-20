# Test fixtures

Sanitized real receipts and synthetic edge cases, each with ground truth, for the parsers, the review UI and
analytics. Layout, loader API (`@fixtures`) and conventions: [docs/architecture.md §7](../../docs/architecture.md).

## Cases

| id                         | origin | sources                    | covers                                                                                   |
| -------------------------- | ------ | -------------------------- | ---------------------------------------------------------------------------------------- |
| `kaufland-2026-11-07`      | real   | `pdf-text`                 | sections, `n * price` and weighed lines, deposit, bag, packaging voucher, 3 VAT rates, glued sizes |
| `metro-invoice-2026-08-12` | real   | `pdf-text`                 | ex-VAT invoice, per-line discounts, 2 VAT rates, size-first descriptions, online card payment |
| `lidl-2026-12-29`          | real   | `ocr-text`, `pasted-text`  | OCR digit confusions (`68L`, `9,18`, `11,80%`), per-unit `n,000 BUC x price` lines, 3 card payments, **future date** (`FUTURE_DATE`), `expected.ocr-text.json` |
| `mega-image-2026-11-03`    | real   | `ocr-text`, `pasted-text`  | very noisy OCR (watermark), EAN under each item (12 digits, truncated), chain only from the merchant code, `SUM_MISMATCH` on the OCR text, `expected.ocr-text.json` |

Synthetic edge cases follow.

## Privacy

The repository is public. The originals stay in `~/.pretometru-private/samples/` and are never copied, quoted or
logged. Everything committed here went through the sanitizer:

- Personal rows (loyalty card, card slip, buyer block, seller phone and bank lines, legal footer) are **masked in
  place**: letters become `x`/`X` and digits `0`, so length, position and punctuation survive and parsers still meet
  realistic noise. Document numbers, till and cashier numbers are fakes or zeros. Do not "repair" masked rows.
- Public business data (seller name, store address, CIF, ONRC) is kept.
- `npm run check:leaks` (also the pre-commit hook and a CI step) scans for IBANs, card numbers, phones, e-mails, tokens
  and loyalty/client numbers, and for every word or number the sanitizer removed (the private denylist in
  `~/.pretometru-private/denylist.txt`, absent in CI). It prints `file:line:column rule`, never the value.

## Producing a fixture from a new receipt

1. Keep the original in `~/.pretometru-private/samples/`.
2. Extract its text into `~/.pretometru-private/extracted/` (mode 600) as a `ReceiptSource` JSON (`pdfjs-dist` and
   `tesseract.js` are app dependencies, so `npm ci` is enough):
   - PDF with a text layer: pdf.js `getTextContent()` (`pdfjs-dist/legacy/build/pdf.mjs` under Node), one entry per
     page with the viewport `width` and `height` and the items as
     `{ str: item.str, x: item.transform[4], y: item.transform[5], w: item.width, h: item.height }`, in the order
     pdf.js returns them, empty strings dropped and whitespace-only items kept (their `h` is 0). The `src/import/pdf`
     adapter must produce this same shape.
   - Image: Tesseract.js output as `{ kind: 'ocr-text', text, lines: [{ text, confidence, bbox }], confidence, imageSize }`.
3. Add a recipe to `scripts/fixture-recipes.ts`: rows are selected by label or position (never by value), then masked
   or rewritten, and each rule says what it removes (`personal`, `identifiers` or `business`: only the first two feed the
   denylist). A rule that matches nothing fails the run, so a drifting extraction cannot leak silently. For an image
   add `pasted`: the misread lines (by index) and what the receipt actually prints, verified against the image.
4. `node scripts/sanitize-fixtures.ts <id>` writes `real/<id>/source.<kind>.json` (and `source.pasted-text.json` for
   an image) and adds the removed words and numbers to the private denylist (words that already appear in the
   repository are dropped from it). Without ids it rebuilds every fixture, byte-identical to what is committed.
5. Review the written source in full, then write `expected.json` and `case.json` by hand from the printed receipt
   (`expected.ocr-text.json` too when misreads make an exact match with the truth impossible).
6. `npm test` (schemas, arithmetic, warnings, sizes, EAN check digits and "ground truth is readable in the source")
   and `npm run check:leaks`.

Synthetic cases are written by hand, labelled `"origin": "synthetic"`, and contain no real data.
