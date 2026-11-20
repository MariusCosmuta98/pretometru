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

## Sincronizare și backup cu GitHub (opțional)

Datele rămân în browserul tău. Ca să le ai pe mai multe dispozitive și să nu le pierzi dacă browserul își șterge datele,
aplicația le poate sincroniza într-un **depozit GitHub privat al tău**: fiecare sincronizare este un commit, iar
istoricul Git este backup-ul. Nu ai nevoie de nimic în afară de contul GitHub gratuit.

### Configurare (o singură dată)

1. Pe GitHub creează un depozit **privat** numit `pretometru-data` (<https://github.com/new>): alege *Private* și
   bifează *Add a README file*.
2. Creează un token *fine-grained* (<https://github.com/settings/personal-access-tokens/new>):
   - *Repository access* → *Only select repositories* → doar `pretometru-data`;
   - *Repository permissions* → *Contents* → **Read and write** (restul rămân pe *No access*; *Metadata: Read-only*
     apare singur);
   - alege o dată de expirare: după ea creezi alt token și îl schimbi din aplicație (*Schimbă tokenul*).
3. În aplicație: **Setări → Sincronizare GitHub**. Lipește tokenul, apasă *Verifică conexiunea*, apoi *Conectează…*.
   Poți proteja tokenul cu o parolă, care se cere la fiecare pornire a aplicației.
4. Pe celelalte dispozitive repetă pasul 3 cu **același depozit** (ideal, cu un token separat pentru fiecare dispozitiv).
   La prima sincronizare datele se îmbină: pentru fiecare înregistrare rămâne varianta modificată ultima, iar nimic nu
   se șterge decât dacă a fost șters explicit.

Sincronizarea pornește singură (la deschiderea aplicației, când te întorci în ea, când ești din nou online și la câteva
secunde după ce modifici date); o poți opri sau poți apăsa oricând *Sincronizează acum*.

### Ce e bine să știi

- Aplicația **refuză** un depozit public: bonurile tale nu ajung niciodată într-un depozit public.
- Tokenul este păstrat doar în acest browser (IndexedDB), niciodată în exporturi, în backup-uri sau în depozit. Dacă
  l-ai pierdut sau crezi că l-a văzut altcineva, revocă-l pe GitHub și creează altul.
- Aplicația se conectează doar la `api.github.com`.
- *Deconectează* scoate tokenul de pe dispozitiv; datele rămân și local, și în GitHub.
- Nu edita manual fișierele din `data/`. Dacă un fișier devine ilizibil, aplicația nu modifică nimic și îți spune care
  este.
- Detalii tehnice (structura depozitului, algoritmul, erorile): [`docs/architecture.md`](docs/architecture.md) §13.

### Cum verifici manual o sincronizare reală

Testele automate rulează împotriva unui GitHub simulat în memorie (`npm test`, iar `npm run e2e` rulează build-ul de
producție într-un Chrome real, tot cu GitHub simulat); autorii nu au folosit niciun token sau depozit real. Înainte să
te bazezi pe sincronizare, parcurge:

1. **Conectare**: cele cinci verificări apar cu ✓, iar aplicația spune că depozitul „nu conține încă date Pretometru”.
2. **Prima sincronizare**: pe GitHub apare commitul „Prima sincronizare Pretometru (dispozitiv …)” cu fișierele din
   `data/` (`pretometru.json`, `settings.json`, `categories/`, …). Deschide un fișier din `data/stores/`: o înregistrare
   pe linie, doar ce ai introdus tu.
3. **Al doilea dispozitiv** (sau alt profil de browser): conectează-l la același depozit. Aplicația spune că depozitul
   „conține deja date”, iar după *Conectează și îmbină datele* vezi aceleași bonuri.
4. **Modificări**: schimbă numele unui produs pe un dispozitiv, sincronizează, apoi sincronizează pe celălalt. Șterge
   un bon și verifică să dispară și pe celălalt. Un *Sincronizează acum* fără modificări nu face niciun commit.
5. **Rețea și CORS**: în DevTools → Network, toate cererile merg la `api.github.com` și răspund fără erori CORS (mai ales
   `POST`, `PATCH` și `PUT` cu antetul `Authorization`).
6. **Cazuri de eroare**:
   - fă depozitul public pentru un moment: aplicația refuză („Depozitul este public”) și nu apare niciun commit nou;
   - revocă tokenul: „GitHub nu acceptă tokenul”, iar sincronizarea automată se oprește până la o sincronizare manuală
     reușită;
   - un token cu *Contents: Read-only*: „Tokenul nu are voie să scrie în depozit”;
   - mod avion: „Nu ești conectat la internet”;
   - un depozit complet gol (fără README): aplicația adaugă singură un README;
   - sincronizează în același timp de pe două dispozitive: amândouă ajung la aceleași date (un push respins se reia
     singur).
7. Dacă ceva nu merge, notează mesajul și codul erorii (de exemplu `REMOTE_INVALID`).

## Copie de siguranță într-un fișier, categorii și magazine

Independent de sincronizare, **Setări → Copie de siguranță** salvează tot ce ai în aplicație (bonuri, produse,
categorii, magazine, liste și setările comune) într-un fișier `pretometru-AAAA-LL-ZZ.pretometru-backup.json` și îl poate
încărca la loc, de exemplu după ce schimbi telefonul sau browserul îți șterge datele.

- **Exportă datele** descarcă fișierul. Se face pe dispozitiv, fără internet. Fișierul conține istoricul cumpărăturilor
  tale: păstrează-l într-un loc sigur și nu-l pune într-un depozit public. Aplicația îți arată data ultimei exportări, fără
  să insiste. Tokenul GitHub, cheia Gemini și alte valori ale dispozitivului nu intră niciodată în fișier.
- **Importă din fișier** îți arată mai întâi ce conține (versiunea formatului, data exportului, câte înregistrări) și abia
  apoi importă. *Îmbină* (implicit) păstrează ce ai și adaugă ce lipsește; la același element rămâne varianta modificată mai
  recent. *Înlocuiește tot* șterge datele de pe dispozitiv și le pune pe cele din fișier, după o întrebare clară (poți
  descărca întâi o copie a datelor de acum). Un fișier făcut de o versiune mai nouă a aplicației este refuzat. Cu
  sincronizarea GitHub pornită, la următoarea sincronizare pot reapărea date din depozit.
- **Setări → Categorii**: adaugi, redenumești, colorezi, alegi emoji-ul și ordonezi categoriile; la ștergere alegi în ce
  categorie se mută produsele. „Non-produs” nu se poate redenumi sau șterge.
- **Setări → Magazine**: redenumești, unești două magazine care sunt de fapt același (bonurile trec la cel păstrat) și
  ștergi un magazin fără bonuri.

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
| `npm run check:leaks`  | caută date personale și chei în fișierele urmărite de git (rulează și la fiecare commit) |
| `npm run e2e`          | build + teste Playwright în Chromium mobil pe `dist/` (offline, distribuire, actualizare); nu face parte din `check`; prima dată: `npx playwright install chromium` |
| `npm run check`        | `check:leaks` + `lint` + `typecheck` + `test` + `build`, exact ce rulează CI |

## Publicare

La fiecare push pe `main`, GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) rulează verificările și, dacă totul
e verde, publică `dist/` pe GitHub Pages. Fluxul de lucru este trunk-based: branch, rebase pe `origin/main`,
`npm run check`, apoi `git push origin HEAD:main`.

## Confidențialitate

Repo-ul este public: nu se comit bonuri reale, nume, adrese, numere de client, carduri sau chei. Bonurile originale
rămân în afara repo-ului, în `~/.pretometru-private/samples/`. Fixture-urile din `tests/fixtures/` sunt sanitizate
(vezi [`tests/fixtures/README.md`](tests/fixtures/README.md)), iar un hook `pre-commit` (instalat de `npm install`)
și CI-ul rulează `npm run check:leaks` ca să oprească scurgerile.
