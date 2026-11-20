# Architecture

Pretometru is a static, local-first PWA (GitHub Pages, no backend, cost 0). Product decisions live in
[`plan.md`](plan.md), data contracts in [`contracts.md`](contracts.md). This document says **where code lives, who owns
it, what may import what, and how to add a screen without touching shared files**.

## 1. Layers and dependency rules

| Layer      | Folder                      | May import                              | Must not import                                  |
| ---------- | --------------------------- | --------------------------------------- | ------------------------------------------------ |
| Domain     | `src/domain`                | `zod`                                   | React, Dexie, storage, parsers, features, app, ui |
| Parsers    | `src/parsers`               | domain                                  | React, Dexie, storage, features, app, ui         |
| Storage    | `src/storage`               | domain, Dexie                           | React, features, app, ui                         |
| Logic      | `catalog`, `analytics`, `import`, `sync`, `ai`, `ocr` | domain, parsers, storage, each other (no cycles) | features, app, ui (keep them React-free)        |
| UI         | `src/features/<name>`       | everything above, `src/app`, `src/ui`   | **another feature's folder**                     |
| Shell      | `src/app`                   | `src/ui`; discovers features by glob    | importing features directly                      |

- `src/domain` and `src/parsers` are **pure**: no DOM, IndexedDB, network or clock (inject `now`). They run under
  Node/Vitest. ESLint enforces the import and global-variable bans (`eslint.config.js`).
- Features share code only through `src/ui`, `src/domain`, `src/storage` or a logic module, never by reaching into a
  sibling feature.
- Path alias: `@/` = `src/` (configured in `tsconfig*.json` and `vite.config.ts`).

## 2. Folder map and ownership

Owners are the todo ids from [plan §9](plan.md). "Shared" files take minimal, additive edits.

| Path                         | Purpose                                                              | Owner (todo)                          |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------- |
| `src/domain/`                | zod contracts, money/units/names/dates/pricing, ids                  | `domain-storage` (contract changes: contracts.md + schemas + fixtures together) |
| `src/storage/`               | Dexie schema + migrations, repositories, seed, JSON export/import    | `domain-storage`                      |
| `src/parsers/`               | parser registry, `parseReceipt`, `validateReceipt`, PDF row reconstruction (pure); one folder per store: `kaufland`, `metro` (`parsers-pdf-text`), `lidl`, `mega-image`, generic fallback (`parsers-ocr-text`) | `parsers-pdf-text`, `parsers-ocr-text` |
| `src/ocr/`                   | Tesseract.js worker (same-origin assets), pixel preprocessing, line crops; "paste text" needs no engine | `ocr-pipeline`                        |
| `src/import/`                | file -> engine -> parser -> `ParsedReceipt` -> storage orchestration | `import-review-ui`                    |
| `src/import/pdf/`            | pdf.js adapter: `extractPdfText(ArrayBuffer)` -> `ReceiptSource`; the only importer of `pdfjs-dist`, worker bundled locally and loaded lazily | `parsers-pdf-text` (the rest of `src/import/` is `import-review-ui`) |
| `src/catalog/`               | product matching (alias -> EAN -> fuzzy -> new), auto-categories, merge/split (§5a) | `catalog-matching`                    |
| `src/analytics/`             | price observations, unit price, cheapest store, trends               | `price-analytics`                     |
| `src/sync/`                  | GitHub sync (LWW + tombstones)                                       | `sync-github`                         |
| `src/ai/`                    | optional Gemini extraction                                           | `ai-gemini-optional`                  |
| `src/pwa/`                   | service worker registration, update prompt, offline/share-target     | `pwa-offline-share` (scaffold: `scaffold-pwa`) |
| `src/features/home`, `stats` | dashboard and statistics screens                                     | `insights-dashboard` (until then `price-analytics`) |
| `src/features/add-receipt`, `receipts` | add receipt, receipt list, review (`bonuri/:receiptId`)    | `import-review-ui`                    |
| `src/features/products`      | products by category, product page                                   | `catalog-matching`, `price-analytics` |
| `src/features/lists`         | shopping lists                                                       | `shopping-lists`                      |
| `src/features/settings`      | settings shell; sections are contributed by other features           | shell: `scaffold-pwa`; sections: their feature owners |
| `src/app/`                   | app shell: router, layout, navigation, feature registry              | `scaffold-pwa` (shared)               |
| `src/ui/`                    | shared presentational components and icons                           | shared (additive edits)               |
| `config/`                    | build-time helpers (CSP plugin); Node only, never bundled            | `scaffold-pwa`                        |
| `scripts/`                   | Node scripts: leak check (`check-leaks.ts`), fixture sanitizer       | `sample-fixtures`                     |
| `tests/`                     | cross-cutting tests (`tests/fixtures.test.ts`)                       | shared                                |
| `tests/fixtures/`            | sanitized real samples, synthetic cases, typed loader (see §7)       | `sample-fixtures` (others: read only) |
| `public/`, `design/`         | static assets and icon sources                                       | `scaffold-pwa`                        |

