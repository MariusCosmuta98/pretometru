# Pretometru — plan de implementare

> Nume de lucru: **Pretometru** · repo `MariusCosmuta98/pretometru` · URL `https://mariuscosmuta98.github.io/pretometru/` (redenumibil).

## 1. Obiectiv
Aplicație care citește bonurile/facturile de la furnizori (Kaufland, METRO, Mega Image, Lidl, …), extrage produsele și prețul plătit, le organizează pe categorii, compară același produs între magazine, păstrează istoricul prețurilor și construiește liste de cumpărături cu „unde e mai ieftin”.

## 2. Decizii confirmate și constrângeri
| Subiect | Decizie |
|---|---|
| Hosting | GitHub Pages, **cost 0** ⇒ doar front-end static (PWA), fără server/DB |
| Repo | Cont GitHub **Free** ⇒ Pages cere repo **public**. Cod public; **datele personale nu ajung niciodată în repo** |
| Date | Local-first în browser (IndexedDB) |
| Sync/backup | Repo GitHub **privat** separat (`pretometru-data`) + token fine-grained (Contents: RW, doar acel repo); istoricul Git = backup |
| Extragere | Local: pdf.js + parsere per magazin + Tesseract.js + „lipește text”. **AI opțional**: cheie proprie Gemini (tier gratuit), dezactivat implicit, imaginea pleacă doar la apăsarea butonului |
| UI | Română, mobile-first, instalabilă (PWA), funcționează offline |

## 3. Ce arată cele 4 bonuri (verificat cu teste, nu presupus)
| Sursă | Format | Cum se extrage | Particularități |
|---|---|---|---|
| Kaufland, 07.11.26 | PDF cu text („Receipt copy”) | pdf.js → rânduri → parser (determinist) | Categorii pe bon (Alimente, Băuturi alcoolice, …); linii `qty * preț`; produse la kg (preț/kg = total/greutate, ex. pulpe 22,99/0,920 = 24,99); `GARANTIE AMBALAJ`, `PUNGA BIO`, `Tichet de ambalaje` (−20,00 la plată); TVA A/B/C/D. Σ linii = 208,79 ✓ |
| METRO, 12.08.26 | Factură PDF cu text | pdf.js → parser pe coloane ancorat de la dreapta | Prețuri **fără TVA** + discount pe linie (`2,49-`), **EAN** în prima coloană, `Unit. vanz.` (ex. pachet 8 role). Σ cu TVA = 363,42 vs 363,41 tipărit (rotunjire pe cote) ⇒ toleranță |
| Lidl, `29/12/2026` ⚠ | Screenshot Lidl Plus | Tesseract.js (curat, conf. ≈85) | Perechi de linii `qty BUC x preț` + `nume total TVA`; OCR confundă 0↔8 (prinse de verificări). Σ = 61,67 ✓. **Data e în viitor** (azi 19.11.2026) ⇒ avertisment la review |
| Mega Image, 03.11.26 | Poză low-res cu watermark „COPY” | Tesseract.js **nu ajunge** (prețuri greșite: 17,85/14,93/12,93/19,93 vs real 17,89/14,99/12,99/19,99) | EAN sub fiecare produs; fără nume magazin pe bon (doar un cod de comerciant pe chitanța de card). Necesită review + AI opțional / text lipit |

Teste făcute: pdf.js reconstruiește corect rândurile ambelor PDF-uri; preprocesare (canal verde + prag + upscale 3×) a ridicat OCR-ul Mega de la conf. 21 la 67, dar insuficient; CORS verificat pentru `api.github.com` (PUT + `Authorization`) și `generativelanguage.googleapis.com` ⇒ sync și AI posibile direct din browser.

## 4. Arhitectură
```
Fișier (PDF / foto / screenshot / text lipit / manual)
 → detectare format + magazin
 → motor: pdf.js (text) | Tesseract.js (OCR, preprocesare canvas) | [opțional] Gemini
 → parser per magazin → ParsedReceipt
 → validare + reparare cifre → ecran Review (editabil, crop-uri de linie)
 → mapare produs/categorie → IndexedDB → analiză prețuri → liste → sync GitHub
```
Validări: Σ linii = TOTAL (±0,05); qty×preț = total linie (±0,01); Σ TVA pe cote = tipărit; dată nu în viitor; duplicate (hash fișier + magazin+dată+total+nr. bon); linii non-produs (garanție, pungă, tichet).
Reparare cifre OCR: caută corecții minime pe cifre confundabile (0↔8, 5↔6↔9, 1↔7) care satisfac constrângerile; aplică doar dacă soluția e unică, altfel marchează linia cu crop-ul imaginii.

