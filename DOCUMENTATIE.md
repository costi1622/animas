# Animas — documentație

Versiunea **1.1** (20 noiembrie 2026). Aplicație personală (PWA, JavaScript simplu): o poză + ce vrei să facă personajul → clip video realist.
Adresa: https://costi1622.github.io/animas/ · repo `costi1622/animas` · publicare: arhiva ZIP urcată în rădăcina repo-ului, workflow-ul `publica.yml` o dezarhivează și o publică pe GitHub Pages.

## Principii
- Text doar prin **Claude** (Sonnet 5.5, cheia ta Anthropic, direct din telefon).
- Imagine și video prin **Runware** (cheia ta, direct din telefon).
- Fața verificată în telefon cu **ArcFace** (același judecător ca în Taifas 14.x), gratuit.
- Fără server propriu: totul în IndexedDB (`animas`). Cheile stau doar în telefon.
- Aceleași limite ca în Taifas: personaje adulte (prag 21 de ani, estimat din poză și verificat de Claude), poze doar cu personaje create de tine (AI) sau cu acordul persoanei.

## Fișiere
| Fișier | Rol |
| --- | --- |
| `index.html` | ecranele și stilul |
| `app.js` | fluxul (Creează, Galerie, Personaje, Setări), lucrările, importul din Taifas, costurile |
| `runware.js` | modelele video cu prețuri, sarcinile asincrone, poza de start (FLUX.2 klein 9B) |
| `claude.js` | promptul video, promptul pozei, descrierea personajului |
| `face.js` | face-api (fața + 68 de puncte + vârsta) și ArcFace (amprenta de 512 numere) |
| `sw.js`, `manifest.webmanifest`, `icon*` | instalare ca aplicație, funcționare fără rețea pentru ecrane |
| `vendor/` | face-api, ONNX Runtime Web, ArcFace (bucăți de cel mult 5 MB) |

## Modelele (prețuri Runware, verificate 19.11.2026)
| Cheie | Model Runware | Rezoluții, $/s (fără / cu sunet) | Durate | Sunet |
| --- | --- | --- | --- | --- |
| `kling4f` (implicit) | `klingai:kling-video@4.0-flash` | 720p 0,094 | 3–20 s | mereu |
| `kling4` | `klingai:kling-video@4.0` | 720p 0,157; 1080p nepublicat (afișat „de la”) | 3–30 s | mereu |
| `veo31` | `google:3@2` | 720p/1080p 0,20 / 0,40; 4K 0,40 / 0,60 | 4, 6, 7, 8 s | la alegere |
| `veo31f` | `google:3@3` | 720p/1080p 0,10 / 0,15; 4K 0,30 / 0,35 | 4, 6, 7, 8 s | la alegere |
| `seed25` | `bytedance:seedance@2.5` | 480p 0,1025; 720p 0,23; 1080p 0,614; 4K 0,921 | 4–30 s | la alegere |
| `pvideo2` (schița) | `prunaai:p-video@2` | 720p 0,025; ciornă 0,015 | 4–8 s | fără |

Cererea video: `inputs.frameImages:[{image, frame:'first'}]` = poza de start (decupată în telefon la formatul ales). Mărimea: Kling Flash urmează poza; celelalte primesc `resolution`. Veo: `providerSettings.google.generateAudio`; Seedance: `settings.audio`; P-Video-2: `settings.draft`.
Toate sarcinile sunt `deliveryMethod:'async'` + `includeCost:true`; aplicația întreabă cu `getResponse`. Costul real din răspuns intră în totaluri; fără el, se folosește estimarea.