## 3. App shell: adding a screen without editing shared files

Routing is a **hash router** (`createHashRouter`): GitHub Pages cannot rewrite unknown paths to `index.html`.

Every folder `src/features/<name>/` default-exports a `FeatureModule` from `feature.ts`. `src/app/features.ts`
discovers them with `import.meta.glob`, `buildRoutes` (`src/app/routes.tsx`) mounts all their routes under one layout
(app bar + navigation), and `assertValidFeatures` (`src/app/registry.ts`) fails fast on duplicate feature ids,
duplicate route paths (even with different `:param` names), duplicate settings-section ids and nav links that point to
no route.

```ts
// src/features/products/feature.ts
import { defineFeature } from '@/app/feature';

export default defineFeature({
  id: 'products', // = folder name, unique
  nav: { to: '/produse', label: 'Produse', icon: 'tag', order: 40 }, // optional
  routes: [
    // paths are relative to the app root; titles are Romanian and feed the app bar
    { path: 'produse', handle: { title: 'Produse' }, lazy: () => import('./ProductsScreen') },
    { path: 'produse/:productId', handle: { title: 'Produs' }, lazy: () => import('./ProductScreen') },
  ],
});
```

```tsx
// src/features/products/ProductsScreen.tsx: lazy route modules export `Component`
export function Component() {
  return <p>...</p>;
}
```

- `nav.placement`: `'tab'` (bottom bar on phones, sidebar on wide screens; default, keep to about five) or
  `'header'` (icon in the app bar). `nav.emphasis` highlights the main call to action.
- The app bar shows `handle.title` of the deepest matching route. The nav `label` and the route title of its target
  must be equal; the shell test renders every nav destination and checks the heading.
- A thrown error inside a screen is caught by a boundary **inside** the layout, so navigation stays usable.
- **Settings sections**: a feature adds a card to the Settings screen with
  `settingsSections: [{ id, title, order, Component: lazy(() => import('./MySection')) }]`; nobody edits
  `SettingsScreen`. Use `order` < 1000 to appear before "Despre aplicație".
- New icons go in `src/ui/icons.tsx` (`IconName` union + one glyph).
- UI strings are Romanian; identifiers, comments and commit messages are English.

## 4. Domain layer (`src/domain`, import from `@/domain`)

Pure TypeScript plus `zod`; the zod schemas are the executable source of truth for [`contracts.md`](contracts.md).
Change a contract by editing the schema, `contracts.md` and the affected fixtures in the same commit.

