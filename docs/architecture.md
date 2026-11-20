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
| Logic      | `catalog`, `analytics`, `import`, `lists`, `sync`, `ai`, `ocr` | domain, parsers, storage, each other (no cycles) | features, app, ui (keep them React-free)        |
| UI         | `src/features/<name>`       | everything above, `src/app`, `src/ui`   | **another feature's folder**                     |
| Shell      | `src/app`                   | `src/ui`; discovers features by glob    | importing features directly                      |

- `src/domain` and `src/parsers` are **pure**: no DOM, IndexedDB, network or clock (inject `now`). They run under
  Node/Vitest. ESLint enforces the import and global-variable bans (`eslint.config.js`).
- `src/catalog`, `src/analytics`, `src/import`, `src/lists` and `src/sync` are React-free: ESLint rejects `react`,
  `react-router` and imports of `@/features`, `@/app`, `@/ui` or `@/pwa` there (they may use `@/storage`).
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
| `src/import/`                | file -> engine -> parser -> `ParsedReceipt` -> draft receipt -> storage orchestration, the review working copy and the save path (§12) | `import-review-ui`                    |
| `src/import/pdf/`            | pdf.js adapter: `extractPdfText(ArrayBuffer)` -> `ReceiptSource`; the only importer of `pdfjs-dist`, worker bundled locally and loaded lazily | `parsers-pdf-text` (the rest of `src/import/` is `import-review-ui`) |
| `src/catalog/`               | product matching (alias -> EAN -> fuzzy -> new), auto-categories, merge/split (§5a) | `catalog-matching`                    |
| `src/analytics/`             | price observations, unit price, cheapest store, trends (§5b)         | `price-analytics`                     |
| `src/lists/`                 | shopping lists: list and item storage, cheapest place per item, grouping by store (§5d) | `shopping-lists`                      |
| `src/sync/`                  | GitHub sync: private data repo, one atomic commit per sync, last-write-wins + tombstones (§13) | `sync-github`                         |
| `src/ai/`                    | optional Gemini extraction                                           | `ai-gemini-optional`                  |
| `src/pwa/`                   | the service worker (`sw.ts`: shell precache, engine cache, Web Share Target), the update prompt, persistent storage, the page's side of the worker (§14) | `pwa-offline-share` (scaffold: `scaffold-pwa`) |
| `src/features/home`, `stats` | dashboard and statistics screens                                     | `insights-dashboard` (until then `price-analytics`) |
| `src/features/add-receipt`, `receipts` | add receipt (files, camera, pasted text, manual), receipt list, review (`bonuri/:receiptId`, §12) | `import-review-ui`                    |
| `src/features/products`      | products by category, product page (§5c)                             | `catalog-matching`, `price-analytics` |
| `src/features/lists`         | shopping lists: overview and list screens (§5d); "Adaugă pe listă" lives on the product page (`src/features/products/AddToList.tsx`) | `shopping-lists`                      |
| `src/features/sync`          | Settings section: GitHub onboarding, token, "Sincronizează acum", status (§13) | `sync-github`                         |
| `src/features/offline`       | Settings section "Offline și stocare": offline readiness, "Descarcă acum" for the engines, persistent storage (no routes, §14) | `pwa-offline-share`                   |
| `src/features/settings`      | settings shell; sections are contributed by other features           | shell: `scaffold-pwa`; sections: their feature owners |
| `src/app/`                   | app shell: router, layout, navigation, feature registry              | `scaffold-pwa` (shared)               |
| `src/ui/`                    | shared presentational components and icons                           | shared (additive edits)               |
| `config/`                    | build-time helpers (CSP plugin, OCR asset copy, the offline guard, §14); Node only, never bundled | `scaffold-pwa`; `ocr-assets*`: `ocr-pipeline`; `offline-guard*`: `pwa-offline-share` |
| `e2e/`                       | Playwright browser checks of the production build (`npm run e2e`, §14); not part of `check` or CI yet | `pwa-offline-share` (base for `qa-hardening`) |
| `scripts/`                   | Node scripts: leak check (`check-leaks.ts`), fixture sanitizer; the local OCR benchmark (`ocr-bench.ts`, §11) | `sample-fixtures`; `ocr-bench*` : `ocr-pipeline` |
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
   is still offered as a candidate, step 3). The same goes for the `unknown` chain, which is every shop nobody
   recognised rather than one shop: only an alias without a chain may assign there.
2. **ean**: the product, or the alias rows, that carry the code (UPC-A and EAN-13 spellings compare equal). Assigned only
   when the code has at least 8 digits (shorter ones are truncated prints; a placeholder of zeros never counts) and
   exactly one product claims it; otherwise the products only become candidates. When nothing carries the exact print,
   the other spelling of the code is tried: Mega Image prints the 12 digits of an EAN-13 without its check digit, and a
   valid EAN-13 is fixed by its first 12 digits, so a 12-digit print joins the one 13-digit code that completes it (and
   a valid 13-digit code joins its own 12-digit prefix). An exact print always wins over a joined one.
3. **fuzzy**: likely products in `candidates` (at most 5), best first, `score` 0..1 (higher is better, never 1). Never
   assigned. The line's words are looked up in a fuse.js index of the catalog's words (typos and truncated words such
   as "SMANT" are fine; numbers and sizes must match exactly), and every spelling of a product (its name and the aliases
   pointing at it) is scored on how much of it the line contains and how much of the line it explains.
4. **category-hint**: the line's `storeCategoryHint` mapped onto a live seed category (`categoryId`, no product). The
   category is also filled when step 3 found candidates (`via` stays `fuzzy`).
5. **none**.

Only `alias` and `ean` set `productId` (with the product's `categoryId` when that category still exists; the product is also
`candidates[0]`, score 1): a wrong silent merge is worse than a missing one. `pack` is set only when an alias remembers a
size that the printed name lacks and the line is sold by the piece; a size printed on the receipt always wins.
Non-product lines get the Non-produs category and are never matched.

**Pack sizes and stored lines.** `setAliasDefaultPack` (the deliberate edit) sets or clears an alias's `defaultPack` and
re-derives, through `updateRecord(db.lines, ...)`, the stored lines of that alias (same product, same normalised name,
same chain, sold by the piece) that have no size or still carry the old default. Lines with a different size are never
touched. `rememberMappings` (confirming a receipt) is gentler: the **first** size learned for a name fills in the stored
lines of that alias that have none, which is how Mega's unsized "CARE HARTIE 10R 3S" becomes 2,00 lei per roll once the
alias knows it is 10 rolls; a **later, different** size only becomes the new suggestion for the next import and never
re-prices other receipts (an older line that "has the default" cannot be told from one whose size somebody typed).

