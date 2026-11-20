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
| `src/catalog/`               | product matching (alias -> EAN -> fuzzy -> new), categories          | `catalog-matching`                    |
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

## 4. Build, PWA and CSP

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

## 5. Testing conventions

- Vitest, **colocated** `*.test.ts(x)` next to the code; cross-cutting tests and fixtures under `tests/`.
- Default environment is `node`. DOM tests start with `// @vitest-environment jsdom` and call `cleanup` in
  `afterEach`. Prefer real code over mocks; build tooling is tested with real Vite builds (`config/csp.test.ts`).
- Anything time-dependent takes an injectable `now` (the Lidl sample is dated in the future).
- Run one file: `npx vitest run src/app/registry.test.ts`.

## 6. Commands

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

## 7. Dependency notes

- TypeScript is pinned to `~6.0` because `typescript-eslint` supports `<6.1`; move to TS 7 when it does.
- `overrides.workbox-build.glob` pins a patched `glob` (advisory in `workbox-build`'s dependency). Remove it when
  `workbox-build` updates. Do **not** run `npm audit fix --force`: it downgrades `workbox-build`.
- Node `^22.22 || ^24 || >=26` (React Router 8); CI and `.nvmrc` use Node 26.
- TypeScript flags worth knowing: `noUncheckedIndexedAccess` (index results are `T | undefined`),
  `verbatimModuleSyntax` (use `import type`), `erasableSyntaxOnly` (no enums, namespaces or parameter properties).