| Module              | What it gives you                                                                                          |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| `parsed-receipt`    | `ParsedReceiptSchema`, `ParsedLineSchema`, `ParseWarning`, `Chain`, `DocType`, `LineKind`, `WarningCode` (+ `CHAINS`, ...) |
| `receipt-source`    | `ReceiptSourceSchema` (`pdf-text`, `ocr-text`, `pasted-text`), `PdfTextItem`, `OcrLine`, the `ReceiptParser` interface |
| `entities`          | persisted record schemas and types (`Store`, `Receipt`, `Line`, `Product`, `Alias`, `Category`, `List`, `ListItem`, `KeyValue`) and `SYNCED_ENTITY_SCHEMAS` |
| `money`             | `parseBani` (`"1.234,56"`, `"2,49-"`), `formatBani`/`formatLei`, `mulDiv`/`roundDiv` (exact, half away from zero), `sumBani`, `netFromGross`/`grossFromNet`/`vatFromGross`, `formatMilliBani` |
| `units`             | `QtyUnit`/`PackUnit`/`BaseUnit`, `parsePackSize("... 8G*4")` (flags `ambiguous` for a spaced `8G * 4`), `baseUnitOf`, `toMilliBase` |
| `pricing`           | `unitPricing({ lineTotalBani, qty, qtyUnit, pack })` -> `paidUnitBani`, `baseUnit`, `pricePerBaseMilliBani`      |
| `names`             | `normalizeName` (the stable alias key: no diacritics, `1 L` -> `1l`)                                         |
| `dates`             | `isValidPurchasedAt`, `parsePurchasedAt`, `todayKey(now)`, `shiftDateKey`, `isFutureDate(purchasedAt, now)`   |
| `ids`               | ULIDs: `newId()`, `createIdGenerator`, `IdSchema`, `idTimestamp`                                              |
| `seed`              | `SEED_CATEGORIES`, `NON_PRODUCT_CATEGORY_ID`                                                                 |
| `settings`          | `SETTING_DEFINITIONS` (schema, default, `portable`), `isPortableSetting`                                       |
| `backup`            | `BackupSchema`, `createBackup`, `serializeBackup`, `parseBackup` (text; never throws, returns `errors`/`warnings`), `validateBackup` (object) |
| `common`            | `BaniSchema`, `QtySchema`, `InstantSchema`, `EanSchema`, ...                                                  |
| `testing`           | **test-only** builders `makeStore()`, `makeReceipt()`, `makeLine()`, ... (valid, deterministic ids and dates); not re-exported |

Rules of thumb:

- **Money is integer bani**, always. Use `mulDiv`/`roundDiv` for division, never `/` and `Math.round`.
- **Never throw from parsers**: use `parseBani`, `parsePackSize`, `parsePurchasedAt` (they return `undefined`); the
  `format*`/`mulDiv`/`unitPricing` helpers throw `RangeError` on programming errors (non-integers, `qty <= 0`).
- **Inject the clock** (`isFutureDate(date, now)`); the Lidl sample is dated in the future.
- Add a **new setting** to `SETTING_DEFINITIONS` (no migration needed). It is exported/synced only with `portable: true`;
  leave it `false` for secrets and device-specific values.

## 5. Storage layer (`src/storage`, import from `@/storage`)

Dexie/IndexedDB with the whole plan §6 model defined up front (ten tables, see [`contracts.md`](contracts.md)). Records
have `id` (ULID), `updatedAt` and `deletedAt`; `settings` and `syncState` are key-value tables.

```ts
import { getDb, saveReceipt, findDuplicateReceipts, listActive, createRecord } from '@/storage';

const db = await getDb(); // opens once, runs migrations, seeds the categories
const duplicates = await findDuplicateReceipts(db, { fileHash, storeId, purchasedAt, totalBani });
const { receipt, lines } = await saveReceipt(db, receiptInput, lineInputs); // transactional, derives unit prices
const products = await listActive(db.products);
```

| Function                                                      | Purpose                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `getDb()` / `openDb(options)`                                 | the shared database / open one (migrations + `ensureSeed`)                                |
| `createRecord`, `updateRecord`, `softDelete`, `getActive`, `listActive`, `purgeTombstones` | generic CRUD for the synced tables: ids, `updatedAt`, zod validation and tombstones are handled |
| `saveReceipt(db, receipt, lines)`                             | create or edit a receipt and replace its lines in one transaction; computes `paidUnitBani`, `baseUnit`, `pricePerBaseMilliBani`; non-product lines default to the Non-produs category |
| `getReceiptWithLines`, `deleteReceipt`                        | live receipt with its lines in printed order / tombstone both together                    |
| `findDuplicateReceipts(db, candidate)`                        | same file hash, or same store + day + total (+ receipt number): feeds the `DUPLICATE` warning |
| `getSetting`/`setSetting`                                     | typed settings with defaults (`SETTING_DEFINITIONS`)                                      |
| `getKeyValue`/`setKeyValue`/`deleteKeyValue`                  | free-form JSON values in `db.settings` or `db.syncState` (the sync session keeps its token and cursor in `syncState`); deleting leaves a tombstone with `value: null`, so a deleted token does not stay on disk |
| `exportBackup(db)` / `importBackup(db, backup, { mode })`     | `exportBackup` returns `{ backup, skipped }` (valid records only; `skipped` lists rows that no longer satisfy their schema); `importBackup` validates its argument, then `merge` is last-write-wins by `updatedAt` and `replace` swaps the data |
| `reconcileReceiptLines(db, receiptIds)`                       | tombstones live lines older than the receipt's `linesUpdatedAt` (called by `importBackup`; sync must call it after merging records) |

