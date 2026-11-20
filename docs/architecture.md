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
| Logic      | `catalog`, `analytics`, `import`, `lists`, `sync`, `admin`, `ai`, `ocr` | domain, parsers, storage, each other (no cycles) | features, app, ui (keep them React-free)        |
| UI         | `src/features/<name>`       | everything above, `src/app`, `src/ui`   | **another feature's folder**                     |
| Shell      | `src/app`                   | `src/ui`; discovers features by glob    | importing features directly                      |

- `src/domain` and `src/parsers` are **pure**: no DOM, IndexedDB, network or clock (inject `now`). They run under
  Node/Vitest. ESLint enforces the import and global-variable bans (`eslint.config.js`).
- `src/catalog`, `src/analytics`, `src/import`, `src/lists`, `src/sync`, `src/admin` and `src/ai` are React-free: ESLint
  rejects `react`, `react-router` and imports of `@/features`, `@/app`, `@/ui` or `@/pwa` there (they may use `@/storage`).
  `src/admin` and `src/features/backup` additionally may not use `fetch`, `XMLHttpRequest`, `WebSocket` or
  `EventSource`: backup, categories and stores never touch the network.
- The network has two doors, both opt-in and both listed in the CSP: `src/sync` talks to `api.github.com` and `src/ai` (when
  the user switched it on, §16) to `generativelanguage.googleapis.com`. Nothing else may call either host.
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
| `src/analytics/`             | price observations, unit price, cheapest store, trends (§5b); spending by month, category and store, price increases, recent receipts (§5e) | `price-analytics`; spending: `insights-dashboard` |
| `src/lists/`                 | shopping lists: list and item storage, cheapest place per item, grouping by store (§5d) | `shopping-lists`                      |
| `src/sync/`                  | GitHub sync: private data repo, one atomic commit per sync, last-write-wins + tombstones (§13) | `sync-github`                         |
| `src/admin/`                 | backup export/import (file, preview, merge or replace), category and store management (§15) | `backup-categories-stores`            |
| `src/ai/`                    | optional Gemini reading of a photo: REST client, answer validation, image preparation, key and settings; off by default and loaded lazily (§16) | `ai-gemini-optional`                  |
| `src/pwa/`                   | the service worker (`sw.ts`: shell precache, engine cache, Web Share Target), the update prompt, persistent storage, the page's side of the worker (§14) | `pwa-offline-share` (scaffold: `scaffold-pwa`) |
| `src/features/home`, `stats` | Acasă (spending this month and per category, last receipts, price increases) and Statistici (by month, category and store over a period, price increases in detail), §5e | `insights-dashboard` |
| `src/features/add-receipt`, `receipts` | add receipt (files, camera, pasted text, manual), receipt list, review (`bonuri/:receiptId`, §12) | `import-review-ui`                    |
| `src/features/products`      | products by category, product page (§5c)                             | `catalog-matching`, `price-analytics` |
| `src/features/lists`         | shopping lists: overview and list screens (§5d); "Adaugă pe listă" lives on the product page (`src/features/products/AddToList.tsx`) | `shopping-lists`                      |
| `src/features/sync`          | Settings section: GitHub onboarding, token, "Sincronizează acum", status (§13) | `sync-github`                         |
| `src/features/offline`       | Settings section "Offline și stocare": offline readiness, "Descarcă acum" for the engines, persistent storage (no routes, §14) | `pwa-offline-share`                   |
| `src/features/ai`            | Settings section "Gemini (opțional)": key, enable switch, connection test (no routes, §16); the "Citește cu AI" action lives in the review (`src/features/receipts/review/AiReading.tsx`) | `ai-gemini-optional`                  |
| `src/features/backup`, `categories`, `stores` | Settings sections "Copie de siguranță", "Categorii" and "Magazine"; the routes `/setari/categorii` and `/setari/magazine` (§15) | `backup-categories-stores`            |
| `src/features/settings`      | settings shell; sections are contributed by other features           | shell: `scaffold-pwa`; sections: their feature owners |
| `src/app/`                   | app shell: router, layout, navigation, feature registry              | `scaffold-pwa` (shared)               |
| `src/ui/`                    | shared presentational components, icons, and what the data screens share: the live-query hooks (`live.ts`), `Loading`/`Failure` (`states.tsx`), `ConfirmPanel`, `plural` (§15); `insights/`: the formatting, bars, price-increase list and day hook of the Home and Statistics screens (§5e) | shared (additive edits)               |
| `config/`                    | build-time helpers (CSP plugin, OCR asset copy, the offline guard, §14); Node only, never bundled | `scaffold-pwa`; `ocr-assets*`: `ocr-pipeline`; `offline-guard*`: `pwa-offline-share` |
| `e2e/`                       | Playwright browser checks of the production build (`npm run e2e`, §14); required in CI before Pages upload | `pwa-offline-share`, `qa-hardening` |
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
  `SettingsScreen`. Use `order` < 1000 to appear before "Despre aplicație". A card that is too small for its job links
  to a route of its own feature (`setari/categorii`, `setari/magazine`, §15), which leads back with "← Setări".
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
with sale prices excluded. The screens have jsdom tests like the product screens (§5c); the clock is the fixtures' 20.11.2026. Focus assertions
wait for the effect that moves focus (`expectFocus` in `src/features/lists/testing.ts`, §7), and the effects that move
focus after an async step (the lists arriving, a live query re-render, a save) are layout effects, so they run in the
commit that shows the result and cannot fire after the user has already moved on.

## 5e. Spending, Home and Statistics (`src/analytics`, `src/features/home`, `src/features/stats`)

`src/analytics` (import from `@/analytics`, still React-free) also answers "how much did I spend", by month, category
and store, from the confirmed receipts. Acasă (`/`) and Statistici (`/statistici`) are thin screens over it, built from
the shared pieces of `src/ui/insights`.

### What counts as spending

- **Which receipts**: live, `confirmed` and with a valid `purchasedAt`. A draft, a deleted receipt and a deleted line
  never count.