## Fluxul
1. **Personaj** (din Taifas sau nou) → **poza de start**: profilul, o poză urcată sau o scenă generată (Claude scrie promptul, FLUX.2 klein 9B cu poza de profil + portretul de aproape ca repere). Poza se decupează la 9:16 / 16:9 / 1:1 cu fața în cadru, iar fața se măsoară (ArcFace, ≥ 64% = aceeași persoană).
2. **Ce face** (în română) → **1.1: planul pe secunde.** Claude (vede poza de start) împarte textul în acțiuni vizibile, în ordinea ta, fără să lipsească sau să adauge ceva, păstrând toate detaliile (mâna, stânga/dreapta, de câte ori, încotro privește, ce spune), și dă fiecăreia un interval realist. Dacă nu încap în durata aleasă, spune și propune durata („Pune 8 s” refă planul). Promptul pentru model se scrie din plan: o linie de context („aceeași persoană, același loc, un singur cadru continuu”), o linie pe pas `[a–b s] acțiunea`, camera, sunetul (Kling: mereu, cu „no subtitles, no background music”), și regula finală „doar acești pași, în ordinea asta, fiecare dus până la capăt; fără tăieturi, fără gesturi în plus”. Planul se vede în română în Creează. Promptul se poate modifica; dacă schimbi textul sau setările, se rescrie singur la trimitere (dacă nu l-ai modificat tu).
3. **Schiță** (P-Video-2, ieftin) sau **Clip final** (modelul ales). Lucrarea se salvează înainte de trimitere; dacă închizi aplicația, la redeschidere o preia de unde a rămas. O trimitere întreruptă înainte să ajungă la Runware nu se retrimite singură (ca să nu plătești de două ori): apare cu „Reia”.
   **1.0.1:** cardul din „În lucru” arată ce răspunde Runware la fiecare verificare și de când; după 10 minute avertizează. Erorile din lista `errors` se citesc și când Runware trimite în același răspuns și „processing” (înainte, un clip eșuat putea fi așteptat 30 de minute). După 4 minute, la fiecare 2 minute aplicația cere și detaliile sarcinii (`getTaskDetails`): dacă acolo e clipul sau eroarea, le folosește. Butoane: „Renunță” (oprește verificarea, păstrează codul; „Reia” îl preia fără să-l retrimită) și „Detalii” (starea de la Runware, cererea, codul, ultimul răspuns).
   **1.0.2:** o cerere eșuată la Runware (ex. „Insufficient available balance”) nu se plătește: codul ei e uitat, iar „Reia” trimite o cerere nouă (înainte reîntreba cererea eșuată). Creditul insuficient e explicat în română, cu sumele: Runware rezervă la trimitere mai mult decât costul clipului (ex. 2,8 $ pentru Veo 3.1 Fast 8 s, cost real 1,20 $) și eliberează rezervarea la final.
4. Clipul se descarcă, se verifică fața pe 8 cadre (medie + cel mai slab cadru) și **1.1: pașii** — Claude vede cele 8 cadre (cu secunda fiecăruia) și dă pentru fiecare pas ✓ făcut / ~ parțial / ✗ lipsește / ? nesigur, cu motivul (~1–2 cenți; se poate opri din Setări). Dacă lipsesc pași: „Refă cu pașii lipsă accentuați” (același model, plan nou în care pașii lipsă primesc timp și sunt făcuți inconfundabili). Clipul apare apare în **Galerie** cu miniatură, cost și scor. Din galerie: salvează în telefon, fă finalul dintr-o schiță, refă/modifică, șterge.

## Importul din Taifas
Taifas și Animas sunt pe aceeași adresă (`costi1622.github.io`), deci în același Chrome văd aceeași memorie a telefonului. Animas **doar citește** baza `taifas2` (personajele, pozele, cheile); dacă Taifas nu există în acel browser, deschiderea e anulată ca să nu creeze o bază goală care l-ar strica. Se copiază: numele, poza de profil, portretul de aproape (`closeRef`), poza întreagă (`photoFull`), descrierea fizică (`physEn`), și al doilea personaj din duo-uri. Reimportul actualizează, nu dublează. Cheile se preiau doar dacă sunt în telefon (nu din seiful Worker).

## Teste
`test-animas-100.py` (Playwright, Claude și Runware simulate): 89 de verificări — import, decupare, scor, prețuri, câmpurile cerute de fiecare model, schiță → final, reluarea după repornire, personaj nou, vârsta, galerie, chei.
Rulare: `python3 test-animas-100.py <dosarul animas>` (lângă el: `fata.jpg`, `corp.jpg`, `clip.webm`).

## Istoric
| Versiune | Data | Ce |
| --- | --- | --- |
| 1.1 | 20.11.2026 | fidelitatea față de text: planul pe secunde, promptul scris din plan, verificarea pașilor în clip, refacerea cu pașii lipsă accentuați; $0,00 în loc de $0,000 |
| 1.0.2 | 20.11.2026 | creditul insuficient la Runware: mesaj clar, „Reia” trimite din nou cererea eșuată |
| 1.0.1 | 19.11.2026 | clipul care nu se mai termina: ce spune Runware pe card, erorile citite din orice răspuns, detaliile sarcinii, „Renunță”, „Detalii”, avertizare la 10 min |
| 1.0 | 19.11.2026 | prima versiune: flux complet, 6 modele, import din Taifas, verificarea feței, galerie, costuri |