Conventions every session must follow:

1. **Write through these helpers**, not with raw `db.table.put/add/delete`: they stamp `updatedAt`, validate with the
   zod schema and leave tombstones. A raw write that forgets `updatedAt` silently breaks sync and merge imports.
2. **Never hard-delete** synced records (`softDelete`); read with `listActive`/`getActive` so tombstones stay hidden.
3. **Derived line fields come only from the helpers.** `saveReceipt` creates and replaces lines and derives their
   prices; `updateRecord(db.lines, ...)` re-derives them when a total, quantity or pack changes (this is what
   `alias.defaultPack` uses); `createRecord(db.lines, ...)` is refused.
4. **Merging record by record is not enough for lines.** Two devices can re-save the same receipt with different line
   sets; `saveReceipt` stamps `receipt.linesUpdatedAt`, and `reconcileReceiptLines` tombstones lines older than it.
   Any code that merges records from another source (sync) must call it for the receipts it touched.
5. A synced table must also appear in `SYNCED_ENTITY_SCHEMAS` (backups carry it); a test fails otherwise.
6. Secrets (GitHub token, Gemini key) go in `syncState` or in a non-portable setting, never in a synced table.

**Adding an index or transforming data**: append a `Migration` to `MIGRATIONS` in `src/storage/migrations.ts`; never edit a
released one. List only the tables that change; `upgrade` runs once for databases below that version:

```ts
{
  version: 2,
  stores: { products: 'id, categoryId, ean, name, brand, deletedAt, updatedAt' }, // full index string of that table
  upgrade: (tx) => tx.table('products').toCollection().modify((p) => { p.brand ??= undefined; }),
}
```

Adding a **non-indexed field** needs no migration; add it as an optional field in the zod schema and in `contracts.md`.
Dexie returns records unvalidated, so treat optional fields defensively. When another tab upgrades the schema, Dexie
closes this tab's connection and reopens it on the next query (`getDb()` keeps returning the same instance).

**Tests** use an in-memory IndexedDB: `const db = await createTestDb()` from `src/storage/testing.ts` returns an empty,
unseeded database (call `ensureSeed(db)` if the test needs the categories); `makeReceipt()`, `makeLine()`, ... come from
`src/domain/testing.ts`. Both modules are test-only and are not re-exported from the barrels.

## 5a. Catalog (`src/catalog`, import from `@/catalog`)

React-free logic over the domain and storage layers: it turns printed receipt lines into products and remembers the
user's choices. The Review screen builds its mapping UI on this interface.

```ts
import { suggestMappings, rememberMappings, searchProducts, createProduct } from '@/catalog';

const mappings = await suggestMappings(db, parsedReceipt); // one LineMapping per line, same order
// ...the user confirms or corrects, the receipt is saved with saveReceipt(), then:
await rememberMappings(db, parsedReceipt.chain, [{ rawName, ean, productId, pack }]);
```

| Function                                          | Purpose                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `suggestMappings(db, receipt)`                    | `LineMapping[]`: `{ productId?, categoryId?, pack?, via, candidates }` for every line         |
| `searchProducts(db, query, limit = 20)`           | type-ahead by name, brand or EAN prefix (diacritics, case and punctuation never matter); similar words (typos) follow |
| `createProduct(db, input)`                        | new product; refuses an empty name, an unknown category and the system Non-produs category    |
| `rememberMappings(db, chain, choices)`            | upserts one alias per chain + normalised name (with EAN and `defaultPack`); all or nothing    |
| `setAliasDefaultPack(db, aliasId, pack \| undefined)` | sets or clears the size an alias assumes, and re-derives the stored lines that used the old one |
| `mergeProducts(db, intoId, fromIds)`              | folds duplicates into one: lines, aliases and list items move, the duplicates become tombstones, their EAN survives as an EAN-only alias |
| `splitProduct(db, sourceId, { lineIds, target })` | moves chosen purchases to an existing or new product; an alias follows only when all its lines move |
| `categoryForHint(header)`                         | seed category for a printed section header ("Mopro/Brânză/Ouă" -> Lactate & ouă) or `undefined` |