- **How much a receipt costs**: what was **paid**, `paidBani`, else the printed `totalBani`. A payment-side voucher
  (Kaufland's "Tichet de ambalaje", `totalBani - paidBani`) is cash that did not leave the wallet, and the deposit it
  refunds was counted on the receipt that charged it, so the totals of the months add up to the money spent. Home's
  last-receipts card shows the printed total with "plătit" next to it when a voucher was used; the Bonuri list shows the
  printed total only.
- **Categories split the lines** (`lineTotalBani`, already net of the line's own discount, so a discount is never
  taken twice). A product line counts in its product's category when the product and that category are live, else in
  its own `categoryId` when that category is live, else in the visible bucket **"Fără categorie"**. Deposits, bags and
  fees count too, in the system **"Non-produs"** category (or the regular category the user gave the line). A
  **standalone discount** line (a coupon or promo, negative) reduces the category of the nearest product line **above
  it** by `idx`, because receipts print it under the item it reduces, so the categories are net of coupons; with no
  product line above it (a basket-level coupon first on the receipt) it stays in Non-produs, which is then below zero.
  (The price analytics of §5b keep a standalone discount out of unit prices; this is the spending rule only.) A receipt
  without a live line is one uncategorized amount. Categories are a flat list (`parentId` is ignored).
- **What is left is never spread over the categories.** `paid - Σ lines` is reported as two signed
  `adjustments`: `vouchersBani` (zero or negative) and `roundingBani` (the lines against the printed total: METRO's one
  ban, or a mismatch the user accepted in the review). So `Σ categories + vouchersBani + roundingBani = totalBani`
  always holds (a property test), and the screens print those rows and the total under the categories.
- **Months** are the printed Europe/Bucharest months (`purchasedAt` is local time, so a receipt at 23:59 on the 31st
  stays in its month); only `now` needs the time zone (`currentMonth(now)`: at 22:30 UTC on 30.11 it is already
  December). A receipt dated in the future belongs to its own month.
- Money is integer bani; the only floats are percentages (ratios).

| Function                                                  | Purpose                                                                                      |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `toSpendingReceipts(source)`                              | the pure core: `SpendingReceipt[]` (paid, voucher, difference and the parts per bucket), oldest first |
| `loadSpendingReceipts(db)`, `getSpending(db, period?)`    | the same from the database, in one read transaction; `getSpending` sums it over a period       |
| `summarizeSpending(receipts, { from?, to? })`             | `PeriodSpending`: `totalBani`, `receiptCount`, `categories` (biggest first), `adjustments`, `months`, `stores`. Both ends are `YYYY-MM` and inclusive and default to the first and last month with a receipt; every month between them is listed (the empty ones with 0, so a gap shows), unless the span is over ten years (a receipt dated 2099 by mistake), when only the months that have a receipt are |
| `compareSpending(current, previous)`                      | the change of the total (`deltaBani`, `pct`, absent when nothing was paid before) and the earlier amount of each current bucket |
| `currentMonth(now)`, `lastMonths(now, n)`, `shiftMonth`, `monthRange`, `monthSpan`, `monthOf` | month arithmetic; the clock is always a parameter |
| `priceIncreases(products, observations, { now, days, excludeSales })`, `loadPriceIncreases(db, { limit? })` | the products that got dearer, biggest percentage first (below) |
| `recentReceipts(receipts, stores, limit)`, `loadRecentReceipts(db, limit)` | the newest live receipts (drafts included) with the counts of all and of drafts |

**Price increases.** Per product and store, the latest purchase against the previous one **at the same store** (the rule of
`priceChange`, §5b), in the product's base unit, with sale prices left out when `excludeDiscountedPrices` says so. The
increase must be **seen** in the window: the later purchase is within `priceWindowDays` of today (the earlier one may be
older), and under half a percent is noise. A product that got dearer at two stores is listed twice. A promotion that
ended reads as an increase unless the user leaves sale prices out, so both lists mark a sale price.

### Screens

Both read through a Dexie live query (`useDbQuery` of `src/ui/live.ts`, with the shared `Loading` and `Failure` of
`src/ui/states.tsx`: the querier must be an `async` function), so they follow imports, edits and settings; an unavailable
IndexedDB shows a message. `useToday` (the Bucharest day, read again when the app returns to the foreground and once a
minute) is the `key` of each screen, so an installed app that stays open overnight starts the new month with a fresh
clock instead of keeping the old one. Counts and their nouns are `plural` of `src/ui/plural.ts` (`20 de bonuri`).

- **Acasă** (`loadHome`): the *first run* (no live receipt) is one card with "Adaugă primul bon" (`/adauga`). Otherwise:
  "Luna aceasta" (paid this month, receipts, the change in money and percent against the **whole** previous month, or why
  there is none; early in a month this reads as a fall, so the change is neutral, never red or green, and the previous
  total is always shown), a note when a confirmed receipt is dated after this month (it is counted in its own); "Pe
  categorii" (this month's buckets with the previous month's amount as a thin second bar and text; the first five
  categories, and "Non-produs" and "Fără categorie" whenever they hold something, with "Arată toate categoriile" for the
  rest; then the voucher and rounding rows and the total); "Ultimele bonuri" (the five newest, drafts marked "Ciornă",
  each a link to its review `/bonuri/:id`); "Creșteri de preț" (the five biggest of the user's `priceWindowDays`, each a
  link to the product, sale prices marked; "Toate cele N de creșteri" opens Statistici). Drafts get a notice with a link
  to `/bonuri`.
- **Statistici** (`loadStats`, `viewPeriod`): the period is 3, 6 (default), 12 months up to the current one, or "Tot",
  kept in the address (`?perioada=3|6|12|tot`, so Back and reloads keep it). `loadStats` does not depend on the period:
  it returns every confirmed receipt and `viewPeriod` derives the period from it, so switching is a change of view, never
  a new query (no loading state, the picker keeps its focus). "Pe luni" (newest first, every month between the first and
  the last), "Pe categorii" (with the share of the goods, `<1%` for a sliver, computed over the categories above zero so
  that no share goes over 100%, and the same adjustment rows), "Pe magazine" (by store, with receipts and share of the
  total), and "Creșteri de preț" in detail (every increase, ten at first: both prices and dates, the move in money and
  percent, the shelf price of the pack, sale marks). The comparison window and the sale filter are the settings of the
  product screens, which the card links to. A receipt dated after a "last N months" period (in the future) is left out of
  it with a note and counted in its own month under "Tot"; without any confirmed receipt the screen invites to add one.
- **Charts** are plain HTML and CSS bars (`BarList`), no chart library: nothing to load or precache, every number is
  also text, and the bar widths are set through the CSSOM (`style` prop), which `style-src 'self'` allows (checked in
  the built app). Colours of the buckets come from the category records.
- **`src/ui/insights`**: `format.ts` (months, days, signed money, `+7,5%`, `ultimele 90 de zile`, unit prices), `BarList`,
  `PriceIncreaseList`, `Adjustments` and `useToday`. Products and lists keep their own copies of the unit-price and date
  formatters, like their live-query hooks; pointing them at shared ones is a follow-up.