**Merge and split keep one rule: a printed name has one product.** `mergeProducts` and `splitProduct` set the moved
lines' `categoryId` to the target's category (a line with a product takes the product's category) and move the
aliases with them, so the next import of the same printed name follows the user's decision.

**Category hints.** `categoryForHint` reads the first department a header names ("Drogerie/Gospodărie/Hrană animale/Tabac"
is Curățenie & menaj); generic qualifiers (`Alimente`, `Nonfood`) only count when nothing more specific is named, and a
header that is too broad ("Delicatese/Convenience/Marinade") stays open. Every header of the Kaufland fixture is pinned
in `category-hints.test.ts`.

## 5b. Price analytics (`src/analytics`, import from `@/analytics`)

React-free. Turns confirmed receipts into price observations and answers "where is it cheapest?" (plan §7).

```ts
import { getProductSummary, listProductSummaries } from '@/analytics';

const summary = await getProductSummary(db, productId); // window and sale filter come from the settings
const rows = await listProductSummaries(db, { now, days: 30, excludeSales: true }); // every live product
```

| Function                                                | Purpose                                                                                     |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `loadObservations(db, productIds?)`                     | `Map<productId, PriceObservation[]>` (oldest first) from the live lines of confirmed receipts |
| `toObservations({ lines, receipts, stores })`           | the pure core of the above                                                                  |
| `cheapestPerStore(observations, { baseUnit, now, days?, excludeSales? })` | per store the lowest price in the last N days with its date, cheapest store first      |
| `priceChange(observations)`                             | trend and Δ: the latest price against the previous purchase **at the same store**           |
| `summarizeProduct(product, observations, options)`      | everything a product screen shows (pure)                                                     |
| `getProductSummary(db, id, options?)` / `listProductSummaries(db, options?)` | the same from the database; `options` default to the `priceWindowDays` and `excludeDiscountedPrices` settings and the clock |

Rules (each is covered by a test):

- **What counts**: live `product` lines of live, `confirmed`, dated receipts, with a product and a positive price.
  Deposits, bags, discounts and fees never count (plan §7.5); they still count towards the receipt total.
- **Per base unit**: prices are compared only within the product's `baseUnit`. A purchase in another unit (usually a line
  without a pack size) is reported as `incomparable` instead of being mixed in.
- **Window**: purchases from `today - days` onwards (default 90, today = the Bucharest day of `now`); a receipt dated in the
  future counts as the latest. A store last used before the window stays in `stores` without a `best`, for reference.
- **Sale prices**: `onSale` = the line has `discountBani > 0`; the price already includes the discount. `excludeSales`
  removes them from the comparison, the cheapest store and the trend, never from the history and chart.
- **Only at X**: `onlyAt` is set when every purchase ever, in any unit, was at one store (no comparison, plan §7.6): the
  product page then says so instead of showing a comparison or a "cheapest" banner.
- **Δ and trend**: `change = { from, to, deltaMilliBani, pct, direction }`; under 0,5 % is `flat`. Buying at another store in
  between is not a price move. `cheapestVsLastPct` is the other reading of Δ: the best price in the window against the
  last price paid (the products list shows both).
- Money stays integer milli-bani; only the percentages are floats (ratios).
- A standalone discount line (negative total) is not applied to the product above it: it counts towards the receipt total
  only. Parsers fold a discount into its product line (`discountBani`) whenever the receipt prints it that way.

## 5c. Product screens (`src/features/products`)

Routes `/produse` (products by category: last price, cheapest store, Δ, search) and `/produse/:productId` (per-store
comparison table, price chart, history, purchases that cannot be compared, merge and split). Everything is computed by
`@/analytics` and changed through `@/catalog`; the screens only render and call them.

- **Data**: `useLive.ts` (`useDb`, `useLiveQuery`, `useDbQuery`) runs a query as a Dexie `liveQuery`, so a screen follows
  imports, merges and the two comparison settings. The querier **must be an `async` function**: Dexie loses track of the
  tables a query reads across native `await`s otherwise, and the query silently never re-runs. `queries.ts` shapes the
  data (`loadOverview`, `loadProductPage`). An unavailable IndexedDB shows a message; the shell keeps working.
- **Settings**: the period (30 to 365 days, default 90) and "Fără prețuri la reducere" are the portable settings
  `priceWindowDays` and `excludeDiscountedPrices`, edited inline by `PriceFilters` on both screens.