How a line is matched, in this order (`via` names the first step that applied):

1. **alias**: the newest live alias of `(receipt.chain, normalizeName(rawName))`, else one without a chain. An alias of
   another chain is deliberately not assigned: the same printed name can be a different product elsewhere (its product
   is still offered as a candidate, step 3).
2. **ean**: the product, or the alias rows, that carry the code (UPC-A and EAN-13 spellings compare equal). Assigned only
   when the code has at least 8 digits (shorter ones are truncated prints) and exactly one product claims it;
   otherwise the products only become candidates.
3. **fuzzy**: likely products in `candidates` (at most 5), best first, `score` 0..1 (higher is better, never 1). Never
   assigned. The line's words are looked up in a fuse.js index of the catalog's words (typos and truncated words such
   as "SMANT" are fine; numbers and sizes must match exactly), and every spelling of a product (its name and the aliases
   pointing at it) is scored on how much of it the line contains and how much of the line it explains.
4. **category-hint**: the line's `storeCategoryHint` mapped onto a live seed category (`categoryId`, no product). The
   category is also filled when step 3 found candidates (`via` stays `fuzzy`).
5. **none**.

Only `alias` and `ean` set `productId` (with the product's `categoryId`; the product is also `candidates[0]`, score 1):
a wrong silent merge is worse than a missing one. `pack` is set only when an alias remembers a size that the printed
name lacks and the line is sold by the piece; a size printed on the receipt always wins. Non-product lines get the
Non-produs category and are never matched.

**Pack sizes and stored lines.** When an alias's `defaultPack` is set, changed or cleared (`rememberMappings` with a
`pack`, or `setAliasDefaultPack`), the stored lines of that alias (same product, same normalised name, same chain, sold by
the piece) that have no size or still carry the old default get the new one through `updateRecord(db.lines, ...)`, which
re-derives their unit prices. Lines with a size of their own are never touched. This is how Mega's unsized "HARTIE
IGIENICA" becomes 2,00 lei per roll once the alias knows it is 8 rolls.

