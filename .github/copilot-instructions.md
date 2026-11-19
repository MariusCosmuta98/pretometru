# Pretometru — instructions for coding agents

Receipt-to-price-tracker PWA hosted on GitHub Pages. Read `docs/plan.md` (product and decisions) and
`docs/contracts.md` (data contracts) before coding; `docs/architecture.md` (when present) defines module ownership.

- **Language**: code, identifiers, comments and commit messages in English; user-facing UI strings in Romanian.
- **Money**: integer bani (RON x 100), VAT-inclusive unless a field says otherwise. Never floats.
- **Public repo, no personal data**: never commit real receipts, buyer name/address/client numbers, card or loyalty
  numbers, tokens or API keys. Originals live outside the repo in `~/.pretometru-private/samples/`.
  Fixtures in the repo must be sanitized.
- **Cost stays 0**: static site on GitHub Pages, no backend, no paid service, no CDN/analytics/fonts fetched at runtime.
- **Git flow (trunk-based)**: branch -> rebase on `origin/main` -> `npm run lint && npm run typecheck && npm test && npm run build`
  -> `git push origin HEAD:main`. Keep CI green; fix forward if it breaks. The repo-local git identity is the GitHub
  noreply address; do not change it.
- **Boundaries**: edit only the area you were assigned. Shared files (`package.json`, Vite/TS config, CI) get minimal
  edits; rebase often to avoid conflicts. Contract changes update `docs/contracts.md`, the zod schemas and fixtures together.
- **Tests**: add focused Vitest tests for new logic (pure code first); no tests that only restate implementation.