## 5. Stack (cost 0)
TypeScript · React + Vite · Tailwind · React Router (hash, fără rewrites pe Pages) · Dexie (IndexedDB) + zod · `pdfjs-dist` · `tesseract.js` (WASM + `ron`/`eng` self-hosted) · fuse.js (fuzzy) · Recharts/uPlot · `vite-plugin-pwa` (Workbox) · Vitest · Playwright · ESLint/Prettier · GitHub Actions → Pages. Bani ca întregi (bani), ID-uri ULID.

## 6. Model de date (IndexedDB, pregătit pentru sync: `id` ULID, `updatedAt`, `deletedAt`)
- `stores` {chain, name, branchCode?, city?, address?}
- `receipts` {storeId, purchasedAt, receiptNo?, docType (bon|factură), totalBani, paidBani?, source{kind,fileHash,fileName}, extraction{engine,version,confidence,warnings[]}, status (draft|confirmed)}
- `lines` {receiptId, idx, rawName, ean?, qty, unit (buc|kg|l), lineTotalBani, discountBani, vatRate, kind (produs|garanție|pungă|tichet|reducere|taxă), storeCategoryHint?, productId?, categoryId?, packQty?, packUnit?, unitsPerPack?, paidUnitBani, pricePerBaseBani}
- `products` {name, brand?, categoryId, ean?, baseUnit (kg|l|buc|rolă|m)} — granularitate aleasă de utilizator („Smântână 30%” generic sau un SKU)
- `aliases` {chain?, normName, ean?, productId, defaultPack?} — memoria care face importurile următoare automate (`defaultPack` completează mărimea când numele n-o conține: Lidl/Mega)
- `categories` {name, parentId?, color, icon, order}; `lists` + `listItems`; `settings`; `syncState`
- Categorii seed: Lactate & ouă · Carne & mezeluri · Fructe & legume · Panificație & cereale · Bacanie · Snacks & dulciuri · Băuturi nealcoolice · Băuturi alcoolice · Congelate · Curățenie & menaj · Igienă & cosmetice · Bebe & copii · Casă & bricolaj · Animale · Altele · (sistem) Non-produs. Antetele Kaufland se mapează automat (ex. „Mopro/Brânză/Ouă” → Lactate & ouă).

## 7. Reguli de preț
1. Totul în RON **cu TVA** (METRO: „Valoare totală cu TVA”, nu coloanele fără TVA).
2. `paidUnit = (totalLinie − discount) / qty`; `pricePerBase = paidUnit / mărimea ambalajului` în kg / l / buc / rolă; la kg: total/greutate.
3. Mărimea ambalajului: din nume (`425ML`, `400G`, `8ROLE`, `120BUC`, `8G*4`, `100M`), din `Unit. vanz.` (METRO) sau din `alias.defaultPack`.
4. „Cel mai ieftin” = minim pe magazin în ultimele N zile (implicit 90) după `pricePerBase`, cu data observației; prețurile la reducere sunt marcate și excludibile.
5. Liniile non-produs nu intră în analiză, dar intră în reconcilierea totalului.
6. Produs cumpărat doar dintr-un loc → „doar la X”, fără comparație.
7. Exemple reale pentru acceptanță: hârtie igienică ≈ 1,30 lei/rolă (METRO) · 1,45 (Kaufland) · 2,00 (Mega); șervețele umede 120 buc: 3,98 (METRO, după discount) vs 6,99 (Kaufland).

## 8. Ecrane (mobile-first)
Acasă (cheltuieli lună/categorie, ultimele bonuri, creșteri de preț) · Adaugă bon (fișiere/cameră/lipește text/manual) · Review bon (grilă editabilă, avertismente, crop-uri, mapare) · Bonuri · Produse pe categorii (ultimul preț, magazinul cel mai ieftin, Δ) · Pagină produs (tabel comparativ pe magazine + grafic în timp + istoric) · Liste de cumpărături (cel mai ieftin loc per articol, grupare pe magazin, bifare) · Statistici · Setări (categorii, magazine, sync, cheie Gemini, export/import).