**Tests.** `src/analytics/*.test.ts`: month arithmetic and the Bucharest boundaries (winter and summer); the spending core
on hand-made records (what counts, the buckets, a coupon under its item or before any item, the months of a period); 
`spending-queries.test.ts` saves the four ground-truth receipts with `saveReceipt` (`spending-testing.ts`, which keeps the
printed paid amount and fills the categories from the catalog's hints like the import does) and checks them in their months
(METRO in August, Mega Image and Kaufland in November, Lidl in the future December), plus synthetic multi-month data (month
ends, discounts and a voucher, drafts, deleted receipts, replaced lines, recategorized and deleted categories, a removed
store); a fast-check property for the identity above. The screens have jsdom tests with the fixtures' clock (20.11.2026):
first run, loading and failure, comparison with the previous month, drafts, period switching and its focus, the
future-dated receipt, coupons and shares, increases and the settings, a new day, and following new data live.
`e2e/dashboard.spec.ts` (§14) runs them against the production build, and the build was audited with axe-core (WCAG 2.2 AA,
light and dark: no violation).

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
- Component tests are robust under CPU load (several vitest runs at once, busy CI runners): `tests/setup.ts`
  (`setupFiles` in `vite.config.ts`) gives Testing Library's `findBy*`/`waitFor` a 5 s budget instead of 1 s and
  `testTimeout` is 15 s, so do not add per-assertion timeouts. Wait for effects instead of asserting right after
  an `await findBy*` (focus: `expectFocus` in `src/features/receipts/testing.tsx`), and load the lazy route modules a
  test needs in `beforeAll` (`warmRoutes(...featureIds)` in the same file) so the first test of a file does not pay
  for them inside a `findBy*` budget.
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
| `npm run e2e`                                      | builds, then runs the Playwright specs of `e2e/` in a mobile Chromium against `dist/` (separate from `check`, required in CI, §14) |
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
| `finishReceipt(receipt, notes, { now })` | what `parseReceipt` does with a parser's answer: the parser's own warnings first, then `UNKNOWN_CHAIN` and every validation warning that is not already reported. For an engine that reads a receipt without a parser (the optional Gemini reading, §16) |
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
| `dates.ts`, `vat-rate.ts`      | `readPurchasedAt` -> `{ purchasedAt?, warnings }` (`DATA:29/12/2026 ORA:17-12-30`, two-digit years; a clock is read only when it stands alone, so the tail of a damaged one such as `ORA:1/-03-04` never becomes the time: the bare date is kept and a `LOW_CONFIDENCE` note says the time was unreadable), `readVatRate` (an illegal printed rate becomes the nearest legal one, the VAT amount and the class's usual rate break ties) |
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
  itself: it knows nothing of the parsers). The import orchestrator does it (§12, "Second OCR pass").

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
undo it with `resetImportServices()`. The optional Gemini reading is a fourth port, `ai: AiPort` (`defaultAi` in `engines.ts`): it
does not produce text for a parser but a `ParsedReceipt`, and only the review's "Citește cu AI" calls it (§16).

### Import (`importReceipt`, `importToDraft`)

| Step | What happens |
| --- | --- |
| detect | the file signature decides (PDF header within 1 KB, JPEG/PNG/GIF/BMP/WebP/HEIC), then the declared type and the extension; text files and pasted text need no engine |
| extract | `extractPdfText(ArrayBuffer)` / `recognizeImage(file, { signal, onProgress, preprocessing? })` / `{ kind: 'pasted-text', text }`; no text at all is `NO_TEXT` |
| parse | `parseReceipt(source, { now: services.now() })`; no line recognised is `NOTHING_RECOGNIZED` |
| second pass | a photo whose parse still has `SUM_MISMATCH`, `MISSING_TOTAL`, `MISSING_DATE` or `LINE_ARITHMETIC` is read once more (below) |
| check | SHA-256 of the input (WebCrypto) and `findDuplicateReceipts` (same file, or same store + day + total) add a Romanian `DUPLICATE` warning |
| save (`importToDraft`) | find-or-create the store (chain + branch), `saveReceipt` as `draft`; `importReceipt` alone persists nothing |

Progress is reported per phase (`reading`, `extracting` with an OCR fraction, `rereading` with the fraction of the second
pass, `parsing`, `checking`, `saving`); aborting the signal between steps (and inside OCR, in both passes) rejects with
`ImportError('CANCELLED')`. Failures are `ImportError`s whose `code`
(`UNSUPPORTED_FORMAT`, `EMPTY_INPUT`, `FILE_TOO_LARGE`, `NO_TEXT`, `NOTHING_RECOGNIZED`, `ENGINE_UNAVAILABLE`,
`EXTRACTION_FAILED`, `SAVE_FAILED`, `CANCELLED`) the screen turns into Romanian text. Limits: 40 MB per file, 200,000
characters of pasted text.

**Second OCR pass** (`second-pass.ts`, `improveReading` in `pipeline.ts`). One OCR pass is sensitive to the upscale (§11),
so a photo whose first reading still carries one of the four warnings above is read again with
`recognizeImage(file, { signal, onProgress, preprocessing: { scale: 3 } })` (`SECOND_PASS_SCALE`; the first pass uses the
engine's default, 4x), parsed like the first, and the better reading is kept (`pickBetterPass`), in this order: a reading
with no line never wins; the one whose lines add up to the printed total (no `SUM_MISMATCH` or `MISSING_TOTAL`); the one
with fewer warnings; the one with fewer of the four retry warnings (so a date that was found, even if it lies in the
future, beats a missing one); on a tie the first reading. A clean first reading costs no extra time, and PDFs and pasted
text never retry. It is best effort: a second pass that fails, or finds no text, keeps the first reading; only
cancellation stops the import. The `DUPLICATE` check and the review session use the reading that was kept. The screen
shows one extra status while the second pass runs (`rereading`, "Se verifică încă o dată citirea pozei…", with its own
progress bar and the same "Anulează" button).

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

**One verdict for the sum.** `analyze` classifies `Σ lines - total` once, as `Analysis.sumMatch`, with the parsers'
`SUM_TOLERANCE_BANI` (§10; `Analysis.toleranceBani` carries it): `exact` (to the ban), `within-tolerance` (1 to 5 bani, e.g.
the METRO invoice, which prints its VAT rounded per rate and is 1 ban off: no warning, nothing to accept, the amounts are
shown and stored as they are) or `outside-tolerance` (what raises `SUM_MISMATCH`, which has to be accepted; a total that was
not read has no tolerance). The sum line above the warnings and the warnings panel both read that value (`sumStatusText`,
`noWarningsText` in `features/receipts/review/text.ts`), so they cannot disagree: green "se potrivesc" and "suma liniilor se
potrivește cu totalul"; neutral "diferență +0,01 lei, acceptată (în limita de ±0,05 lei)" and the same difference, said as
within the accepted limit, in the panel; amber "diferență +0,06 lei, peste limita de ±0,05 lei" next to the `SUM_MISMATCH`
warning and its checkbox. Only the sum line uses the words "diferență" and "se potrivesc" (other tests look for them).

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

Tests: `src/import/testing.ts` has fakes for the ports (`fakeEngines`, which takes one OCR source per pass, `fakeParser`
backed by the real validation, `fakeCatalog`, `testServices`); `src/features/receipts/testing.tsx` renders the whole app
router over an in-memory database with a fixture's ground truth as the parser's answer. The flows drive import, review,
an edited price and the confirmation for the Kaufland, METRO, Lidl and Mega Image fixtures. The second OCR pass is tested
with the real parsers behind a fake engine that returns two readings of the Lidl and Mega Image OCR fixtures
(`pipeline.second-pass.test.ts`).

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
| `status.ts`, `runtime.ts`, `run.ts`, `services.ts` | the last result, `loadSyncView`, the in-memory runtime (`running`, the phase, `lastAttempt`: how the sync that ended last came out), `currentFailure`, `runSync` (one at a time), the injectable services (`getSyncServices`, `setSyncServices({ fetch, getDb, now, ... })`) |
| `auto.ts`             | automatic sync (below), started by `src/main.tsx` after the first render                                  |
| `errors.ts`           | `SyncError` with a `code` (`SYNC_ERROR_CODES`), `SyncFailure`/`describeFailure` (a failure as plain data); the screen turns codes into Romanian text |
| `mock-github.ts`      | **test-only**: `MockGitHub`, an in-memory api.github.com (no `@/` import, so a browser test can use it too)  |
| `testing.ts`          | **test-only**: `makeWorld`, `makeDevice`, `seedSample`, `at(iso)` (and re-exports `MockGitHub`)           |

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

**One value for the failure.** What a screen says about the last sync comes from two places that are not equally fast: the
runtime (`lastAttempt`, set in the same update that ends `running`, whoever started the sync: the button, automatic
sync, the onboarding) and the stored status, which reaches the screen through the live query a moment after it is
written (and is the only witness after a restart or of another tab). `currentFailure(status, lastAttempt)` picks the
newer of the two (a tie goes to the session: it is the same sync) and the panel derives **both** the alert and the note
"Sincronizarea automată este oprită…" from that one value, so they appear together and a later success (from any
trigger) removes a failure that an earlier sync left. `saveConnection` and `disconnect` reset `lastAttempt`: it was
about the old connection. A screen must not keep a failure of its own in component state for the same reason.

### Tests

Everything runs against `MockGitHub` (`src/sync/mock-github.ts`): users, tokens with `write`/`read`/`metadata` access,
repositories (private or public, archived, with or without a first commit), the Git Data API with real Git object ids,
fast-forward checks, and switches to break things on purpose (`setOffline`, `failNext(match, reply)`, `before(match,
action)` to let another device push between two requests of a sync, `limitTrees`, `dispose()`). `makeDevice` (from
`src/sync/testing.ts`) is a database of its own that syncs as a user; `seedSample` fills one. The suites cover the
first push, pull and merge, last write wins, ties, tombstones, line reconciliation of a receipt re-saved on two devices,
a rejected ref update followed by a retry (and giving up), the private-only rule, token and permission errors, rate
limits, offline, unreadable or newer repository data, files that are not ours, re-sharding, the token never reaching a
backup or the repository, automatic sync (a fake clock, timers and triggers), and the whole onboarding through the
Settings screen.

**Test hygiene.** A test must never leave a sync running into the next one: a request held by a hook is released by a
gate that exists from the start of the test (not by a variable the hook sets), and the harness `afterEach` calls
`MockGitHub.dispose()` (held and later requests fail at once), `await resetRunSync()` (waits for the sync they belonged to),
resets the services, the runtime and the token, and deletes the test database. The Settings tests need the global
IndexedDB (`import 'fake-indexeddb/auto'`, for Dexie's live queries); their waits use `WAIT`/`within`/`waitFor` from
`src/features/sync/testing.tsx`, so none depends on a global Testing Library timeout.

The stored state reaches the screen **late** (written, then read back by a live query), so a test that checks something
derived from it right after waiting for something else (an alert that the sync itself raised, say) is racing the live
query; it passes on a quiet machine and fails on a busy one. Wait for the thing that is checked (`findBy…`/`waitFor`),
or check what the screen shows when it has only the stored state (`harness.restart()` closes the app and opens
Settings again). To pin an order that must not depend on that delay, `harness.slowReads(ms)` makes the reads outside
transactions slow from then on (a Dexie middleware; the application code is the real one). Two switches turn the
whole file into a stress test, both off unless set: `VITE_SYNC_TEST_LATENCY_MS=150` delays every request of `MockGitHub`
(`setLatency`) and `VITE_SYNC_TEST_READ_DELAY_MS=150` every such read, e.g.
`VITE_SYNC_TEST_LATENCY_MS=150 npx vitest run src/features/sync`. Run a few of those concurrently when a test is
suspected of being flaky.

**Browser check.** `e2e/sync.spec.ts` (`npx playwright test e2e/sync.spec.ts` after `npm run build`; see §14) runs the
**production build** in Chromium with `api.github.com`
answered by the same `MockGitHub` through `page.route`: the instructions, the checks, a first sync, a changed record
sent by "Sincronizează acum", the automatic sync that a fresh page load starts by itself, a repository that turned
public being refused, disconnecting, and the passphrase flow (encrypted in the real IndexedDB, locked after a restart).
It also fails on any console error or failed request, so the CSP is part of what it checks. A repository on the real
GitHub was **not** available to the authors: the README lists what to check by hand.

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
**manual retry**, and points at the copies outside the browser: the file export ("Copie de siguranță", §15) and the GitHub
sync (§13).
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
`E2E_CHANNEL=chrome` to use the installed Google Chrome. The CI `verify` job installs Playwright Chromium with its system
dependencies and tests the same `dist/` that it uploads to Pages. Browser failures block deployment; CI does not collect
traces, and the private OCR benchmark remains local. Inputs are made on the fly from the fixtures
(`e2e/support/samples.ts`: a text PDF with the Kaufland items, a canvas
photo of the Lidl text; `seed.ts`: price history written into IndexedDB; `dashboard-seed.ts`: the receipts of the Home and
Statistics screens), so nothing binary is committed.

| Spec | Proves |
| --- | --- |
| `offline.spec.ts` | the install stores the shell and not the engines; Settings updates its readiness and download action when a late worker takes control on the first visit, with no reload; offline routes render with IndexedDB data and no failed request or script error; a returning visit opens offline; the camera input |
| `engines.spec.ts` | a PDF and a photo (OCR, then the Lidl parser) import offline after the first use of each engine, and after "Descarcă acum" with no earlier use; without either, the error names the cause |
| `share-target.spec.ts` | Chromium reports no manifest or installability errors; a share POST imports (also offline); several files are listed; an empty or expired share leaves the screen usable |
| `update.spec.ts` | an update installs in the background, the page and a reload stay on the old version until "Actualizează", the engine caches survive, the new version works offline |
| `persistence.spec.ts` | state and retry in Settings; the ask happens once after the first confirmed receipt and later visits do not even load the watcher |
| `admin.spec.ts` | Settings shows the Categorii, Magazine and Copie de siguranță cards and both screens open; an export downloads a dated `*.pretometru-backup.json` that imports back (preview, merge, replace after its question; a newer format and a non-backup are refused in Romanian) with no request leaving the origin and no console or CSP error; deleting a category moves its products (the product list shows them in the new one); merging two stores moves the receipts (§15) |
| `dashboard.spec.ts` | Home and Statistics (§5e) with the clock fixed at 20.11.2026: the first-run state on both; the numbers of a seeded device (this month against the previous one, categories with the voucher row, last receipts with a draft and a future date, a price increase) and links to the review and the product; the bars are drawn under the CSP of the build; Statistics over 6 months, 3 months and "Tot" with the future receipt, offline and with no failed request or script error (`support/dashboard-seed.ts` writes the receipts) |
| `journey.spec.ts` | two synthetic receipts go through import, review, product mapping and confirmation; their amounts drive the cheapest-store order and list estimate; a cold offline navigation preserves those values and a checked item; axe checks WCAG 2.2 AA rules on import, review, comparison and the populated list |
| `ai.spec.ts` | the optional Gemini reading (§16), with `generativelanguage.googleapis.com` answered by `MockGemini`: with the feature off nothing is sent to Google and no engine chunk is requested (through Settings, a photo import and its review); switched on, the connection test sends only a `GET` of the model, a 12 megapixel photo leaves as a JPEG of at most 3.5 megapixels without EXIF and with the key in a header, the reading replaces the wrong one and is saved only on Save; failures are Romanian messages and offline nothing is attempted |

### Limits

Lighthouse 13.6.0 has no PWA category. On the local production build, its mobile navigation audit of Home scored
100 for accessibility and 96 for best practices (a CSP inspector issue). That is not an installability score:
the browser checks instead verify manifest and installability diagnostics, active service-worker control and actual offline
navigations. The automated accessibility checks do not substitute for manual accessibility testing.

Checked once on the deployed site (headless Chrome, GitHub Pages): the worker installs and controls the page, the manifest
has no errors, the pdf.js worker is served as `text/javascript`, and a PDF imports offline after its first use with every
main route rendering. Not verifiable here: the Android share sheet, an installed PWA on iOS (Safari's storage rules) and
Chrome's real answer to `persist()` for an installed app.

The share-target action answers any POST below the scope, as the manifest requires, so a page on another site can submit a
form to it and leave drafts in the add-receipt screen (nothing is confirmed, synced or sent anywhere; a share can be at most
ten files of any size, which the importer then refuses above 40 MB). If that ever matters, show the shared files and wait for
a tap instead of starting the import (`useSharedFiles` in `src/pwa`). An update that changes an engine leaves the new engine
unstored until it is next used online or fetched from Settings: the old caches are deleted when the new worker activates.

## 15. Backup, categories and stores (`src/admin`, `src/features/backup`, `categories`, `stores`)

The Settings parts of plan §8 that need no network: a **backup file** the user keeps (export and import), and the
management of **categories** and **stores**. `src/admin` (import from `@/admin`) is React-free logic over the domain and
storage layers; the three features are thin screens over it. ESLint forbids `fetch`, `XMLHttpRequest`, `WebSocket` and
`EventSource` in `src/admin` and `src/features/backup` (§1) and the tests stub all four: nothing here touches the network,
the file is the only way out of the device.

| Module (`src/admin/`)       | What it holds                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `backup.ts`                 | `prepareExport`, `readBackupFile` / `previewBackup`, `applyBackup`, `countLocalData`, `getLastExportAt` / `recordExport`, `backupFileName` |
| `categories.ts`             | `listCategories`, `addCategory`, `updateCategory`, `moveCategory`, `deleteCategory`, `isSystemCategory`   |
| `stores.ts`                 | `listStores`, `renameStore`, `mergeStores`, `deleteStore`                                                  |
| `errors.ts`, `text.ts`      | `AdminError` with a `code` (`ADMIN_ERROR_CODES`; screens turn codes into Romanian), `tidyName`, `nameKey`  |
| `testing.ts`                | **test-only**: `seededTestDb`, `resetDb` (the shared app database), `addStore`, `addProduct`, `addReceipt` |

### Backup

```ts
const prepared = await prepareExport(db);            // { fileName, text, bytes, exportedAt, counts, skipped }
downloadTextFile(prepared.fileName, prepared.text);  // the feature: a Blob URL and a click, no request
await recordExport(db, prepared.exportedAt);

const read = await readBackupFile(file);             // { ok: true, preview } | { ok: false, refusal }
if (read.ok) await applyBackup(db, read.preview.backup, 'merge'); // or 'replace'
```

- **The file** is `pretometru-YYYY-MM-DD.pretometru-backup.json` (the Bucharest day), the format of
  [`contracts.md`](contracts.md): every record, tombstones included, and the portable settings only. `skipped` lists the
  stored records that no longer satisfy their schema and were left out; the screen shows them instead of failing.
- **Last export.** `recordExport` writes the setting `lastExportAt`, which is **not portable**: a fact about this device,
  never exported or synced, and a `replace` import leaves it alone. The card shows it as a plain line ("Ultima exportare:
  …", or "Nu ai exportat încă…"): no reminder, colour or counting of days.
- **Preview.** `previewBackup(text)` is `parseBackup` plus a summary: the format version, `exportedAt`, per kind the live
  records and the tombstones the file carries, and its warnings. A refusal is a **code**, not a sentence: `not-json`,
  `not-backup`, `newer-version` (a format above `BACKUP_FORMAT_VERSION` is refused, never imported partly), `invalid`
  (the validator's English reasons are kept as technical details), `too-large` (above 50 MB, refused without reading the
  file) and `unreadable`. The validator's wording is English, so the module classifies it: refusals from the file's own
  header, and the dangling-reference warnings (`3 receipt(s) reference a store that is not in the backup`) into
  `{ kind: 'dangling', count, subject, target }`. `backup.test.ts` pins every combination against the real validator, so a
  reworded warning fails a test instead of reaching the screen in English. A UTF-8 byte order mark is accepted.
- **Import.** `applyBackup` is `importBackup` plus the summary the screen shows: per kind how many records were added,
  updated or already up to date, and how many settings of the file were ignored for not being portable. `merge`
  (the default) keeps what the device holds and takes, record by record, the copy changed last (a newer tombstone
  deletes, a later edit beats an earlier deletion); `replace` makes the file the data and leaves the device's own
  settings and sync state (token, key, last export). One transaction: a database that refuses changes nothing.
- **`replace` and GitHub sync.** Sync merges by last write (§13) and never removes records from the repository, so after
  a `replace` the next sync can bring back what the repository still holds. The confirmation says so; restoring an old
  state with sync on is a merge, not a rollback.

**The card "Copie de siguranță"** (`order: 580`, between the sync and the offline cards). Export: what the device holds
("120 de bonuri, 340 de produse și 3 magazine"), "Exportă datele", the name and size of the file, the records that were
left out, the last export. Import: a file input (`.json`), then either a refusal in Romanian (with "Detalii tehnice" for a
damaged file) or the preview (format version, export time, counts per kind and the deletions the file carries, warnings)
and the choice *Îmbină cu datele de acum (recomandat)* / *Înlocuiește tot*. *Înlocuiește tot* asks "Înlocuiești datele de
pe acest dispozitiv?": what the device holds now against what the file holds, that it cannot be undone, the sync note
above, and a button that downloads a copy of the current data first; the confirmation stays disabled until the card knows
what the device holds. Then a status with the counts. Accessibility: every field is a `<label for>`; the preview heading
takes focus when it appears, the question puts focus on "Anulează" and Escape cancels, the result heading takes focus;
refusals and failures are `role="alert"`, results `role="status"`.

### Categories (`src/admin/categories.ts`, the screen `/setari/categorii`, card `order: 100`)

- `listCategories(db)`: the live categories in the user's order, the system one last, each with the live products and lines
  that use it. `addCategory`: the name is tidied (trimmed, one space) and unique among live categories (`Băuturi` equals
  `bauturi`), the icon is **one emoji** (a single grapheme that is pictographic, a flag or a keycap), the colour is
  `#rrggbb` (stored lower case), the new category goes after the last orderable one (`order` + 10).
- `updateCategory` goes through `updateRecord`, so the edit is newer than the built-in category (epoch) on every device
  and `ensureSeed` leaves it; nothing is written when nothing changes. The system category keeps its name (its icon and
  colour may change).
- `moveCategory` swaps a category with its neighbour among the orderable ones and numbers them 10, 20, 30... again,
  writing only those whose number changed, so equal numbers left by two devices heal. The system category stays last.
- `deleteCategory(db, id, { reassignTo })` is one transaction: its live products and its live lines move to `reassignTo`
  (a live category that is neither the system one nor the deleted one), which is **mandatory while anything uses it**
  (`TARGET_REQUIRED`); sub-categories move up to its parent; the category becomes a tombstone (`softDelete`), which is what
  keeps a deleted built-in category from coming back (`ensureSeed` skips a tombstone, `purgeTombstones` keeps the seed
  ones). "Non-produs" cannot be deleted, renamed or moved (`SYSTEM_CATEGORY`, checked by flag and by id). Aliases point at
  products, so they need no change.

### Stores (`src/admin/stores.ts`, the screen `/setari/magazine`, card `order: 200`)

- `listStores(db)`: the live stores by name (Romanian collation) with their live receipts (drafts included).
- `renameStore` changes the name only. What identifies a store for the importer (chain, branch code and city,
  `matchesStoreSpec` in `src/import/stores.ts`) stays, so the next receipt of that branch arrives at the same store. For the
  `unknown` chain the importer also matches the printed name, so renaming such a store means a later receipt under the old
  printed name creates a store again: merge them.
- `mergeStores(db, intoId, fromId)` is one transaction: the live receipts of `fromId` (drafts too) get `storeId = intoId`
  through `updateRecord` (their lines and `linesUpdatedAt` are untouched), then `fromId` becomes a tombstone. The kept store
  keeps its own name, chain, branch and city; the screen offers the stores of the same chain first. Merge stores that are the
  same shop: later receipts are matched by chain, branch and city only.
- `deleteStore` only when no live receipt points at the store (`HAS_RECEIPTS`).

### The screens and what they share

Both routes are reached from their Settings card ("Gestionează categoriile", "Gestionează magazinele") and lead back with
"← Setări"; they have no navigation entry. Everything destructive asks first, in an inline `ConfirmPanel` whose safe answer
(or the required `<select>`) has focus and which Escape cancels; the confirm button of a question that needs a choice (the
category to move to, the store to keep) stays disabled until it is made, and nothing is preselected. A refusal puts focus on
the field it is about; focus returns to the button that opened a form or a question, goes to the list heading when a row
leaves, and stays on a move button (or goes to the other one when the row reached the end). The lists follow changes made
elsewhere (sync, another tab) because they read through a Dexie live query.

`src/ui` got the pieces the three features share: `live.ts` (`useDb`, `useLiveQuery`, `useDbQuery`: the hooks of
`src/features/products/useLive.ts` and `src/features/lists/useLive.ts`, which keep their own copies), `states.tsx`
(`Loading`, `Failure`), `ConfirmPanel.tsx` and `plural.ts` (`plural(2, 'produs', 'produse')` is `2 produse`, 20 is `20 de
produse`).

### Tests and limits

`src/admin/*.test.ts` run against fake-indexeddb: the export -> import round trip in both modes, with tombstones and the
portable settings only (a token, a key and the last export never travel; a planted non-portable key in a file is
ignored), last write wins and deletions in a merge, every refusal, every warning `parseBackup` can raise, all-or-nothing
writes (an invalid stored record stops a category deletion or a store merge and nothing changes), the system category,
reassignment on deletion, the merge moving receipts and tombstoning the source, and that `fetch`, `XMLHttpRequest`,
`WebSocket` and `EventSource` are never touched. The screens have jsdom tests like the product and list screens (the
shared database, `fake-indexeddb/auto`), including the whole app router for the Settings cards and the way back.

Not verified: the download on iOS Safari (a Blob URL and a click on `<a download>`, the portable way) and how each Android
file manager filters by `accept`; a backup of tens of megabytes on a phone (the file is read and validated on the main
thread, which blocks for a moment).

## 16. Optional AI reading, Gemini (`src/ai`, `src/features/ai`)

An optional second way to read a photo or screenshot: Google's Gemini API with the user's **own key**, **off by default**
(plan §2, §11, §12.5). The image leaves the device only when the user presses "Citește cu AI" on one receipt and confirms
what is sent. Nothing of it loads or runs unless the feature is switched on. This section starts with what the Gemini
documentation said when the feature was built, because the plan marked those points "de verificat" and they change.

### What Gemini's documentation said (read on 2026-11-20)

Official pages, read as markdown from `aistudio.google.com/docs/*.md` (the `ai.google.dev/gemini-api/docs/*` addresses
redirect there). Re-check them whenever this feature is touched.

| Point | What the documentation says | What the app does about it |
| --- | --- | --- |
| Data use on the free tier | *Gemini API Additional Terms of Service* (effective 2026-03-23), "Unpaid Services": Google uses the submitted content and the answers to improve its products, human reviewers may read them, and "Do not submit sensitive, confidential, or personal information to the Unpaid Services". The pricing page says the same (free: "Content used to improve our products: Yes", paid: "No"). | The Settings section and the confirmation before every send carry this warning (`src/ai/notice.ts`, one text for both). |
| EEA, Switzerland, UK | The same terms: there, the *Paid Services* data terms (no product improvement use) "apply to all Services, including Google AI Studio and unpaid quota in the Gemini API", but also "You may use only Paid Services when making API Clients available to users in the European Economic Area, Switzerland, or the United Kingdom". | The warning names this exception and does not rely on it: the app cannot know where the user is, so it tells them to read the terms. |
| Who the terms are for | "for developers building with Google AI models for professional or business purposes, not for consumer use". | Said in the README and the Settings text: the key and its terms are the user's own responsibility. This is why the feature is optional, off, and never the only way to import. |
| Models | Gemini 2.5 is deprecated (`gemini-2.5-flash` routes to `gemini-3.5-flash-lite` on 2026-12-01; 2.5 access is limited to existing users). For new projects the pages name Gemini 4 Hydrogen and **Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`, stable, July 2026: "document parsing", structured outputs supported, free tier, thinking "minimal" by default). `gemini-3.6-flash`, `gemini-3.8-flash` and `gemini-4-hydrogen` also have a free tier; the other Gemini 4 models do not. | The default model is `gemini-3.5-flash-lite`; the model id is a setting (Settings, "Setări avansate"), because model names are retired every few months. |
| Which endpoint | `generateContent` is "still supported for existing integrations, but is considered a legacy API"; the new default is the Interactions API. That one needs an `Api-Revision` request header, and the CORS preflight with that header is **refused (403)**, so a browser cannot use it. | `generateContent` (`POST /v1beta/models/{model}:generateContent`). Its preflight was checked with `OPTIONS` from `https://mariuscosmuta98.github.io` and from `http://localhost:4173`: 200, the origin is echoed, `content-type` and `x-goog-api-key` are allowed. `GET /v1beta/models/{model}` (the connection test) too. |
| Request shape | `inline_data` image part before the text part, `generationConfig.responseMimeType: "application/json"` with `responseJsonSchema` (JSON Schema subset: `type`, `properties`, `required`, `items`, `enum`, `description`), the whole request below 20 MB. Images: PNG, JPEG, WebP, HEIC, HEIF. | As described in "The request" below. |
| Sampling and thinking parameters | `temperature`, `topP`, `topK` are ignored on Gemini 3.6+ and 4 and "will return 400 errors in a future release"; `thinkingLevel` is an error on models before Gemini 3. | The request sends none of them: it works on any model and the default thinking of the default model is already minimal. |
| Image tokens | From Gemini 3 on the default media resolution of an image is already the high one (1120 tokens). | No `mediaResolution` is sent; the image is limited to 3.5 megapixels (below). |
| API keys | AI Studio creates *authorization keys* by default since 2026-05-28; unrestricted standard keys are rejected; the pages warn against shipping a key in client code. | The key is typed by the user, kept on their device only and sent in the `x-goog-api-key` header, never in a URL. The README says to use a key made for this app and to delete it when a device is lost. |
| Errors | A wrong key answers `400` with `error.status: "INVALID_ARGUMENT"` and `details[].reason: "API_KEY_INVALID"` (checked with a made-up key, no data sent; the error answer carries CORS headers, so the page can read it). `429 RESOURCE_EXHAUSTED` for the per-minute and the per-day limits (the day resets at midnight Pacific time); `Retry-After` is **not** exposed to browsers. | See "Errors". |
| Region | Romania is in the list of available regions. | - |

Checked in a real browser too (headless Chrome, page origin `http://localhost:4173`, a made-up key, no data): a `GET` of the
model and a `POST` of `generateContent` with the exact `fetch` options of the client (`x-goog-api-key`, `Content-Type`,
`credentials: 'omit'`, `cache: 'no-store'`) are answered `400 API_KEY_INVALID` and the page can read the body, so CORS
and the options work. Google's preflight echoes the requested headers, so its allow-list is not the limit: the client
sends two headers because that is all it needs.

### What was built

| Module (`src/ai/`) | What it holds |
| --- | --- |
| `index.ts` | the **light barrel** (imported by the screens and by `src/import`): settings, Romanian texts, errors, `getAiServices`, and two thin wrappers, `readReceiptWithGemini` and `testGeminiConnection`, that load the engine with `await import()` on first use |
| `config.ts` | the settings in `syncState` (below): `readAiConfig`, `isAiEnabled`, `saveApiKey`, `removeApiKey`, `setAiEnabled`, `setAiModel`, `DEFAULT_MODEL`, `isValidModelId`, `isPlausibleApiKey`; `readApiKey` is for the engine only (not in the barrel) |
| `errors.ts`, `messages.ts`, `notice.ts` | `AiError` with a `code`; `describeAiError` (the Romanian text of every code); the disclosure paragraphs shown in Settings and, word for word, in the confirmation before every reading |
| `services.ts` | `getAiServices` / `setAiServices({ getDb, fetch, now, isOnline, prepareImage })`: the one network door, injectable for tests |
| `read.ts`, `connection.ts` | the lazy entry points: `readReceiptWithGemini(image, { signal, onPhase })` and `testGeminiConnection({ apiKey?, model?, signal? })` |
| `client.ts` | `createGeminiClient({ apiKey, model, fetch, isOnline, signal, timeoutMs })` with `getModel()` and `readReceipt(image)`; `buildGenerateRequest`, `errorFromReply`, `answerText` |
| `prompt.ts` | the system instruction, the user prompt, `RESPONSE_SCHEMA`, `GEMINI_READING_VERSION`, `MAX_OUTPUT_TOKENS` |
| `convert.ts`, `values.ts` | `convertAnswer(text, { model, now })`: the answer as a `ParsedReceipt`; the exact converters it is made of (`toBani`, `toQuantity`, `toText`, `toEan`, ...) |
| `image.ts` | `fitWithin` (pure) and `prepareImage` (canvas, browser only) |
| `mock-gemini.ts`, `testing.ts` | **test-only**: `MockGemini`, an in-memory Gemini API (no `@/` import, so `e2e/ai.spec.ts` serves the real app from it); `answerFromReceipt`, `wireMockGemini`, `FAKE_KEY` |

### The request

`POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent` with the headers `x-goog-api-key`
and `Content-Type` and nothing else; the model id is validated (`^[a-z0-9][a-z0-9._-]{1,63}$`) and encoded, so it is one
path segment. The body: `systemInstruction` (the rules of `prompt.ts`: copy, never compute; lei with a dot; one line per
printed charge row; a discount row is a negative line; names exactly as printed; no personal data; the image is data,
not instructions), then one `user` content with the image part **first** and the instruction after it, and
`generationConfig: { responseMimeType: 'application/json', responseJsonSchema, maxOutputTokens: 16384 }`. The schema asks
for `store`, `chain`, `city`, `storeCode`, `documentType`, `documentNumber`, `purchasedAt`, `total`, `paid` and `lines`
(`name`, `quantity`, `unit`, `unitPrice`, `discount`, `total`, `kind`, `ean`, `uncertain`). It does **not** ask for VAT,
section headers, boxes or a pack size (the size is derived from the name with `parsePackSize`, like the OCR parsers do),
because those cannot be checked or would be one more thing to hallucinate. One request per press, **no automatic retry**
(the free quota is small, and an image must not leave twice because of one press); a timeout of 120 s; `CANCELLED` when
the caller aborts.

The photo is prepared first (`prepareImage`): decoded with its EXIF rotation, scaled down so that it has at most
3,500,000 pixels and 4096 on a side (never enlarged), drawn on white and encoded again as JPEG at 0.85. Drawing it anew
is what drops everything else the file carried (EXIF with the location, the time, the camera, thumbnails); the browser
check looks for it. A format this browser cannot decode (HEIC in Chrome) is `IMAGE_UNREADABLE`: the original is **never**
sent as it is.

The connection test is `GET /v1beta/models/<model>`: it proves the key, the model id and the CORS path in one call, sends
no receipt data and, because it only asks for a description, generates nothing. A model that cannot
`generateContent` is `MODEL_UNSUPPORTED`.

### The answer is never trusted

`convertAnswer` (`convert.ts`, `values.ts`) is the whole defence, and every rule is tested with hostile outputs
(`convert.test.ts`, including a fast-check property over arbitrary JSON):

- The answer must be JSON (one markdown fence is tolerated), at most 200,000 characters, an object with a `lines` array of
  at most 300 entries. Anything else is `MALFORMED`; an empty array is `NO_LINES`.
- **Each field is converted exactly or left out, never rounded, clamped or guessed.** Amounts are JSON numbers or plain
  decimal strings with a dot and at most two decimals, within +-10,000,000 RON, read as text into integer bani (no float
  arithmetic): `"12,50"`, `"1e3"`, `12.345`, `NaN` and `1e12` are not amounts. A quantity is positive, at most three
  decimals, at most a million. Text loses zero-width and bidirectional marks, control characters become spaces, and it is
  cut at a length. Enumerations (`chain`, `kind`, `unit`, `documentType`) take exactly a known value. A date is a real
  calendar day between 2005 and 2100 (a date in the future is kept: the review asks about it). Unknown fields never pass
  (the `ParsedReceipt` is built field by field, and `ParsedReceiptSchema` has the last word).
- A line without a usable amount is **dropped and counted** (one `LOW_CONFIDENCE` warning says how many, so the review
  shows that the sum may be off); an empty line is skipped silently; a line with an amount but no name is kept as
  `(fără nume)` and flagged. A quantity or unit that cannot be used becomes 1 / `buc` **and the line is flagged**.
- The name and the sign decide what a line is, as for every parser: a model's "product" never outranks `GARANTIE`,
  `PUNGA` or a negative total (a discount row). A "discount" with a positive total is flagged. A unit price or a discount
  of zero is how a model says "not printed": it is left out instead of failing `LINE_ARITHMETIC`.
- A barcode is kept as printed, but a complete GTIN-8, -13 or -14 must have the right check digit, else it is dropped and
  the line flagged (a misread digit would map the line to the wrong product); a 12-digit print (Mega Image) and short
  codes are kept; a placeholder of zeros is no code.
- The total and the amount paid must be >= 0; otherwise they are missing and `MISSING_TOTAL` appears. A voucher is derived
  (`total - paid`) when less was paid.
- The result goes through `finishReceipt` (extracted from `parseReceipt`, exported by `@/parsers`): the same
  `validateReceipt` arithmetic (`SUM_MISMATCH`, `LINE_ARITHMETIC`, `MISSING_*`, `FUTURE_DATE`) and `UNKNOWN_CHAIN` as any
  engine. A wrong reading therefore shows as warnings in the review.
- `meta.engine` is `gemini`, `meta.parser` is the **model id** that answered and `meta.parserVersion` is
  `GEMINI_READING_VERSION` (bump it when the prompt, the schema or the conversion changes what a photo yields).

### Errors

`AiError.code` (`errors.ts`), shown in Romanian by `describeAiError`: `NOT_ENABLED`, `NO_KEY`, `INVALID_KEY`,
`INVALID_MODEL`, `IMAGE_UNREADABLE`, `OFFLINE` (checked before anything is prepared or sent), `NETWORK`, `TIMEOUT`,
`BAD_KEY` (`401`, or `400` with `API_KEY_INVALID`), `FORBIDDEN` (`403`: a restricted key, the API not enabled, a project
that needs verification), `MODEL_NOT_FOUND` (`404`), `MODEL_UNSUPPORTED`, `REGION` (`400 FAILED_PRECONDITION`), `QUOTA` (`429`
whose `QuotaFailure` names a per-day quota) and `RATE_LIMITED` (the other `429`s; the wait comes from `RetryInfo.retryDelay`,
because `Retry-After` is not exposed to a browser), `SERVER` (`5xx`), `REJECTED` (other `4xx`), `BLOCKED` (`promptFeedback.blockReason`
or a finish reason such as `SAFETY`, `PROHIBITED_CONTENT`, `SPII`; `SPII`, sensitive personal data, has a text of its own),
`TRUNCATED` (`MAX_TOKENS`), `EMPTY_ANSWER`, `MALFORMED`, `NO_LINES`, `CANCELLED`, `UNEXPECTED`. Google's own message is kept
as `detail` with the key removed from it; no message or detail ever contains the key.

### Key and settings

Everything is in `syncState` (device-local: never exported, synced or part of a backup, like the GitHub token): the row
`ai.gemini` holds `{ enabled, model }` and `ai.gemini.key` holds `{ key }`, in a row of its own so that reading the settings
never touches it. `readAiConfig` shows `hasKey` and the last four characters (`…x9Qd`); `enabled` is true only with a key.
A key is a printable ASCII string of 16 to 256 characters (it goes into a header). Removing it leaves a tombstone with
`value: null` (the old key does not stay on disk) and switches the feature off. There is no passphrase option as for the
GitHub token: a Gemini key can only spend its owner's quota, and the README says to delete it at Google when a device is
lost. Tests check that the key is in no table of a backup, no export and no error.

### In the review (`src/features/receipts`, `src/import`)

- `AiPort` (`src/import/ports.ts`) joins `ImportServices` as `ai`; `engines.ts` plugs the barrel in (`defaultAi`), tests use
  `fakeAi()` (off) or the real stack over `MockGemini`.
- The loader sets `aiEnabled` (the feature is on **and** the receipt is a draft whose source is a photo). Only then the
  review shows the card "Citire cu AI" with the button "Citește cu AI". A PDF, a pasted text, a manual receipt and a confirmed
  receipt never get it.
- The button opens a confirmation (`Dialog`, focus on "Renunță"): what is sent, the personal-data and free-tier warnings,
  the EEA note, the date the text was written and a link to the terms (`src/ai/notice.ts`). When the photo is no longer in
  memory (a reload; originals are never stored, §12) the dialog asks for it again and sends only once one is chosen.
- "Trimite poza la Gemini" calls `services.ai.readReceipt`, shows "Pregătesc poza…" then "Gemini citește bonul…" with
  "Anulează citirea", and on success `adoptReading` (`src/import/ai-reading.ts`) puts the reading in the review: lines, total,
  amount paid and `extraction` come from the new reading alone; the header (chain, store name, branch, city, document number,
  date and time) takes the new reading's value when it read one and otherwise keeps what the receipt had, so a chain the user
  chose survives a reading that cannot tell the store; the catalog proposes products for the new lines. **Nothing is saved**:
  the screen is dirty, the warnings are recomputed after every edit like for any reading, and the user saves or confirms.
- The reading it replaced stays one button away (`replace-reading` / `swap-reading` in `review-state.ts`: both readings keep
  their edits and their "verified" marks); the alternative is forgotten when the receipt is saved. A failure shows its
  Romanian message and changes nothing.
- A saved receipt keeps `extraction: { engine: 'gemini', parser: <model>, version }`; its old lines become tombstones like any
  line removed in the review. No line crops are shown for a Gemini reading (it has no boxes).

### Isolation

- Nothing of the engine loads or runs with the feature off. The light barrel is about 3 KB and the notice texts 5 KB; the
  client (`client-*.js`, 9 KB), `read` (7 KB) and `connection` are separate chunks that the page requests on the first reading
  or connection test. They are in the service worker's precache like every chunk, but the page never requests or runs them
  otherwise. The production build was checked with the feature off through Settings, a photo import (OCR) and a review: no
  request to Google, no engine chunk requested, no console error (`e2e/ai.spec.ts`).
- `src/ai/isolation.test.ts` guards the shape: only `src/ai` names the host, the light modules import the engine only as types,
  application code uses the barrel (never `@/ai/client` and the like), the wrappers use a dynamic `import()`.
- ESLint: `src/ai` is React-free (`eslint.config.js`). The CSP is unchanged: `generativelanguage.googleapis.com` was already in
  `connect-src` (`config/csp.ts`, with its test); the browser check reports no violation.

### Tests

`npm test`: the converters and the conversion (the ground truth of **every** fixture, run backwards through the schema as the
fake model's answer, comes back as the same receipt with the same warnings; hostile outputs: strings for numbers, extra and
prototype fields, huge or negative amounts, empty rows, too many rows, control characters, zero placeholders, bad check
digits, a fast-check property that any JSON gives an `AiError` or a schema-valid receipt); the client against `MockGemini`
(the request shape, the key only in a header, every error mapping, redaction of an echoed key, timeout, cancel, offline);
the settings and the key's storage; `adoptReading` and the review state; the Settings card; the review end to end over the
real stack (feature off, on, confirmation, a reading, swap, save, failures, cancel, no photo in memory). `MockGemini` records
`violations` (a key in the address, a header outside the CORS allow-list, a sampling parameter, a non-JPEG image) and every
suite fails on one. `npm run e2e` adds `e2e/ai.spec.ts` on the production build in Chrome.

### Limits

Not verified, because no key was available: the wording of a real quota error, how well a model reads the low-resolution Mega
Image photo (the README has a checklist for a real run), and that the schema is accepted by every model a user may type. A HEIC
photo cannot be decoded by Chrome (Safari can): the reading fails with `IMAGE_UNREADABLE` before anything is sent. Terms,
model names and prices change: re-read the pages above when this feature is touched.