- **Chart**: [uPlot](https://github.com/leeoniya/uPlot) (about 22 kB gzipped, canvas) in `PriceChart.tsx`, loaded with
  `React.lazy` only when a product with two purchases is opened; its stylesheet ships as a lazy CSS chunk. Nothing is
  fetched from a CDN, the chunk is precached (the product page and chart were checked offline in the built app), and uPlot
  only touches styles through the CSSOM, which the `style-src 'self'` policy allows. Days are plotted at 00:00 UTC.
- **Merge / split**: `MergePanel` folds the page's product into another; `SplitPanel` moves the ticked purchases to a new
  or an existing product. Both end on the product that received the data.
- **Prices**: shown per base unit (`1,30 lei/rolă`), with the shelf price of the pack where the unit price alone is hard
  to picture (`0,0583 lei/buc (6,99 lei / 120 buc)`).
- **Tests**: jsdom with `fake-indexeddb/auto` (the screens use the shared `getDb()`), `testing.ts` seeds the plan §7.7 toilet
  paper, only `Date` is faked (`vi.useFakeTimers({ toFake: ['Date'] })`, IndexedDB needs real timers) and the chart module
  is mocked because jsdom has no canvas. `tests/price-comparison.test.ts` is the §7.7 acceptance test and
  `tests/catalog-analytics-fixtures.test.ts` runs the catalog and analytics over every fixture.

## 5d. Shopping lists (`src/lists`, `src/features/lists`)

`src/lists` (import from `@/lists`) is React-free: list and item storage, where each item is cheapest, and the plan
grouped by store. The screens (`/liste`, `/liste/:listId`) and the product page's "Adaugă pe listă" are thin layers over
it, which is why a feature never has to import another one.

```ts
import { addProductToList, addTextItem, createList, loadListView, setItemChecked } from '@/lists';

const list = await createList(db, 'Săptămâna asta');
await addProductToList(db, list.id, product.id); // { item, status: 'added' | 'already' | 'reopened' }
await addTextItem(db, list.id, 'Pâine'); // free text: no product, so no price
const view = await loadListView(db, list.id); // { list, plan: { items, groups, estimateBani, ... }, windowDays, excludeSales }
```

| Function                                                           | Purpose                                                                                      |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `createList`, `renameList`, `archiveList`, `restoreList`, `deleteList` | list CRUD. Names are tidied (trimmed, one space) and must not be empty (`RangeError`); archiving sets `archivedAt`; `deleteList` tombstones the list and its live items with the same instant |
| `createListWithProduct(db, name, productId)`                       | a new list that starts with one product, in one transaction (the product page's "Listă nouă") |
| `addProductToList(db, listId, productId)`                          | puts a catalog product last on a list under its name. One that is still to buy answers `already` and adds nothing; a checked one is unchecked and moved last (`reopened`) |
| `addTextItem(db, listId, label)`                                   | a free-text item                                                                              |
| `updateItem(db, id, { label?, qty?, unit?, note? })`               | a key that is present with `undefined` clears the field, an absent key leaves it alone; `qty` must satisfy `QtySchema` (positive, up to 3 decimals), `unit` is `buc`, `kg` or `l` |
| `setItemChecked(db, id, checked)`                                  | `checkedAt` is the write's `updatedAt`; asking for the state the item is in writes nothing     |
| `removeItem`, `uncheckAll`, `removeCheckedItems`                   | tombstone / "start again" / "what was bought"                                                  |
| `moveItem(db, id, { before } \| { after })`                        | puts an item next to another one of the same list and numbers `order` 0, 1, 2... again; only the items whose position changed are written, so clashing or gappy numbers left by two devices heal |
| `loadListsOverview(db)`, `listOpenLists(db)`                       | lists with their item and checked counts (in use, newest first / archived, latest first); the lists a product can be added to |
| `loadListView(db, id, options?)`                                   | everything the list screen shows, in one read transaction; `options` (`now`, `days`, `excludeSales`) override the settings, for tests |
| `quoteItem`, `estimateCost`, `planList`, `sortItems`               | the pure core of the above, on already loaded data                                             |

All writes go through `createRecord`, `updateRecord` and `softDelete` (§5), inside one Dexie transaction where several
records change, and take the optional `StorageContext` (`now`, `newId`) so tests are deterministic. Item `order` is a
position in the list (new items get `max + 1`); the screens never show it.

**Where an item is cheapest.** `loadListView` builds one `ProductPriceSummary` per linked product with `loadObservations`
and `summarizeProduct` (§5b), the code of the product screens, and the same `priceWindowDays` and
`excludeDiscountedPrices` settings; `quoteItem` turns it into an `ItemQuote`:

| `kind`            | When                                                                                          | Store and price                                  |
| ----------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `only-at`         | every purchase ever, in any unit, was at one store: nothing to compare (plan §7.6)             | that store, at the last purchase (whatever its age) |
| `cheapest`        | the cheapest store of the window                                                               | that store, at its best purchase in the window   |
| `no-recent-price` | bought, but nothing to compare in the window (too old, or only sale prices with sales left out) | none; `last` is the most recent purchase, for reference |
| `incomparable`    | bought, but never in a size that can be compared (no pack size)                               | none                                             |
| `never-bought`    | a catalog product without a purchase                                                           | none                                             |
| `unlinked`        | free text, or a product that is gone                                                           | none                                             |

A store quote carries the purchase it comes from (`price`: date, price per base unit, `onSale`, pack), the base unit and
the estimate. **Estimates** (`estimateCost`) are whole bani, in integer arithmetic. No quantity means one, no unit means
the unit the price was paid in. kg or l for a product compared per kg or l is `qty x price per base unit` (milli-bani,
whatever size the purchase was); `buc` for a purchase counted in pieces is `qty x paidUnitBani`, the pack as that store
sells it (two `buc` of toilet paper are two packs, not two rolls). Any other combination has no estimate: the item keeps
its store and counts as `unestimated`.

**The plan** (`planList`): `items` are the items still to buy and then the checked ones, each part in list order;
`groups` is the same items under their store, stores by name (Romanian collation) and the group without a store last,
with a subtotal per group (checked items included: the number does not move while shopping) and `estimateBani`,
`unestimated`, `checked` for the whole list.

**Screens** (`src/features/lists`, Romanian, mobile first, `@/ui/controls` classes):

- `/liste`: create (then the new list opens), rename inline, archive and restore (archived lists sit in a collapsed
  section), delete after an inline question that names the number of items. What happened is said in a `role="status"`
  line, and focus goes to the "Liste active" heading when a card leaves its place.
- `/liste/:listId`: the add form (type to get catalog suggestions from `searchProducts`; Enter adds the text as typed
  unless it is exactly the name of a catalog product, so a typed "Lapte UHT" still gets its prices), the comparison
  settings in force with the period and the sale filter (the same two settings as the product screens, collapsed to one
  line), "Pe magazine" / "Listă simplă", and the items. A row is a checkbox with the name, the quantity, where it is
  cheapest (store, price per base unit with the shelf price of the pack, the day it was paid, a "reducere" mark, or "Doar
  la X"), why there is no store, and its estimate. "Editează" opens the editor in place: quantity, unit, note (and the
  name of a free-text item), "Mută mai sus" / "Mută mai jos" among the neighbours of the same store and checked state,
  "Șterge articolul". "Debifează tot" and "Șterge bifatele" (after a question) sit under the list.
- **Data**: `useLive.ts` is the product screens' hook (a Dexie `liveQuery` with an `async` querier, see §5c), copied
  because features may not import each other. The list follows its own edits, new receipts and the two settings.
- **Accessibility**: every field is a `<label for>`; buttons name their item (`Editează Lapte UHT`, `Șterge lista
  „Petrecere”`); the editor is a form named after the item; focus moves into the editor and the rename form, returns to
  the button that opened them on Escape or save, stays on the move button after a move (or goes to the other one at the
  end of the list), and goes to the add field after an item was removed; destructive questions put focus on "Anulează".
- **Product page**: `src/features/products/AddToList.tsx` offers "Adaugă pe listă": the lists in use (the newest is
  preselected) or a new one, then a link to the list.
- **Offline**: IndexedDB only; the two screen chunks are in the precache, and the list screen was checked in the built
  app with the network off.

**Tests.** `src/lists/*.test.ts` run against fake-indexeddb (CRUD, checking, ordering, tombstones) and on hand-made
observations (quotes, estimates, plan). `src/lists/testing.ts` saves the ground-truth METRO, Kaufland and Mega Image
receipts through `saveReceipt` and `tests/shopping-lists.test.ts` is the acceptance test: toilet paper is cheapest at
METRO (1,30 lei per roll, a sale price), wipes too (3,98 lei a pack), the chicken was only bought at Kaufland ("Doar la
Kaufland", 500 g = 12,49 lei), coffee and bread have no store, METRO leaves the list with the default 90-day window and
with sale prices excluded. The screens have jsdom tests like the product screens (§5c); the clock is the fixtures' 20.11.2026.

## 6. Build, PWA and CSP

- `vite.config.ts`: base `/pretometru/` (override with `BASE_PATH` if the repo is renamed). The `test` mode skips the
  PWA, CSP and Tailwind plugins.
- PWA (`vite-plugin-pwa`, `injectManifest`, `registerType: 'prompt'`): the service worker is `src/pwa/sw.ts` (its own
  `tsconfig.sw.json`, WebWorker lib). It precaches the app shell and every route chunk, caches the heavy engines on first
  use and answers the Web Share Target; `src/pwa/UpdatePrompt.tsx` asks before activating a new version so an update
  never interrupts data entry. How it works, the build guard and how it was verified: §14.
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
  synthetic/<id>/               hand-made edge cases (always labelled synthetic); receipt-level ones have no source
    case.json                   { description, origin: 'real' | 'synthetic', now, notes? }
    expected.json               ParsedReceipt ground truth (meta.engine 'fixture')
    source.pdf-text.json        ReceiptSource kind 'pdf-text': pdf.js items { str, x, y, w, h }, whitespace items included
    source.ocr-text.json        kind 'ocr-text': raw Tesseract output (text, lines with confidence + bbox)
    source.pasted-text.json     kind 'pasted-text': clean text, as iOS Live Text / Google Lens would give it
    expected.<kind>.json        optional: a different perfect answer for one source kind
```

| Export                          | Meaning                                                                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `fixtures`                      | every case, real first then synthetic, each `{ id, group, description, notes, now, expected, sources[] }`; `sources` is empty for receipt-level synthetic cases |
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
- **Raw OCR keeps its mistakes.** `source.ocr-text.json` is real Tesseract output (which run and which misreads:
  `case.json.notes`); `source.pasted-text.json` is the same sanitized text with every misread corrected from the printed
  receipt, as a Live Text / Lens copy would give it. `expected.json` is the truth: use it for the plan §10 accuracy
  metrics (total, % of lines, exact price). Misreads no arithmetic can repair (a `68L` in a name, a wrong second) make an
  exact match impossible, so a case may add `expected.ocr-text.json`: what a perfect parser extracts from that OCR text
  with arithmetic repairs only (`REPAIRED_DIGITS`, `SUM_MISMATCH`). `sourceOf(fx, 'ocr-text').expected` returns it.
- **Sanitized, not edited.** Personal rows of real receipts (loyalty card, card slip, buyer block, phone and bank lines)
  are masked in place: letters become `x`/`X`, digits `0`, so the document keeps its shape and a parser must skip
  those rows. Document numbers are fakes (`12345`, `1234567890123456`). Do not "repair" masked rows.
- Adding a case = adding a folder with `case.json`, `expected.json` and at least one `source.<kind>.json` (a synthetic
  receipt-level case may have none); the loader and `tests/fixtures.test.ts` pick it up. Contract changes update
  `docs/contracts.md`, the schemas and every affected `expected*.json` in one commit.

## 8. Commands

| Command                                            | What it does                                          |
| -------------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                                      | dev server, <http://localhost:5173/pretometru/>       |
| `npm run lint`                                     | ESLint (type-aware) + `prettier --check`              |
| `npm run format`                                   | Prettier write (Markdown and `public/` are ignored)   |
| `npm run typecheck`                                | `tsc -b` (app, node, service worker and e2e projects) |
| `npm test`                                         | Vitest, single run                                    |
| `npm run build` / `npm run preview`                | production build / serve it at <http://localhost:4173/pretometru/> |
| `npm run check:leaks`                              | leak scan of every tracked file (also the pre-commit hook and a CI step) |
| `npm run ocr:bench`                                | local OCR benchmark on the private originals (not part of `check` or CI, §11) |
| `npm run e2e`                                      | builds, then runs the Playwright specs of `e2e/` in a mobile Chromium against `dist/` (not part of `check` or CI, §14) |
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
| `pdfRows(source)`                       | `pdf-text` source -> `PdfRow[]` (`{ page, y, cells, text }`): items on one baseline form a row, cells are the text runs separated by gaps; spaces come from the geometry. Pure, for the PDF parsers (`@/parsers/pdf-rows`) |
| `lineKindOf`, `parseQuantity`, `toPurchasedAt`, `emptyReceipt` | shared helpers for parser authors: `deposit`/`bag`/`discount`/`product` by name and sign, `0,920` -> `0.92`, `07.11.26 18:31:47` -> `2026-11-07T18:31:47`, a receipt with nothing extracted (`@/parsers/line-kind`, `/text`, `/source`) |

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
- Tests: a golden test per `tests/fixtures/<store>/` (`expect(normalizeForGolden(parseReceipt(source, { now }))).toEqual(
  normalizeForGolden(expected))`) plus small synthetic cases next to the parser. `makeParsedReceipt()` and
  `makeParsedLine()` build valid receipts; `pdfFromText(lines)` / `pdfPagesFromText(pages)` build a `pdf-text` source
  from monospaced text art (runs separated by two or more spaces become items, the column gives `x`). All are in
  `@/parsers/testing` and test-only.

### OCR and pasted text (`lidl`, `mega-image`, `generic`; helpers in `src/parsers/plain-text`)

The three parsers read `ocr-text` and `pasted-text` sources alike (text copied with iOS Live Text or Google Lens is the
OCR text with fewer misreads) and answer an empty receipt for `pdf-text`. Layouts, detection and the repair rules are in
the per-store notes of [`contracts.md`](contracts.md). Detection is deliberately strict: Lidl counts only its own
`n,000 BUC x price` rows (a weighed `0,436 KG x 14,99` row is on many receipts), Mega Image needs its merchant line or at
least two products each followed by an EAN, and the generic fallback answers 0.05 for any text. Every parser ends with
`repairReceipt`.

| Module (`plain-text/`)         | Purpose                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `text-lines.ts`                | `textLines(source)`: one `TextLine` per printed row, with the no-break spaces, `×` and odd separators normalised; `confidence` (0..1) and `bbox` come from the OCR line, so every parsed line can carry its crop box (`unionBox`, `meanConfidence`) |
| `amounts.ts`, `quantity-line.ts`, `ean.ts` | `findAmounts` / `trailingAmount` (`6,54 B`, `1.234,56`, `-1,50`; OCR letters read for digits), `readQuantityLine` (`2,000 BUC x 4,05`, `0,436 KG x 14,99`), `parseEanLine` with the EAN check digit |
| `items.ts`, `rows.ts`          | `readItems` (product rows with the quantity above or inline and the EAN below); the strict totals block `readTotalRow`, `readSubtotalRow`, `readPaymentRow`, `readChangeRow`, `isTotalsRow`: a label has to stand alone before its amount, so a product called `Total 0% grasime` or `Card cadou` is a product |
| `dates.ts`, `vat-rate.ts`      | `findPurchasedAt` (`DATA:29/12/2026 ORA:17-12-30`, two-digit years), `readVatRate` (an illegal printed rate becomes the nearest legal one, the VAT amount and the class's usual rate break ties) |
| `receipt.ts`                   | `buildLine`, `sourceConfidence`, `withWarnings`                                                    |
| `repair.ts`                    | the digit repair: `repairReceipt(receipt)` (what the parsers call last), `repairDigits` (`valid`, `repaired`, `ambiguous` or `unrepairable`), `digitAlternatives`, `CONFUSABLE_DIGITS`, `MAX_CORRECTIONS` |

The repair reuses the checks of `validateReceipt` (`checkSumMismatch`, `checkLineArithmetic`, `checkVatTotals`) instead of
a second implementation of the arithmetic. Its tests include fast-check properties: a receipt that already validates is
returned as the same object; a single misread digit is restored exactly or left alone; whatever a repair returns passes
the checks, differs from the input in at most 3 numbers and only by confusable digits, and needs no further repair.
`plain-text/robustness.test.ts` feeds the three parsers arbitrary text: they never throw and always return a
schema-valid receipt.

### PDF text (`src/import/pdf`, import from `@/import/pdf`)

```ts
import { extractPdfText } from '@/import/pdf';

const source = await extractPdfText(await file.arrayBuffer()); // { kind: 'pdf-text', pages: [{ width, height, items }] }
```

The only importer of `pdfjs-dist`. It loads pdf.js with a dynamic `import()`, so Vite puts it in a chunk of its own
(about 440 KB, plus the 1.3 MB worker asset) that is fetched when the first PDF is read, never with the app shell. The
worker is `pdfjs-dist/build/pdf.worker.min.mjs?url`: a build asset on the app's own origin, which the CSP allows
(`worker-src 'self'`); nothing comes from a CDN. Items are `{ str, x: transform[4], y: transform[5], w: width, h: height }`
in pdf.js order, empty strings dropped and whitespace-only items kept (their gap is information), exactly the shape of
`tests/fixtures/**/source.pdf-text.json`. The call rejects for a file that is not a readable PDF (corrupt,
password-protected); a scanned PDF resolves with pages that have no items, so the caller can fall back to OCR. The
caller's buffer is copied first (pdf.js would take ownership of it). The worker is a `.mjs` asset: the service worker
caches it the first time it is requested, or when "Descarcă acum" in Settings fetches every engine (§14).

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
  (4x, reduced so the result stays under 12 megapixels: iOS Safari canvases stop at about 16.7, so a large photo is
  not upscaled at all), 1st-99th percentile contrast stretch, Otsu threshold. Photos above 16 megapixels are shrunk
  before their pixels are read. The result goes to Tesseract as a PNG written by `png.ts` (stored deflate blocks: no
  compressor, identical in every runtime). Every step is an option (`recognizeImage(image, { preprocessing: { scale: 3 } })`).
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
- **Offline**: `ocr/**` (about 16 MB) is not precached: the service worker stores each file the first time it is
  requested (cache-first by URL), or all of them from Settings; Tesseract.js's IndexedDB cache is off so the files are
  not stored twice (§14). Offline OCR was checked in headless Chrome with the network off.
- Tests are Node-only: pure preprocessing/PNG/row merging, the worker host with a fake factory, and a real Vite build of
  `ocrAssetsPlugin` (`config/ocr-assets.test.ts`). The browser parts (canvas decode, crop) are covered by a manual check.
- **Benchmark** (`npm run ocr:bench`, `scripts/ocr-bench.ts`; not part of `check` or CI): for each real fixture that has
  `<fixture id>.jpg` or `.jpeg` in `~/.pretometru-private/samples/` (override: `--samples <dir>` or
  `PRETOMETRU_SAMPLES`), it runs the same preprocessing and Tesseract.js engine as `recognizeImage` (under Node, with
  the `ron`/`eng` data from `node_modules`) and the real parsers, and compares the receipt with the fixture's
  `expected.json` (`scripts/ocr-bench-metrics.ts`, unit-tested). It prints **metrics only**, never a line of the
  receipt: the parser that was picked, the OCR confidence, whether the total is right, whether Σ lines = total
  (`ok`, `MISMATCH`, or `NO TOTAL`), the share of lines found, of exact line totals and of exact quantities, the
  number of *silent* errors (a wrong price that no warning flags: the sum checks out and the line carries no
  warning), the time and the warning codes. Options: `--channel`, `--scale`, `--threshold`, `--no-stretch`, `--psm`,
  `--only`; `--sweep` tries every channel x scale of a small grid, one row each, to retune the defaults when samples
  are added. EXIF rotation is not applied (the originals must be upright). Result with the defaults on the two real
  samples: total, sum, lines, prices and quantities all exact (Lidl without its date row, flagged `MISSING_DATE`; Mega
  Image with one `REPAIRED_DIGITS`).
- **One pass is sensitive to the scale.** On the same photo, a small change of the upscale can flip a misread: 3x
  reads the Lidl date row and loses the Mega Image total, 4x does the reverse, 2x misreads prices on both. So the
  defaults are a compromise, and the cheap fix is on the caller's side: when `parseReceipt` still reports
  `SUM_MISMATCH`, `MISSING_TOTAL`, `MISSING_DATE` or `LINE_ARITHMETIC` on an `ocr-text` receipt, run `recognizeImage`
  again with `{ preprocessing: { scale: 3 } }` and keep the receipt with fewer warnings (the OCR module cannot do it
  itself: it knows nothing of the parsers). The import orchestrator (§12) does not retry yet.

## 12. Import and review (`src/import`, `src/features/add-receipt`, `src/features/receipts`)

`src/import` (import from `@/import`) is React-free: it turns a picked file or pasted text into a **draft receipt** in
the database and owns everything the review screen computes. The two features are thin screens over it.

```ts
import { getImportServices, importToDraft } from '@/import';

const { saved } = await importToDraft(getImportServices(), { kind: 'file', file }, { signal, onProgress });
// saved.receipt.id is a `draft` receipt: navigate to `/bonuri/${id}` to review it
```

### Services and ports

`ImportServices = { getDb, parser, engines, catalog, now, newId }`. The sibling modules are consumed through the small
ports of `src/import/ports.ts` (`ParserPort`, `EnginePort`, `CatalogPort`; same signatures as the agreed interfaces).
`src/import/engines.ts` is the **composition root**: `@/parsers`, `@/catalog` and, loaded on first use, `./pdf` (pdf.js)
and `@/ocr` (Tesseract.js). Screens call `getImportServices()`; tests replace parts with `setImportServices({...})` and
undo it with `resetImportServices()`. A new engine (the optional Gemini one) is a change in `engines.ts` only.

### Import (`importReceipt`, `importToDraft`)

| Step | What happens |
| --- | --- |
| detect | the file signature decides (PDF header within 1 KB, JPEG/PNG/GIF/BMP/WebP/HEIC), then the declared type and the extension; text files and pasted text need no engine |
| extract | `extractPdfText(ArrayBuffer)` / `recognizeImage(file, { signal, onProgress })` / `{ kind: 'pasted-text', text }`; no text at all is `NO_TEXT` |
| parse | `parseReceipt(source, { now: services.now() })`; no line recognised is `NOTHING_RECOGNIZED` |
| check | SHA-256 of the input (WebCrypto) and `findDuplicateReceipts` (same file, or same store + day + total) add a Romanian `DUPLICATE` warning |
| save (`importToDraft`) | find-or-create the store (chain + branch), `saveReceipt` as `draft`; `importReceipt` alone persists nothing |

Progress is reported per phase (`reading`, `extracting` with an OCR fraction, `parsing`, `checking`, `saving`); aborting the
signal between steps (and inside OCR) rejects with `ImportError('CANCELLED')`. Failures are `ImportError`s whose `code`
(`UNSUPPORTED_FORMAT`, `EMPTY_INPUT`, `FILE_TOO_LARGE`, `NO_TEXT`, `NOTHING_RECOGNIZED`, `ENGINE_UNAVAILABLE`,
`EXTRACTION_FAILED`, `SAVE_FAILED`, `CANCELLED`) the screen turns into Romanian text. Limits: 40 MB per file, 200,000
characters of pasted text.

**Originals are never persisted or synced** (the contracts have no place for them). The picked image stays in memory in a
**review session** (`getReviewSession(receiptId)`, the five most recent receipts) for the line crops, together with what
`Line` cannot hold: the printed VAT totals and per line `bbox`, `confidence`, `raw`, `unitPriceBani`, `vatClass`. A page
reload drops the session: the review keeps working without crops, and import warnings that need those details stay on
screen until the user edits or verifies the line they point at. `receipts.source.rawText` holds only the PII-free `raw`
text of the parsed lines (never the document's text).

### Save path (`saveDraft`, `confirmDraft`, `loadDraft`, `discardReceipt`)

`ReceiptDraft` is the typed working shape (store as a spec, `DraftLine`s with ids, `source`, `extraction`). Saving maps
it to `saveReceipt`: `ParsedLine` -> `LineInput` (`qtyUnit` -> `unit`, `discountBani` defaults to 0, the pack -> `packQty`,
`packUnit`, `unitsPerPack`; only persisted fields are written, non-product lines never keep a product), `source.kind`
`pdf` | `image` | `text` | `manual` from the engine, `extraction` from `meta`, and the warnings standing at that moment.
The unit prices are derived by the storage layer, never here. `confirmDraft` saves as `confirmed` and then calls
`rememberMappings(db, chain, choices)` for the mapped product lines, with the line's effective pack (the catalog only
returns `mapping.pack` when the printed name has none, so `mapping.pack ?? line.pack` and `line.pack ?? mapping.pack`
agree); a failing catalog does not undo the confirmation (`ConfirmResult.mappingError`). The store is reused while its
chain and branch are unchanged; changing the chain in the review finds or creates the store of the new chain.

### Review working copy

`ReceiptForm` keeps every number as the text the user typed (`12,` never fights the input; invalid text is reported, never
replaced). `readForm(form)` returns the typed `ReceiptDraft` plus per-field errors (lines with an invalid field are left
out, so it is only safe to persist when `hasErrors` is false). `analyze(draft, ctx)` re-runs `validateReceipt` after
every edit, adds `DUPLICATE` (async `findDuplicates`) and `UNKNOWN_CHAIN`, keeps the import warnings that cannot be
recomputed (`REPAIRED_DIGITS`, `LOW_CONFIDENCE`, and `LINE_ARITHMETIC` once the printed unit price is gone) and returns the
live sum against the printed total. `FUTURE_DATE`, `DUPLICATE` and `SUM_MISMATCH` must be accepted before a receipt is
confirmed; an acceptance is a token of what was accepted (the date, the difference, the duplicate ids), so editing it
away makes the question come back. `confirmBlockers` lists what stops a confirmation (a date, a total above 0, a line, a
valid value in every field, the acceptances); a draft can be saved with anything but invalid values.
`reviewReducer` is the pure state machine behind the screen (edits, verified lines, acceptances, `saved`).

### Screens

| Route | Screen |
| --- | --- |
| `adauga` | files (several at once, read one after the other), camera (`capture="environment"`), pasted text, a link to manual entry; progress with cancel, Romanian errors per file; one file opens its review, several are listed |
| `bonuri` | newest first (purchase date, else creation), store, date, total, draft/confirmed; filters by state, store and month |
| `bonuri/:receiptId` | review/edit: store/chain override, date, document, totals; live Σ lines against the total; warnings panel; per line name, quantity, unit, total, discount, kind, EAN, pack, derived price, crop, product and category (`searchProducts`, `createProduct`, the catalog's suggestions); save draft / confirm / delete |
| `bonuri/nou` | a receipt typed in by hand; nothing is stored until the first save, then it moves to its own route |

Route modules export `Component` and, in a separate file, a `loader` (`receiptsLoader.ts`, `reviewLoader.ts`); the
loader reads the database and the screen never touches it directly. Leaving the review with unsaved edits asks first
(`useBlocker` and `beforeunload`).

Accessibility conventions (a Playwright suite will target these): every field is a `<label for>` whose text is the
visible label plus a screen-reader suffix for lines (`Total linie (lei), linia 9`); buttons carry the line in their name
(`Șterge linia 3`, `Alege produsul, linia 3`); dialogs are `role="dialog"` with focus moved in, Tab kept inside, Escape
to close and focus returned to the opener; a refused confirmation moves focus to the first blocker and lists all of them
in a `role="alert"` region; the warnings panel is the `region` named "Avertismente". Money is formatted with the `@/domain`
helpers, typed as `12,50` and normalised when the field loses focus.

Tests: `src/import/testing.ts` has fakes for the ports (`fakeEngines`, `fakeParser` backed by the real validation,
`fakeCatalog`, `testServices`); `src/features/receipts/testing.tsx` renders the whole app router over an in-memory
database with a fixture's ground truth as the parser's answer. The flows drive import, review, an edited price and the
confirmation for the Kaufland, METRO, Lidl and Mega Image fixtures.

## 13. GitHub sync (`src/sync`, `src/features/sync`)

The data is backed up in, and shared between devices through, a **private GitHub repository of the user's own**
(`pretometru-data`, plan §2) that the app reads and writes straight from the browser with a fine-grained token limited
to that repository (Contents: Read and write). Every sync is **one atomic commit** made with the Git Data API, so the
Git history is the backup. `src/sync` is React-free; `src/features/sync` is a card of the Settings screen. Setting up
the repository and the token is explained in the README and by the screen itself.

```ts
import { runSync, verifyConnection, saveConnection } from '@/sync';

const check = await verifyConnection({ token, repo: 'pretometru-data' }, getSyncServices()); // nothing is saved yet
await saveConnection(db, { owner: check.owner, repo: check.repo, token }, getSyncServices());
const result = await runSync(); // { firstSync, pulled, pushed, commit, head, attempts, skipped, at }
```

| Module (`src/sync/`)  | What it holds                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `github.ts`           | the REST client over `fetch`: `createGitHubClient({ token, fetch })` -> `getUser()`, `repo(owner, name)` with `get`, `getBranchHead`, `getCommit`, `getTree`, `getBlob`, `createBlob`, `createTree`, `createCommit`, `updateBranch`, `createFile`; `parseRepoRef`, `tokenKind` |
| `layout.ts`, `records.ts` | the layout of the repository (below): month buckets, `planShards`, `serializeShard`/`parseShard`, the manifest; `SyncRecord` and `overlay` (last write wins) |
| `remote.ts`, `engine.ts` | reading the repository (`readRemote`, `downloadChanged`), and `syncNow({ db, repo, ... })`: pull -> merge -> push in one commit |
| `verify.ts`           | `verifyConnection`: token, repository, private, may write, what it holds (used by the onboarding)       |
| `connection.ts`, `vault.ts` | the connection and the token in `syncState`, with the optional passphrase (PBKDF2 + AES-GCM); `lockToken`/`unlockToken` |
| `status.ts`, `runtime.ts`, `run.ts`, `services.ts` | the last result, `loadSyncView`, the in-memory "running" state, `runSync` (one at a time), the injectable services (`getSyncServices`, `setSyncServices({ fetch, getDb, now, ... })`) |
| `auto.ts`             | automatic sync (below), started by `src/main.tsx` after the first render                                  |
| `errors.ts`           | `SyncError` with a `code` (`SYNC_ERROR_CODES`); the screen turns codes into Romanian text                |
| `testing.ts`          | **test-only**: `MockGitHub` (an in-memory api.github.com), `makeWorld`, `makeDevice`, `seedSample`, `at(iso)` |

### Layout of the data repository

```
README.md                           written once, only to give an empty repository its first commit
data/pretometru.json                { "format": "pretometru-data", "formatVersion": 1 }
data/settings.json                  the portable settings (never a token or a key)
data/<table>/<YYYY-MM>.json         stores, receipts, lines, products, aliases, categories, lists, listItems
data/<table>/<YYYY-MM>.<X>.json     the same month split in parts, only for a month above 1,000,000 characters
data/categories/seed.json           the built-in categories (their ids decode to time 0)
```

A shard is `{ "records": [ ... ] }` with **one record per line, sorted by id**, tombstones included; its records are
exactly the backup's records (`docs/contracts.md`). The file of a record follows from its **id alone**: a ULID starts
with its creation time, so the month is fixed for the record's whole life and an edit changes one line of one small
file. Months keep files small, and a month that outgrows 1,000,000 characters is split by the first random character of
the ids (at most 32 parts, each far below the API's 100 MB blob limit). The layout is a pure function of the record
set (`planShards`): two devices that agree on the records agree on every byte, so identical data never makes a diff.
Everything outside `data/` and every file under `data/` that is not one of ours is left untouched.
`SYNC_FORMAT_VERSION` is bumped when a change cannot be read by an older app, which then refuses to sync instead of
dropping what it does not understand (`REMOTE_NEWER`).

### The sync algorithm (`syncNow`, one round)

1. `GET /repos/{o}/{r}`: **refuse unless `private` is true** (and the repository is not archived); the default branch is
   the branch that is synced. This happens on every sync, before anything else, so a repository made public later is
   refused too.
2. No commit yet (the Git Data API answers 409 on an empty repository): create `README.md` through the Contents API.
3. Read the head commit, its tree (recursive; a truncated listing is `REMOTE_TOO_LARGE`) and the manifest.
4. Export this device's records (`exportBackup`), plan their files and compute their **Git blob ids** (SHA-1 of
   `blob <size>\0<content>`); download only the repository's files whose id differs (four at a time). Every record is
   validated with the zod schemas: **one unreadable file or record stops the sync with nothing changed** (`REMOTE_INVALID`).
5. **Merge**: `importBackup(db, downloaded, { mode: 'merge' })`: last write wins per record on `updatedAt` (a newer
   tombstone deletes, a later edit beats an earlier deletion), in one transaction, **reconciling the lines of every
   receipt it touched** (`reconcileReceiptLines`, §5) and re-creating missing seed categories. Sync does not re-implement
   the merge; the storage layer is the only code that writes remote records into the database.
6. **Compose** what the repository should hold: every record of both sides, the newer copy of each; on a tie the
   repository's copy stays, which is what stops two devices overwriting each other forever. Records are never removed
   from the repository (a deletion is a tombstone); a file that is no longer part of the plan (a record that sat in the
   wrong file, a month that was split) is deleted in the same commit.
7. Nothing to change (`changed`, `stale` and the manifest all empty): done, **no commit**. Otherwise create the blobs
   (three at a time), a tree on top of the head's tree, a commit with the head as its parent, and update the branch
   **without force**.
8. A rejected ref update (422 "not a fast forward", or 409: another device pushed meanwhile) starts the round again from
   the new head, up to 4 rounds with a short pause; then `CONFLICT`. Repeating a round is safe because the merge is
   idempotent and everything pulled is already in the local database.

Consequences worth knowing: the first sync of an empty repository is a push (`firstSync: true`), against a repository
with data it is a merge; a failure after step 5 (rate limit, offline) keeps what was pulled and the next sync finishes
the push; syncing twice in a row makes no second commit. The commit message is Romanian, for the user who reads the
history on GitHub: `Sincronizare Pretometru (dispozitiv 7K3F9Q): 12 înregistrări`. Tombstones stay in the repository
forever (`purgeTombstones` is never called by sync). Last write wins compares **device clocks** (`updatedAt`), so a
device with a badly wrong clock can win or lose when it should not; a tie on the same millisecond keeps the
repository's copy.

### Token, safety and what is sent

- The token lives only in `syncState` (key `sync.token`; `sync.connection` and `sync.status` hold the repository, the
  device id and the last result), a table that is never exported, synced or part of a backup. With a passphrase it is
  stored as `AES-256-GCM` under a `PBKDF2-SHA256` key (600,000 rounds, random salt and IV); the decrypted token only
  exists in memory (`lockToken` is what an app restart does), and a protected token has to be unlocked once per start.
  Disconnecting deletes the rows (a tombstone with `value: null`, so no copy stays on disk).
- The only host is `api.github.com` (the CSP allows exactly it). Requests carry only `Authorization`, `Accept` and
  `Content-Type`: the headers the plan's CORS check covered.
  Requests use `cache: 'no-store'`: GitHub lets browsers cache GETs for a minute, and a sync must never act on a stale ref.
  The in-memory GitHub of the tests records any other header, or another host, as a violation that fails the test.
- A repository name is validated (`isValidRepoRef`) before it is put into an address, object ids must be 40 hex digits,
  and no error or message ever contains the token.
- A setting stays non-portable unless it is meant to sync (`SETTING_DEFINITIONS`); the repository's `settings.json` is
  filtered the same way on the way in, so a planted key is ignored.
- Write permission is proven without touching the history: an unreferenced blob is created (or, in an empty repository,
  the README commit is the proof).

### Errors

`SyncError.code`; the screen shows Romanian text (`src/features/sync/messages.ts`) and the status keeps the last code.
`isBlockingCode` marks what retrying cannot fix (`BAD_TOKEN`, `NO_ACCESS`, `NO_PERMISSION`, `REPO_NOT_PRIVATE`,
`REPO_ARCHIVED`, `BRANCH_PROTECTED`, `EMPTY_REPOSITORY`, `INVALID_REPO`, `REMOTE_INVALID`, `REMOTE_NEWER`,
`REMOTE_TOO_LARGE`, `NOT_CONFIGURED`). The others are `OFFLINE`, `NETWORK`, `RATE_LIMITED` (with `retryAt`, from
`Retry-After` or `X-RateLimit-Reset`), `SERVER`, `CONFLICT`, `STORAGE`, `CANCELLED`, `TOKEN_LOCKED`, `BAD_PASSPHRASE`,
`CRYPTO_UNAVAILABLE` and `UNEXPECTED`. A missing connection or a locked token is not a failed attempt and is not recorded.

### Automatic sync (`src/sync/auto.ts`)

Worth having because the sync is also the backup (plan risk 3) and because syncing by hand on every device is what
people forget. It is deliberately small: `startAutoSync()` (called from `src/main.tsx` after the first render, loaded
lazily) attempts a sync **3 s after the app starts, when the user comes back to the app** (if the last attempt is older
than 5 minutes), **when the device is back online** and **30 s after the last change of the local data** (a live query
on the newest `updatedAt`; a burst of edits is sent once, and nothing is sent when nothing is newer than the last
sync). It runs only when sync is set up with automatic sync on, the device is online and the token is usable, never
closer than 10 s after the previous attempt, and never in a retry loop: after an error that retrying cannot fix it stops
until a manual sync succeeds (the screen says so), after a rate limit it waits for the time GitHub gave. Automatic and
manual runs share `runSync`, which runs one sync at a time and lets a second caller join it.

### The Settings section (`src/features/sync`)

`feature.ts` has no route; it contributes the card "Sincronizare GitHub" (`order: 500`). Unconnected: the instructions
(a private `pretometru-data` with a README, a fine-grained token on that repository only with Contents: Read and
write), the token and repository fields, an optional passphrase, "Verifică conexiunea" (a checklist: token, repository,
private, may read and write, contents), what the first sync will do (upload an empty repository, **merge** one that has
data), a warning for a classic token, and the button that saves and runs the first sync. Connected: the repository, the
last successful sync with its counts, what waits to be sent, "Sincronizează acum" (disabled while running or locked),
the automatic-sync switch, the passphrase prompt of a locked token, "Schimbă tokenul" and a confirmed "Deconectează".
Every failure has its own Romanian message (bad token, no access, repository not private, rate limit with the time to
retry, offline, a branch that keeps moving, ...). The section reads its state with a Dexie live query and the running
state from `src/sync/runtime.ts`, so it follows a sync that automatic sync started.

### Tests

Everything runs against `MockGitHub` (`src/sync/testing.ts`): users, tokens with `write`/`read`/`metadata` access,
repositories (private or public, archived, with or without a first commit), the Git Data API with real Git object ids,
fast-forward checks, and switches to break things on purpose (`setOffline`, `failNext(match, reply)`, `before(match,
action)` to let another device push between two requests of a sync, `limitTrees`). `makeDevice` is a database of its own
that syncs as a user; `seedSample` fills one. The suites cover the first push, pull and merge, last write wins, ties,
tombstones, line reconciliation of a receipt re-saved on two devices, a rejected ref update followed by a retry (and
giving up), the private-only rule, token and permission errors, rate limits, offline, unreadable or newer repository
data, files that are not ours, re-sharding, the token never reaching a backup or the repository, and the whole
onboarding through the Settings screen. A repository on the real GitHub was **not** available to the authors: the
README lists what to check by hand. The Settings tests need the global IndexedDB (`import 'fake-indexeddb/auto'`, for
Dexie's live queries) and call `resetRunSync()` between tests so that a hung sync cannot block the next one.

Assumptions about GitHub that only a real token can confirm: an empty repository answers 409 to Git Data calls and
accepts a Contents `PUT` as its first commit; blob content comes back as base64 with line breaks; the CORS policy of
`api.github.com` exposes `Retry-After` and `X-RateLimit-Reset` (otherwise `retryAt` falls back to one minute) and allows
`GET`, `POST`, `PATCH` and `PUT` with the three headers above.

## 14. Offline, persistence and sharing (`src/pwa`, `src/features/offline`, `e2e/`)

After the first load the whole app works offline: the shell, every route chunk and the data (IndexedDB) need no network.
The two heavy engines (the pdf.js worker and OCR) are the one exception, by design: they are stored the first time they are
used, or all at once from Settings. Everything below was checked on the production build in headless Chrome with the
network off (`npm run e2e`, see the end of this section).

### The service worker (`src/pwa/sw.ts`)

`vite-plugin-pwa` in `injectManifest` mode builds `sw.ts` on its own (Vite, `tsconfig.sw.json` with the WebWorker lib; the
app's DOM project excludes it) and injects the manifest of **every file of the build** (`globPatterns: ['**/*']`). The worker
splits it with `splitManifest` and the rules of `src/pwa/offline-rules.ts`:

| Part | What the worker does |
| --- | --- |
| shell: everything that matches no engine rule | Workbox precache at install; a `NavigationRoute` answers every navigation with `index.html` (hash router); `cleanupOutdatedCaches` |
| engines: `ENGINE_RULES` = `.mjs` (the pdf.js worker) and `ocr/**` (Tesseract.js worker, WASM cores, language data) | `engine-cache.ts`: cache-first by URL, fetched with `cache: 'reload'`, kept in **one cache per engine**, named `pretometru-engine-<id>-<fingerprint of its files and revisions>`; never part of the install step |
| `POST <base>share-target` | `share-target.ts`, see "Web Share Target" |
| messages | `SKIP_WAITING` (the update prompt); `pretometru/engines-status` and `pretometru/engines-prepare` (Settings, `sw-client.ts`) |
| `activate` | `clientsClaim()`, deletes the engine caches of versions the manifest no longer lists, drops share batches older than a day |

- **Versioned engine caches.** The OCR files have stable names (`ocr/worker.min.js`), so the cache name carries a fingerprint
  of the files' URLs and revisions: an app update that leaves an engine alone keeps its 16 MB (checked in e2e), an engine
  that changed starts a new cache and the old one is deleted on activate. A file that matches a rule but is not in the
  manifest is stored on first use all the same.
- **The update behaviour is unchanged** (`registerType: 'prompt'`): nothing skips the waiting phase but `SKIP_WAITING`.
  `clientsClaim()` only matters for a first-time visitor, whose own tab would otherwise stay uncontrolled (and the engines
  it uses in that first session unstored) until a reload; an update never reaches a tab before the user accepts it.
- **An explicit "prepare offline import" is worth it, and small.** Settings, "Offline și stocare", shows for each engine
  whether it is stored and downloads the rest with progress (about 18 MB). All three WASM cores are fetched, not only the one
  this browser picked, so a browser update that enables another SIMD level cannot break offline OCR. The download runs in the
  worker (`event.waitUntil`), keeps what it already has when it fails and resumes where it stopped. When an import fails
  while the browser is offline, the add-receipt screen says that the engine is not on the device yet and points at that
  card, instead of "try a clearer photo".

### The build guard (`config/offline-guard.ts`)

It runs on the final Workbox manifest (`manifestTransforms`), so `npm run build` fails, and says what to change, when
(1) a precached file is over 1 MiB (an engine moved to a folder no rule knows, pdf.js changed its worker's extension, a new
WASM file), (2) the precache outgrows 4 MiB, or (3) a file of the build output is missing from the manifest (too big for
Workbox, or an extension the glob misses). It also records each engine file's size for Settings and warns about a rule that
matches nothing. `src/pwa/offline-rules.test.ts` checks the URLs the OCR runtime requests (`ocrAssetUrls`,
`src/ocr/assets.ts`) against the rules; `config/pwa-build.test.ts` builds the real config and checks the result (every file
listed once and never with two revisions, the shell within budget, the engines apart with their sizes, `SKIP_WAITING`, the
`share_target`). **A new engine**: add a rule to `ENGINE_RULES`, nothing else. The CSP is untouched.

### Web Share Target

The manifest declares `share_target` (POST, `multipart/form-data`, field `files`, `application/pdf` and `image/*`, action
`<base>share-target`). On Android Chrome, with the app installed, it appears in the share sheet for PDFs and images; the
browser POSTs the files, the worker answers without a server: it keeps them in the `pretometru-share-v1` cache and redirects
(303) to `#/adauga?shared=<id>`. The add-receipt screen (`useSharedFiles`) reads the batch once (also under StrictMode),
starts the import as if the files had been picked, discards the batch and removes the parameter; if the batch is gone it
says so. Whatever goes wrong in the worker, the user lands on the add-receipt screen.

**Android only.** iOS Safari and Firefox ignore `share_target`; there, and on desktop, the file picker, the camera input and
pasted text are the import paths, and nothing breaks. Not verified: the real Android share sheet (headless Chrome cannot show
one). The e2e specs check that Chrome reports no manifest errors and submit the same multipart POST from a page; the handler
is unit-tested.

### Persistent storage

`persistence.ts`: `navigator.storage.persist()` is requested **once**, after the first confirmed receipt
(`persistence-watcher.ts`, a Dexie `liveQuery` on confirmed receipts, mounted by `main.tsx` through `PersistenceWatcher`). The
watcher loads three seconds after the first screen, and not at all once the browser has been asked, so the entry chunk stays
free of Dexie. The ask is remembered in `localStorage` (`pretometru.storage-persist`: device-local, never exported or synced).
The Settings card shows the state (active, inactive, unavailable), the space used, whether the app is installed and a
**manual retry**, and points at the GitHub sync as the copy outside the browser (there is no export-to-file screen yet).
Chrome decides by its own heuristics (an installed app is granted) and Firefox asks the user, so a refusal is normal and is
never repeated on its own.

### Camera capture

The add-receipt screen already had it: `<input type="file" accept="image/*" capture="environment">`, labelled "Fotografiază
bonul" (the rear camera on a phone, the file picker elsewhere). Checked in the built app; unchanged.

### Browser checks (`e2e/`, `npm run e2e`)

`playwright.config.ts` runs the specs in a mobile Chromium (Pixel 7 profile) against `dist/`, served by
`e2e/support/pages-server.ts`: like GitHub Pages (files below the base only, no `index.html` fallback, no POST) but
`no-store`, because with a fresh copy in the HTTP cache an offline check would pass even if the worker had not stored a file
(a lazy chunk deleted from the precache is detected). Install the browser once with `npx playwright install chromium`, or set
`E2E_CHANNEL=chrome` to use the installed Google Chrome (both pass). Not part of `npm run check` or CI; it is the base for the
QA phase. Inputs are made on the fly from the fixtures (`e2e/support/samples.ts`: a text PDF with the Kaufland items, a canvas
photo of the Lidl text; `seed.ts`: price history written into IndexedDB), so nothing binary is committed.

| Spec | Proves |
| --- | --- |
| `offline.spec.ts` | the install stores the shell and not the engines; every navigation route, a receipt, a product with its chart and an unknown route render offline with IndexedDB data and no failed request or script error; a returning visit opens offline; the camera input |
| `engines.spec.ts` | a PDF and a photo (OCR, then the Lidl parser) import offline after the first use of each engine, and after "Descarcă acum" with no earlier use; without either, the error names the cause |
| `share-target.spec.ts` | the manifest has no Chrome errors; a share POST imports (also offline); several files are listed; an empty or expired share leaves the screen usable |
| `update.spec.ts` | an update installs in the background, the page and a reload stay on the old version until "Actualizează", the engine caches survive, the new version works offline |
| `persistence.spec.ts` | state and retry in Settings; the ask happens once after the first confirmed receipt and later visits do not even load the watcher |

### Limits

Checked once on the deployed site (headless Chrome, GitHub Pages): the worker installs and controls the page, the manifest
has no errors, the pdf.js worker is served as `text/javascript`, and a PDF imports offline after its first use with every
main route rendering. Not verifiable here: the Android share sheet, an installed PWA on iOS (Safari's storage rules) and
Chrome's real answer to `persist()` for an installed app.

The share-target action answers any POST below the scope, as the manifest requires, so a page on another site can submit a
form to it and leave drafts in the add-receipt screen (nothing is confirmed, synced or sent anywhere; a share can be at most
ten files of any size, which the importer then refuses above 40 MB). If that ever matters, show the shared files and wait for
a tap instead of starting the import (`useSharedFiles` in `src/pwa`). An update that changes an engine leaves the new engine
unstored until it is next used online or fetched from Settings: the old caches are deleted when the new worker activates.