## 9. Faze și todo-uri (ID-urile = tabela `todos`)
**A. Fundație** — `repo-bootstrap` (repo public + clone `/Users/marius/pretometru` + Pages prin Actions) · `scaffold-pwa` (Vite/React/TS/Tailwind, hash router, PWA, CSP, CI lint+typecheck+test+build+deploy) · `domain-storage` (tipuri zod, Dexie+migrări, bani, unități/mărimi, normalizare nume, seed, export/import JSON) · `sample-fixtures` (fixture-uri sanitizate + ground-truth JSON pentru cele 4 bonuri + cazuri sintetice)
**B. Extragere** — `parsers-pdf-text` (Kaufland + METRO + detectare magazin + validări) · `ocr-pipeline` (worker Tesseract, preprocesare canvas, bbox/crop, „lipește text”) · `parsers-ocr-text` (Lidl, Mega, fallback generic, reparare cifre) · `import-review-ui`
**C. Catalog și prețuri (= MVP utilizabil)** — `catalog-matching` (alias → EAN → fuzzy → produs nou; auto-categorii; merge/split) · `price-analytics` (observații, preț/unitate, cel mai ieftin, trenduri, pagină produs)
**D. Liste și offline** — `shopping-lists` · `pwa-offline-share` (cache WASM/traineddata, `storage.persist()`, Web Share Target pe Android, captură cameră)
**E. Sync** — `sync-github` (arbore Git + commit atomic, LWW pe înregistrare + tombstone-uri, onboarding token, teste cu API mock)
**F. Extra** — `ai-gemini-optional` · `insights-dashboard` · `more-stores` (Carrefour, Auchan, Penny, Profi, Selgros… când ai exemple)
**Final** — `qa-hardening`

Acceptanță MVP: (1) Kaufland și METRO se importă fără nicio corecție; Lidl cu ≤2 corecții; Mega cu review (sau Gemini); (2) Σ linii = total la toate 4; (3) exemplele de la §7 apar corect ordonate; (4) catalogul și lista merg offline după prima încărcare; (5) build+deploy pe Pages, fără dependențe plătite.

## 10. Testare (QA)
Unit Vitest pe fixture-uri golden (4 bonuri + cazuri sintetice: reduceri, kg, EAN trunchiat) · property-based (fast-check) pe bani/rotunjiri · benchmark OCR local față de ground-truth (total corect, % linii, preț exact; nu blochează CI) · E2E Playwright pe viewport mobil (import → review → salvare → comparație → listă; offline; sync cu API mock) · axe (a11y) + Lighthouse PWA · CI pe runnere GitHub (gratuite pentru repo public).

## 11. Securitate și confidențialitate
Repo public: fără bonuri originale, fără nume/adresă/nr. client (factura METRO), fără cifre de card/loialitate (Kaufland, Lidl, Mega) — fixture-uri sanitizate prin script, originalele în `samples/private/` (gitignored) + verificare pre-commit · token GitHub doar în IndexedDB, fine-grained pe un singur repo (opțional criptat cu parolă, WebCrypto) · CSP prin `<meta>`, fără CDN/analytics la runtime (WASM, traineddata, fonturi self-hosted); conexiuni doar spre `api.github.com` și, dacă e activat, `generativelanguage.googleapis.com` · Gemini: opt-in per bon, imagine redimensionată, avertisment că tier-ul gratuit poate folosi datele pentru îmbunătățirea produselor Google (de verificat la implementare); ieșirea trece prin aceleași validări aritmetice.

## 12. Riscuri
1. OCR pe poze slabe → preprocesare, reparare cifre, crop-uri, text lipit (Live Text/Lens), Gemini opțional.
2. Potrivirea produselor între magazine e inerent fuzzy → om în buclă + memorie de alias.
3. Pierdere date din browser (iOS/ștergere) → PWA instalat + `storage.persist()` + sync + export.
4. Formate de bon care se schimbă → parsere versionate, fallback generic, text brut păstrat pentru re-procesare.
5. Gemini free tier (limite/termeni) se poate schimba → modul izolat și opțional.
6. Scurgeri de date prin repo public → sanitizare + verificare pre-commit.
7. Data Lidl `29/12/2026` > azi → avertisment, utilizatorul confirmă.

## 13. În afara scopului (v1)
Import automat din aplicații de magazin (ToS), scanare coduri de bare, notificări push, conturi multi-utilizator, aplicații native, orice serviciu plătit.

## 14. Flux de lucru
Trunk-based pe `main` (repo personal, un singur autor): lucrezi pe un branch, rebase pe `origin/main`, rulezi `lint + typecheck + test + build`, apoi `git push origin HEAD:main`; CI trebuie să rămână verde. Contractele din `docs/contracts.md` se schimbă doar împreună cu schemele zod și fixture-urile afectate.

## 15. Puncte deschise (nu blochează)
Android sau iPhone? (Share Target merge doar pe Android) · alte magazine + exemple de bonuri · confirmare nume „Pretometru”.
