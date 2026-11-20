# Pretometru

Citește bonurile și facturile de la furnizori (Kaufland, METRO, Mega Image, Lidl, …), extrage produsele și prețurile,
le grupează pe categorii și îți arată unde ai cumpărat mai ieftin, cum evoluează prețurile în timp și ce ai de pus
pe lista de cumpărături.

- Aplicație web statică (PWA) pe GitHub Pages — fără server, fără costuri.
- Datele tale rămân în browser; sincronizarea între dispozitive este opțională, printr-un repo GitHub **privat** al tău.
- Acest repo este public și **nu conține bonuri reale** sau date personale.

Planul și deciziile: [`docs/plan.md`](docs/plan.md) · Contracte de date: [`docs/contracts.md`](docs/contracts.md) ·
Arhitectură și structura codului: [`docs/architecture.md`](docs/architecture.md)

Aplicația este live la <https://mariuscosmuta98.github.io/pretometru/>.

> Stadiu: în construcție (faza A, fundația). Ecranele sunt deocamdată substituenți.

## Rulare locală

Cerințe: Node.js `^22.22`, `^24` sau `>=26` (versiunea folosită în CI este în [`.nvmrc`](.nvmrc)) și npm.

```bash
npm ci          # instalează dependențele din package-lock.json
npm run dev     # http://localhost:5173/pretometru/
```

Aplicația se servește sub `/pretometru/` (la fel ca pe GitHub Pages). Dacă redenumești depozitul, pornește cu
`BASE_PATH=/noul-nume/`.

## Comenzi

| Comandă                | Ce face                                                           |
| ---------------------- | ----------------------------------------------------------------- |
| `npm run dev`          | server de dezvoltare cu reîncărcare la modificări                 |
| `npm run lint`         | ESLint + verificare de formatare Prettier                         |
| `npm run format`       | formatează codul cu Prettier                                      |
| `npm run typecheck`    | verificare TypeScript                                             |
| `npm test`             | teste Vitest (o singură rulare); `npm run test:watch` pentru watch |
| `npm run build`        | build de producție în `dist/` (include PWA și CSP)                |
| `npm run preview`      | servește build-ul la <http://localhost:4173/pretometru/>          |
| `npm run check`        | `lint` + `typecheck` + `test` + `build`, exact ce rulează CI      |

## Publicare

La fiecare push pe `main`, GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) rulează verificările și, dacă totul
e verde, publică `dist/` pe GitHub Pages. Fluxul de lucru este trunk-based: branch, rebase pe `origin/main`,
`npm run check`, apoi `git push origin HEAD:main`.

## Confidențialitate

Repo-ul este public: nu se comit bonuri reale, nume, adrese, numere de client, carduri sau chei. Bonurile originale
rămân în afara repo-ului, în `~/.pretometru-private/samples/`.
