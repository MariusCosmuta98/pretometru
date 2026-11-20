# Pretometru

Citește bonurile și facturile de la furnizori (Kaufland, METRO, Mega Image, Lidl, …), extrage produsele și prețurile,
le grupează pe categorii și îți arată unde ai cumpărat mai ieftin, cum evoluează prețurile în timp și ce ai de pus
pe lista de cumpărături.

- Aplicație web statică (PWA) pe GitHub Pages — fără server, fără costuri.
- Datele tale rămân în browser. Două funcții opționale, oprite până le pornești tu, pot trimite date în afară:
  sincronizarea între dispozitive, printr-un repo GitHub **privat** al tău, și citirea cu AI (Gemini).
- Acest repo este public și **nu conține bonuri reale** sau date personale.

Planul și deciziile: [`docs/plan.md`](docs/plan.md) · Contracte de date: [`docs/contracts.md`](docs/contracts.md) ·
Arhitectură și structura codului: [`docs/architecture.md`](docs/architecture.md)

Aplicația este live la <https://mariuscosmuta98.github.io/pretometru/>.

> Stadiu: versiunea 1 este implementată (import de bonuri din PDF, poză, text lipit sau manual, verificare înainte de
> salvare, produse și prețuri, liste de cumpărături, statistici, funcționare offline, copie de siguranță; sincronizarea
> GitHub și citirea cu Gemini sunt opționale). Formate de bon recunoscute: Kaufland și METRO (PDF), Lidl (captură de
> ecran) și Mega Image (poză); alte magazine nu au încă parser dedicat. Testele automate (Vitest și Playwright, într-un
> Chromium mobil emulat) folosesc GitHub și Gemini simulate: nu acoperă dispozitive reale, un token GitHub real sau o
> cheie Gemini reală (vezi secțiunile „Cum verifici manual” de mai jos).

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
- Sincronizarea se conectează doar la `api.github.com` (citirea opțională cu Gemini, descrisă mai jos, folosește alt
  serviciu).
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
5. **Rețea și CORS**: în DevTools → Network, cererile făcute de sincronizare merg doar la `api.github.com` și răspund
   fără erori CORS (mai ales `POST`, `PATCH` și `PUT` cu antetul `Authorization`).
6. **Cazuri de eroare**: doar cu un depozit și un token **de test**, într-un profil de browser nou, fără bonurile tale
   (niciodată cu `pretometru-data`):
   - depozit public: **nu** face public depozitul cu datele tale, nici „pentru un moment” (istoricul Git ar deveni
     vizibil oricui încă dinainte ca aplicația să refuze). Refuzul („Depozitul este public”, fără niciun commit nou) îl
     verifică deja testele automate cu GitHub simulat, inclusiv pentru un depozit devenit public după conectare; dacă
     vrei să-l vezi și pe GitHub real, folosește în profilul de test un depozit public gol, creat doar pentru asta;
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

## Citire cu AI — Gemini (opțional)

Pentru pozele greu de citit (de exemplu bonul Mega Image făcut cu telefonul) aplicația poate cere ajutorul lui **Gemini**
(Google), cu **cheia ta personală**. Este **oprită implicit**, iar poza pleacă de pe dispozitiv doar când apeși
*Citește cu AI* pe un bon și confirmi. Importul din PDF, din poză (OCR) și din text lipit nu se schimbă și nu trimite nimic.

### Configurare (o singură dată)

