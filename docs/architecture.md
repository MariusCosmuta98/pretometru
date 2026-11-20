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
| Logic      | `catalog`, `analytics`, `import`, `sync`, `ai`, `ocr` | domain, storage, each other (no cycles) | features, app, ui (keep them React-free)        |
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
| `src/parsers/`               | per-store parsers, detection, validations (pure)                     | `parsers-pdf-text`, `parsers-ocr-text` |
| `src/ocr/`                   | Tesseract worker, canvas preprocessing, crops, "paste text"          | `ocr-pipeline`                        |
| `src/import/`                | file -> engine -> parser -> `ParsedReceipt` -> storage orchestration | `import-review-ui`                    |
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
| `scripts/`                   | Node scripts (fixture sanitizer, leak check)                         | `sample-fixtures`                     |
| `tests/`                     | cross-cutting tests and `tests/fixtures/**`                          | shared                                |
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
| `searchProducts(db, query, limit = 20)`           | type-ahead by name, brand or EAN prefix (diacritics, case and punctuation never matter)       |
| `createProduct(db, input)`                        | new product; refuses an empty name, an unknown category and the system Non-produs category    |
| `rememberMappings(db, chain, choices)`            | upserts one alias per chain + normalised name (with EAN and `defaultPack`); all or nothing    |
| `categoryForHint(header)`                         | seed category for a printed section header ("Mopro/Brânză/Ouă" -> Lactate & ouă) or `undefined` |

How a line is matched, in this order (`via` names the first step that applied):

1. **alias**: the newest live alias of `(receipt.chain, normalizeName(rawName))`, else one without a chain. An alias of
   another chain is deliberately not used: the same printed name can be a different product elsewhere.
2. **ean**: the product, or the alias rows, that carry the code (UPC-A and EAN-13 spellings compare equal). Assigned only
   when the code has at least 8 digits (shorter ones are truncated prints) and exactly one product claims it;
   otherwise the products only become candidates.
3. **fuzzy**: likely products in `candidates`, best first, `score` 0..1 (higher is better). Never assigned. (Until the
   fuzzy matcher lands, only an ambiguous or truncated EAN produces candidates.)
4. **category-hint**: the line's `storeCategoryHint` mapped onto a live seed category (`categoryId`, no product).
5. **none**.

Only `alias` and `ean` set `productId` (with the product's `categoryId`; the product is also `candidates[0]`, score 1):
a wrong silent merge is worse than a missing one. `pack` is set only when an alias remembers a size that the printed
name lacks and the line is sold by the piece; a size printed on the receipt always wins. Non-product lines get the
Non-produs category and are never matched.

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

## 8. Commands

| Command                                            | What it does                                          |
| -------------------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                                      | dev server, <http://localhost:5173/pretometru/>       |
| `npm run lint`                                     | ESLint (type-aware) + `prettier --check`              |
| `npm run format`                                   | Prettier write (Markdown and `public/` are ignored)   |
| `npm run typecheck`                                | `tsc -b` (app + node projects)                        |
| `npm test`                                         | Vitest, single run                                    |
| `npm run build` / `npm run preview`                | production build / serve it at <http://localhost:4173/pretometru/> |
| `npm run check`                                    | lint + typecheck + test + build (the pre-push gate)   |

Git flow (trunk-based): branch, `git fetch && git rebase origin/main`, `npm run check`, `git push origin HEAD:main`.
CI (`.github/workflows/ci.yml`) runs the same four steps and, on `main`, deploys `dist/` to GitHub Pages.

## 9. Dependency notes

- TypeScript is pinned to `~6.0` because `typescript-eslint` supports `<6.1`; move to TS 7 when it does.
- `overrides.workbox-build.glob` pins a patched `glob` (advisory in `workbox-build`'s dependency). Remove it when
  `workbox-build` updates. Do **not** run `npm audit fix --force`: it downgrades `workbox-build`.
- Node `^22.22 || ^24 || >=26` (React Router 8); CI and `.nvmrc` use Node 26.
- TypeScript flags worth knowing: `noUncheckedIndexedAccess` (index results are `T | undefined`),
  `verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no enums, namespaces or parameter properties).