**Merge and split keep one rule: a printed name has one product.** `mergeProducts` and `splitProduct` set the moved
lines' `categoryId` to the target's category (a line with a product takes the product's category) and move the
aliases with them, so the next import of the same printed name follows the user's decision.

## 6. Build, PWA and CSP

- `vite.config.ts`: base `/pretometru/` (override with `BASE_PATH` if the repo is renamed). The `test` mode skips the
  PWA, CSP and Tailwind plugins.
- PWA (`vite-plugin-pwa`, `generateSW`, `registerType: 'prompt'`): the app shell is precached
  (`workbox.globPatterns`); `src/pwa/UpdatePrompt.tsx` asks before activating a new version so an update never
  interrupts data entry. Large assets (WASM, traineddata) are added to the precache or `runtimeCaching` by
  `pwa-offline-share`.
- CSP is a `<meta>` tag injected at **build time only** by `config/csp.ts` (the dev server needs inline scripts and
  websockets). Allowed remote origins are exactly those of plan §11: `api.github.com` and
  `generativelanguage.googleapis.com`. `config/csp.test.ts` fails if another origin or `unsafe-inline`/`unsafe-eval`
  scripts appear, so widening the policy is a deliberate edit of both files plus the plan.
- No CDN, analytics or font is fetched at runtime; the font stack is the system one.
- Icons: `public/favicon.svg` (rounded, "any") and `design/icon-maskable.svg` (full-bleed) are the sources of the PNGs
  in `public/`. Regenerate by rendering each SVG at 512 px with headless Chrome
  (`--headless=new --screenshot --window-size=512,512`) and downscaling with `sips -z 192 192` / `sips -z 180 180`.

## 7. Testing conventions

- Vitest, **colocated** `*.test.ts(x)` next to the code; cross-cutting tests and fixtures under `tests/`.
- Default environment is `node`. DOM tests start with `// @vitest-environment jsdom` and call `cleanup` in
  `afterEach`. Prefer real code over mocks; build tooling is tested with real Vite builds (`config/csp.test.ts`).
- Anything time-dependent takes an injectable `now` (the Lidl sample is dated in the future).
- Run one file: `npx vitest run src/app/registry.test.ts`.

### Fixtures (`tests/fixtures`)

Ground truth for the parsers, the review UI and analytics. Other sessions **only read** this folder; the owner
(`sample-fixtures`) changes it. Import through the typed loader, never from production code:

```ts
import { fixtures, getFixture, sourceOf, normalizeForGolden } from '@fixtures';

const fx = getFixture('kaufland-2026-11-07');
const { source, expected } = sourceOf(fx, 'pdf-text'); // typed: source.kind === 'pdf-text'
expect(normalizeForGolden(parse(source))).toEqual(normalizeForGolden(expected));
```

```
tests/fixtures/
  index.ts                      typed loader (`@fixtures`), validates every file against the domain schemas
  README.md                     provenance, how to add a case, privacy rules
  real/<id>/                    sanitized real receipts: kaufland-2026-11-07, metro-invoice-2026-08-12, ...
  synthetic/<id>/               hand-made edge cases (always labelled synthetic)
    case.json                   { description, origin: 'real' | 'synthetic', now, notes? }
    expected.json               ParsedReceipt ground truth (meta.engine 'fixture')
    source.pdf-text.json        ReceiptSource kind 'pdf-text': pdf.js items { str, x, y, w, h }, whitespace items included
    source.ocr-text.json        kind 'ocr-text': raw Tesseract output (text, lines with confidence + bbox)
    source.pasted-text.json     kind 'pasted-text': clean text, as iOS Live Text / Google Lens would give it
    expected.<kind>.json        optional: a different perfect answer for one source kind
```

| Export                          | Meaning                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `fixtures`                      | every case, real first then synthetic, each `{ id, group, description, notes, now, expected, sources[] }` |
| `getFixture(id)`                | one case; throws and lists the available ids when unknown                                    |
| `sourceOf(fixture, kind)`       | `{ kind, source, expected }` for that source kind (`expected` = `expected.<kind>.json` or the case's `expected.json`); throws when the case has none |
| `normalizeForGolden(receipt)`   | drops what a golden comparison must ignore: `meta.engine/parser/parserVersion/confidence`, line `confidence/bbox/raw`, warning `message` and order. Warning codes and `lineIdx` still have to match |

Conventions every case follows (checked by `tests/fixtures.test.ts`):

- **Clock.** `case.json.now` is the injectable clock. The Lidl receipt is dated after it, so its ground truth carries
  `FUTURE_DATE`. `expected.json` is what a perfect parser returns **at `now`**, warnings included: the ones that follow
  from the receipt (`SUM_MISMATCH` beyond 5 bani, `LINE_ARITHMETIC` beyond 1 ban, `VAT_MISMATCH` beyond 5 bani per rate,
  `FUTURE_DATE`, `MISSING_DATE`, `UNKNOWN_CHAIN`) must be present exactly when they apply.
- **Money** is integer bani, VAT-inclusive. `lineTotalBani` is what was charged after the line discount;
  `unitPriceBani` appears only when a unit price is printed (never for weighed or single-quantity lines).
  Ex-VAT invoices (METRO) convert the printed ex-VAT discount with `round(discount * (1 + rate / 100))` and print no
  `unitPriceBani`.
- **Names** are exactly as printed (`rawName`), `pack` is what `parsePackSize(rawName)` returns, `ean` is kept as
  printed (13 digits carry a valid check digit; a truncated one stays truncated), `storeCategoryHint` is the section
  header printed above the line.
- **Raw OCR keeps its mistakes.** `source.ocr-text.json` is real Tesseract output; `expected.json` is the truth, and
  `case.json.notes` lists the known misreads. Score OCR parsers with the plan §10 metrics (total, % of lines, exact
  price) unless the case has an `expected.ocr-text.json`.
- **Sanitized, not edited.** Personal rows of real receipts (loyalty card, card slip, buyer block, phone and bank lines)
  are masked in place: letters become `x`/`X`, digits `0`, so the document keeps its shape and a parser must skip
  those rows. Document numbers are fakes (`12345`, `1234567890123456`). Do not "repair" masked rows.
- Adding a case = adding a folder with `case.json`, `expected.json` and at least one `source.<kind>.json`; the loader
  and `tests/fixtures.test.ts` pick it up. Contract changes update `docs/contracts.md`, the schemas and every affected
  `expected*.json` in one commit.

## 8. Commands

| Command                                            | What it does                                          |
| -------------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                                      | dev server, <http://localhost:5173/pretometru/>       |
| `npm run lint`                                     | ESLint (type-aware) + `prettier --check`              |
| `npm run format`                                   | Prettier write (Markdown and `public/` are ignored)   |
| `npm run typecheck`                                | `tsc -b` (app + node projects)                        |
| `npm test`                                         | Vitest, single run                                    |
| `npm run build` / `npm run preview`                | production build / serve it at <http://localhost:4173/pretometru/> |
| `npm run check:leaks`                              | leak scan of every tracked file (also the pre-commit hook and a CI step) |
| `npm run check`                                    | leaks + lint + typecheck + test + build (the pre-push gate) |

Git flow (trunk-based): branch, `git fetch && git rebase origin/main`, `npm run check`, `git push origin HEAD:main`.
CI (`.github/workflows/ci.yml`) runs the same steps and, on `main`, deploys `dist/` to GitHub Pages.
`npm install` points `core.hooksPath` at `.githooks/`, whose pre-commit hook runs the leak scan on the staged files
(generic rules for IBANs, card numbers, phones, e-mails, tokens and loyalty/client numbers, plus an optional private
denylist in `~/.pretometru-private/denylist.txt`). It prints `file:line:column rule`, never the value.

## 9. Dependency notes

- TypeScript is pinned to `~6.0` because `typescript-eslint` supports `<6.1`; move to TS 7 when it does.
- `overrides.workbox-build.glob` pins a patched `glob` (advisory in `workbox-build`'s dependency). Remove it when
  `workbox-build` updates. Do **not** run `npm audit fix --force`: it downgrades `workbox-build`.
- Node `^22.22 || ^24 || >=26` (React Router 8); CI and `.nvmrc` use Node 26.
- TypeScript flags worth knowing: `noUncheckedIndexedAccess` (index results are `T | undefined`),
  `verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no enums, namespaces or parameter properties).

## 10. Parsers (`src/parsers`, import from `@/parsers`)

Pure (see §1): a `ReceiptSource` goes in, a `ParsedReceipt` comes out, nothing throws. Contracts: [`contracts.md`](contracts.md).

```ts
import { parseReceipt } from '@/parsers';

const receipt = parseReceipt(source, { now: new Date() }); // best parser + validation warnings
```

| Export                                  | Purpose                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `parseReceipt(source, { now })`         | runs every parser's `detect`, parses with the best one (ties: registry order), appends the `validateReceipt` warnings, never throws. A parser that throws is skipped for the next best; a document nobody recognises comes back with no lines and `UNKNOWN_CHAIN`, `MISSING_TOTAL`, `MISSING_DATE` |
| `validateReceipt(receipt, { now })`     | `SUM_MISMATCH`, `LINE_ARITHMETIC`, `VAT_MISMATCH`, `FUTURE_DATE`, `MISSING_DATE`, `MISSING_TOTAL`; `DUPLICATE` needs the database, so the import orchestrator adds it (`findDuplicateReceipts`) |
| `check*`, `sumOfLines`, `expectedLineTotal`, `*_TOLERANCE_BANI` | the individual checks and their tolerances, exported for reuse (OCR digit repair) |
| `engineForSource(source)`               | `meta.engine` of a source kind: `pdf-text` -> `pdfjs`, `ocr-text` -> `tesseract`, `pasted-text` -> `paste` |
| `parsers`, `rankParsers`, `parseReceiptWith(parsers, source, opts)` | the registry, and `parseReceipt` over an explicit parser set (tests) |

**Adding a parser**: create `src/parsers/<id>/index.ts` that default-exports a `ReceiptParser`
(`{ id, version, detect, parse }`). `src/parsers/registry.ts` discovers it with `import.meta.glob`, so no shared file
changes; a test fails on duplicate ids or a version that is not semver.

- A parser folder imports shared helpers from the specific modules (`../validate`, `../source`, `../pdf-rows`), never
  from the `@/parsers` barrel: the barrel imports the registry, which imports every parser (an import cycle).
- `detect` answers 0..1 (0 = not mine). The generic fallback answers a low constant so any specific parser wins.
- `meta.parser` is the folder id, `meta.engine` comes from `engineForSource`, `meta.parserVersion` is semver: bump it
  when the output for the same input changes.
- Report problems as `warnings`, never by throwing. Leave the arithmetic checks to `validateReceipt`; a total that cannot
  be found is `grandTotalBani: 0` (see the warning notes in `contracts.md`). Warning messages are Romanian.
- Tests: a golden test per `tests/fixtures/<store>/` plus small synthetic cases next to the parser. `makeParsedReceipt()`
  and `makeParsedLine()` (`@/parsers/testing`, test-only) build valid receipts.

## 11. OCR (`src/ocr`, import from `@/ocr`)

React-free logic around Tesseract.js. Importing `@/ocr` costs almost nothing: the engine (a 17 KB loader, a 3.9 MB WASM
core, 4.6 MB of language data) loads on the first `recognizeImage` call, never with the app shell.

```ts
import { recognizeImage, cropRegion } from '@/ocr';

const source = await recognizeImage(file, { signal, onProgress: (fraction) => setProgress(fraction) });
// source: { kind: 'ocr-text', text, lines, confidence, imageSize }, ready for parseReceipt()
const crop = await cropRegion(file, source.lines![3].bbox, { padding: 6 }); // PNG Blob of one printed row
```

| Export                                           | Purpose                                                                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `recognizeImage(image, { signal?, onProgress?, preprocessing? })` | photo or screenshot -> `ocr-text` source. `text.split('\n')[i]` is `lines[i]`: one **printed row** per line (fragments that Tesseract's layout analysis split are merged), `lines[i].confidence` is 0-100, `lines[i].bbox` is in pixels of the **original** image (EXIF rotation applied), `confidence` is the page mean, `imageSize` the original size |
| `cropRegion(image, bbox, { padding? })`          | cuts a box (original-image pixels, clipped to the image) out of the original as a PNG, for review crops |
| `OcrError` (`code`: `DECODE_FAILED`, `ENGINE_FAILED`, `EMPTY_REGION`) | what the module throws; an aborted call rejects with the signal's `AbortError` instead     |
| `ocrEngine.dispose()`                            | terminates the worker now (it also stops by itself after 60 s without work)                   |
| `DEFAULT_PREPROCESS`, `PreprocessOptions`        | the tunable preprocessing (see below)                                                          |

How it works:

- **Preprocessing** (`preprocess.ts`, pure typed-array code: the same under Node): pick the cleanest colour channel
  (`'auto'` = best ink/paper separation; the Mega Image photo reads best in red, a screenshot in any), bilinear upscale
  (3x, reduced so the result stays under 12 megapixels: iOS Safari canvases stop at about 16.7), 1st-99th percentile
  contrast stretch, Otsu threshold. Photos above 16 megapixels are shrunk before their pixels are read. The result goes
  to Tesseract as a PNG written by `png.ts` (stored deflate blocks: no compressor, identical in every runtime).
- **Engine** (`engine.ts`): one LSTM-only worker for `ron+eng`, page segmentation mode 6 (one block, which keeps
  "name ..... price" together), started lazily, reused between calls, terminated when idle or **aborted** (the only way
  to cancel a running job). Jobs run one at a time. `onProgress` is 0..1 and never decreases.
- **Same origin**: the worker script, the three LSTM-only core variants (Tesseract.js picks relaxed SIMD, SIMD or plain by
  feature detection) and `ron`/`eng` `traineddata.gz` are served from `<base>ocr/` (`worker.min.js`, `core/*.wasm.js`,
  `lang/*.traineddata.gz`). `config/ocr-assets.ts` copies them from `node_modules` at build time (no binaries in git) and
  serves them in the dev server; the names are stable, not hashed. Tesseract.js's own default CDN paths are never used
  (`createWorker` always gets explicit paths, `cacheMethod: 'none'`). The existing CSP is enough
  (`worker-src 'self' blob:`, `script-src 'wasm-unsafe-eval'`); verified in headless Chrome against the production
  build: every request goes to the site's own origin and no policy violation is reported.
- **Offline**: `ocr/**` is excluded from the Workbox precache (about 16 MB). `pwa-offline-share` should cache it at run
  time (cache-first by URL); Tesseract.js's IndexedDB cache is off so the files are not stored twice.
- Tests are Node-only: pure preprocessing/PNG/row merging, the worker host with a fake factory, and a real Vite build of
  `ocrAssetsPlugin` (`config/ocr-assets.test.ts`). The browser parts (canvas decode, crop) are covered by a manual check.