1. În [Google AI Studio](https://aistudio.google.com/apikey) creează o cheie API **doar pentru această aplicație**.
2. În aplicație: **Setări → Gemini (opțional)**. Lipește cheia, apasă *Salvează cheia*, apoi *Testează conexiunea* (cere doar
   descrierea modelului: nu trimite niciun bon).
3. Pornește *Pornește citirea cu AI (Gemini)*. De acum, ecranul de verificare al unui bon importat din poză (o ciornă) are
   butonul *Citește cu AI*.
4. Apasă-l: o fereastră îți spune exact ce se trimite și cere confirmarea; abia după *Trimite poza la Gemini* pleacă poza.
   Citirea ia locul celei de pe ecran ca orice altă modificare (nu se salvează până nu salvezi), este verificată din nou
   (suma liniilor față de total, calculul pe linie, data), iar citirea anterioară rămâne la un buton distanță
   (*Arată citirea anterioară*).

### Ce e bine să știi

- **Date personale**: pe poza unui bon pot apărea numărul cardului sau al cardului de fidelitate, numele sau adresa ta; pleacă
  odată cu poza. Poza este micșorată (cel mult 3,5 megapixeli) și refăcută ca JPEG, deci nu pleacă datele ascunse din fișier
  (locația, ora, aparatul).
- **Nivelul gratuit** (termenii Gemini API, citiți la 20.11.2026): Google poate folosi poza și răspunsul ca să-și îmbunătățească
  produsele, iar oameni din echipa Google le pot citi; cu facturare activată nu. În Spațiul Economic European, Elveția și
  Regatul Unit, termenii spun că se aplică regulile serviciilor plătite, dar și că acolo aplicațiile puse la dispoziția
  utilizatorilor pot folosi doar servicii plătite. Termenii descriu Gemini API ca instrument pentru dezvoltatori, în scop
  profesional, nu de consum: cheia și respectarea termenilor sunt responsabilitatea ta. Citește-i: <https://ai.google.dev/gemini-api/terms>.
- Cheia este păstrată doar în acest browser (IndexedDB), niciodată în exporturi, în backup-uri sau în depozitul de
  sincronizare, și pleacă doar în antetul `x-goog-api-key`, niciodată într-o adresă. *Șterge cheia* o scoate de pe
  dispozitiv; dacă pierzi dispozitivul, șterge-o și din Google AI Studio.
- Aplicația se conectează la `generativelanguage.googleapis.com` doar când apeși *Testează conexiunea* sau *Trimite poza la
  Gemini*. Cu citirea cu AI oprită nu se face nicio cerere către Google și nici nu se încarcă codul ei.
- Modelul implicit este `gemini-3.5-flash-lite` (stabil, cu nivel gratuit, verificat la 20.11.2026). Numele modelelor se
  schimbă: dacă primești „Modelul ales nu există”, schimbă-l din *Setări avansate*. Pentru poze greu de citit poți încerca
  `gemini-3.6-flash`.
- Fiecare citire este **o singură cerere**, fără reîncercări automate. Cota gratuită are limite pe minut și pe zi.
- Un AI poate greși: verifică produsele și sumele cu poza înainte să confirmi. Avertismentele apar ca la orice citire.
- Detalii tehnice (cererea, validarea răspunsului, erorile): [`docs/architecture.md`](docs/architecture.md) §16.

### Cum verifici manual o citire reală

Testele automate rulează împotriva unui Gemini simulat în memorie (`npm test`, iar `npm run e2e` rulează build-ul de producție
într-un Chrome real, tot cu Gemini simulat); autorii nu au avut o cheie și nu au apelat serviciul real. Înainte să te bazezi
pe citirea cu AI, parcurge:

1. **Cheie și test**: *Testează conexiunea* spune „Conexiunea funcționează: modelul … este disponibil”. Cu o cheie greșită:
   „Google nu acceptă cheia API”.
2. **Cu funcția oprită**: în DevTools → Network nu apare nicio cerere către `googleapis.com` când deschizi Setările, imporți o
   poză sau deschizi un bon.
3. **O poză reală** (de exemplu bonul Mega Image): importă-o, apasă *Citește cu AI* și confirmă. În Network: un singur `POST`
   la `…/v1beta/models/<model>:generateContent`, fără `key=` în adresă, cu antetul `x-goog-api-key` și un răspuns `200`
   (fără erori CORS); corpul conține o imagine JPEG de cel mult ~3,5 megapixeli.
4. **Rezultatul**: compară preț cu preț cu poza. Dacă suma liniilor nu se potrivește cu totalul, apare *Suma nu se
   potrivește*; *Arată citirea anterioară* aduce înapoi citirea OCR. Încearcă și `gemini-3.6-flash`.
5. **Cazuri de eroare**: cheie ștearsă la Google („Google nu acceptă cheia API”), un nume de model inventat („Modelul ales nu
   există”), mod avion („Nu ești conectat la internet”; nu se trimite nimic), cota epuizată (mesajul despre cota zilnică sau
   despre prea multe cereri), o poză care nu e un bon („Gemini nu a găsit nicio linie de produs”).
6. **Date**: după *Salvează ciorna*, bonul păstrează liniile de la Gemini. În *Setări → Copie de siguranță* exportă datele și
   caută în fișier: cheia nu apare nicăieri.
7. Dacă ceva nu merge, notează mesajul și codul erorii (de exemplu `BAD_KEY`, `RATE_LIMITED`).

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
| `npm run e2e`          | build + teste Playwright în Chromium mobil pe `dist/`; prima dată: `npx playwright install chromium` |
| `npm run check`        | `check:leaks` + `lint` + `typecheck` + `test` + `build`; CI verifică apoi același `dist/` cu Playwright înainte de publicare |

## Publicare

La fiecare push pe `main`, GitHub Actions ([`ci.yml`](.github/workflows/ci.yml)) rulează verificările și, dacă totul
e verde, publică `dist/` pe GitHub Pages. Fluxul de lucru este trunk-based: branch, rebase pe `origin/main`,
`npm run check`, apoi `git push origin HEAD:main`.

## Confidențialitate

Repo-ul este public: nu se comit bonuri reale, nume, adrese, numere de client, carduri sau chei. Bonurile originale
rămân în afara repo-ului, în `~/.pretometru-private/samples/`. Fixture-urile din `tests/fixtures/` sunt sanitizate
(vezi [`tests/fixtures/README.md`](tests/fixtures/README.md)), iar un hook `pre-commit` (instalat de `npm install`)
și CI-ul rulează `npm run check:leaks` ca să oprească scurgerile.
