# Animas — documentație

Versiunea **1.5** (20 noiembrie 2026). Aplicație personală (PWA, JavaScript simplu): o poză + ce vrei să facă personajul → clip video realist.
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
| `claude.js` | planul video structurat, verificarea pașilor, promptul pozei, descrierea personajului |
| `prompt.js` | 1.2: asamblarea promptului video pe strategia fiecărui model, limita de 2.000 de caractere, compactarea fără pierderi de pași |
| `body.js` | 1.4: corpul cu MoveNet Lightning (17 puncte), încadrarea, ce se vede din corp, proporțiile în clip |
| `face.js` | face-api (fața + 68 de puncte + vârsta) și ArcFace (amprenta de 512 numere) |
| `sw.js`, `manifest.webmanifest`, `icon*` | instalare ca aplicație, funcționare fără rețea pentru ecrane |
| `vendor/` | face-api, ONNX Runtime Web, ArcFace (bucăți de cel mult 5 MB), `pose/` MoveNet Lightning (4,6 MB, din @vladmandic/human-models 3.0.4) |

## Modelele (prețuri Runware, verificate 19.11.2026)
| Cheie | Model Runware | Rezoluții, $/s (fără / cu sunet) | Durate | Sunet |
| --- | --- | --- | --- | --- |
| `kling4f` (implicit) | `klingai:kling-video@4.0-flash` | 720p 0,094 | 3–20 s | mereu |
| `kling4` | `klingai:kling-video@4.0` | 720p 0,157; 1080p nepublicat (afișat „de la”) | 3–30 s | mereu |
| `veo31` | `google:3@2` | 720p/1080p 0,20 / 0,40; 4K 0,40 / 0,60 | 4, 6, 7, 8 s | la alegere |
| `veo31f` | `google:3@3` | 720p/1080p 0,10 / 0,15; 4K 0,30 / 0,35 | 4, 6, 7, 8 s | la alegere |
| `seed25` | `bytedance:seedance@2.5` | 480p 0,1025; 720p 0,23; 1080p 0,614; 4K 0,921 | 4–30 s | la alegere |
| `pvideo2` (schița) | `prunaai:p-video@2` | 720p 0,025; ciornă 0,015 | 1–20 s (schița are durata finalului, cel mult 20 s) | fără |

Cererea video: `inputs.frameImages:[{image, frame:'first'}]` = poza de start (decupată în telefon la formatul ales). Mărimea: Kling Flash urmează poza; celelalte primesc `resolution`. Veo: `providerSettings.google.generateAudio`; Seedance: `settings.audio`; P-Video-2: `settings.draft`.
Toate sarcinile sunt `deliveryMethod:'async'` + `includeCost:true`; aplicația întreabă cu `getResponse`. Costul real din răspuns intră în totaluri; fără el, se folosește estimarea.

## Promptul video (1.2)
Claude nu mai scrie promptul liber: dă planul în JSON (`scene`, `visible` = ce se vede în poza de start despre corp, păr, haine, `steps` cu `t0/t1/ro/en/phases`, `camera`, `sound`, `speech`). `prompt.js` îl asamblează:
- linia de start a modelului; scena; ce se vede în poza de start; păstrarea identității și a proporțiilor (fără a rigidiza mișcarea); un rând pe pas `[a–b s] acțiunea: faza 1, then faza 2…`; camera; mișcarea naturală (umeri, trunchi, greutate, haine, păr); sunetul; regula de final.
- Strategii: Kling 4.0 Flash pornește cu `<<<image_1>>>` (forma din exemplul Runware), Kling are mereu sunet („no background music, no subtitles”); Veo: limbaj cinematic, sunet doar dacă e pornit, 2–4 pași; Seedance: pașii „unul după altul, în ordinea asta”; P-Video-2: scurt (≤ 700), „First…, then…, finally…”, fără secunde.
- Bugete: Kling Flash 1.700, Kling 4.0 1.800, Veo 1.500, Veo Fast 1.400, Seedance 1.800, P-Video-2 700; limita Runware 2.000. Compactare pe niveluri (mișcarea scurtă → identitatea scurtă → fără „ce se vede” → regula scurtă → fazele comprimate → fără cameră); pașii nu se scot niciodată. Dacă pașii singuri depășesc 2.000, aplicația oprește și cere text mai scurt.
- Limita se verifică înainte de trimitere (`checkLen`); 1.0–1.1 tăiau la 2.500 (peste limită). Promptul editat de tine se trimite neschimbat, cu contor de caractere; peste 2.000 nu se trimite.
- Hainele: se pot pune sau scoate doar straturi exterioare (geacă, palton, eșarfă, căciulă, mănuși).

## Încadrarea pozei de start (1.3)
`cropRect(W, H, format, fața, mutare)`: cel mai mare cadru cu formatul ales; capul întreg (fața + ~50% deasupra pentru frunte și păr, cât există în poză) cu ~6% aer deasupra, iar restul cadrului spre corp. Dacă formatul e prea scund pentru cap (ex. selfie vertical de aproape în 16:9), ochii se pun la mijloc și se spune „Capul nu încape întreg”. Sub poză: cât la sută din poză rămâne, formatul recomandat (cel care păstrează capul întreg și cea mai mare parte din poză, dintre cele permise de model) cu buton, și „▲ mai sus / ▼ mai jos / auto” (pași de 10% din cadru) când e loc de mutat. Fața se caută o dată pe poza întreagă. 1.0–1.2 puneau bărbia la 38% din înălțime și, la selfie-urile de aproape în 16:9, tăiau ochii și fruntea (iar scorul feței scădea).

## Corpul (1.4)
MoveNet Lightning rulează în telefon prin TensorFlow.js din face-api (`faceapi.tf.loadGraphModel`). Poza se pune într-un pătrat cu margini (fără deformare), 192×192; punctele cu încredere ≥ 0,3 contează.
- **Încadrarea:** dacă capul și corpul găsit încap în format, cadrul le cuprinde pe amândouă, centrat; altfel rămâne regula din 1.3 (capul întreg, restul spre corp). Fără față, cadrul se centrează pe corp.
- **Ce se vede** în cadrul final (tot corpul / cap–genunchi / cap–șolduri / cap și umeri) apare sub poză și merge la Claude și în prompt: „Framing: …; păstrează încadrarea, nu inventa părți ale corpului din afara cadrului”.
- **Semnele distinctive** (alunițe, pistrui, tatuaje, ochelari, bijuterii, machiaj) intră în descrierea „ce se vede” și în regula de identitate.
- **Proporțiile în clip:** rapoarte care nu depind de distanță (umeri/trunchi, șolduri/umeri, braț/antebraț, coapsă/gambă), comparate cu poza de start pe cele 8 cadre; mediana abaterilor → procent (5% → 90, 10% → 80 = pragul, 15% → 70). Aproximativ: unghiul și poziția schimbă măsurătorile; nu măsoară forme de sub haine.

## Cadrul final ancorat (1.5)
Planul lui Claude are și `endPose` (poziția de la finalul clipului). FLUX.2 klein 9B face ultima imagine din poza de start (reperul 1) și portretul de aproape (reperul 2): aceeași persoană, același corp, haine, loc, lumină și încadrare, altă poziție; aceeași mărime ca poza de start (multiplu de 16, latura lungă ≤ 1.280). Se verifică fața (ArcFace ≥ 64%) și proporțiile față de poza de start (≥ 80%); până la 2 încercări, se păstrează cea mai bună. Cadrul se trimite ca `frameImages[1] = {image, frame:'last'}` la Veo 3.1, Veo 3.1 Fast, Seedance 2.5, Kling 4.0 și P-Video-2 (Kling 4.0 Flash acceptă doar primul cadru). Promptul primește „The clip ends exactly on the provided last frame: …”. Se vede în Creează, cu scorurile și „↻ Refă cadrul final”; se poate opri din Setări. Cost: ~0,4 cenți pe încercare.

## Corpul, măsurat de încredere (1.5)
`bodyCompare`: un raport se compară doar dacă poziția îl lasă măsurabil — umeri/trunchi nu când s-a întors (nasul s-a mutat cu > 20% din lățimea umerilor față de poza de start) sau s-a aplecat (> 20°); șolduri/umeri nu aproape din profil; braț/antebraț și coapsă/gambă nu când un segment e scurtat de unghi (< 80% din lungimea din poza de start, raportat la trunchi). Scorul: media abaterilor (plafonate la 50%), nu mediana (cu mediana, o singură proporție schimbată era ascunsă). Cadrele fără nimic comparabil sunt sărite și numărate; sub 2 cadre comparabile: „nemăsurabil”. În clip: pe câte cadre s-a măsurat, câte s-au sărit, cea mai mare abatere și secunda ei; dacă fața < 64% sau corpul < 80%: „↻ Refă”.

## Vârsta (1.5)
Ca în Taifas, prag 21 de ani (estimarea face-api, media pe poză și oglinda ei; la personaje și pe portretul de aproape). Personajele care par mai tinere nu se importă, cele deja importate se marchează „blocat” și nu se pot alege, pozele urcate sau generate care par mai tinere sunt refuzate.

## Urcarea pozei (1.5)
Fișierul se citește imediat și se aduce la JPEG (≤ 2.400 px); dacă nu se poate citi (ex. HEIC/HEIF), mesaj clar. Poza arată „Se încarcă…” până e gata; orice eroare se spune.

## Ștergerea clipurilor (1.4)
În Galerie: „Selectează” (atingi clipurile, apoi „Șterge (n)”, „Toate”, „Anulează”) și „Șterge schițele (n)”. În clip, butoanele (inclusiv „🗑 Șterge”) stau imediat sub video. Se șterg clipul, miniatura și poza de start dacă nu mai e folosită; se spune câți MB s-au eliberat. Nu se poate anula.

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
`test-animas-100.py` (Playwright, Claude și Runware simulate): 159 de verificări în browser + `test-prompt-120.js` (Node, 43 de verificări: fiecare model separat, limita, compactarea) — import, decupare, scor, prețuri, câmpurile cerute de fiecare model, schiță → final, reluarea după repornire, personaj nou, vârsta, galerie, chei.
Rulare: `python3 test-animas-100.py <dosarul animas>` (lângă el: `fata.jpg`, `corp.jpg`, `clip.webm`).

## Istoric
| Versiune | Data | Ce |
| --- | --- | --- |
| 1.5 | 20.11.2026 | cadrul final ancorat; măsurarea corpului de încredere (rapoarte doar când poziția le lasă comparabile, media în loc de mediană); „Refă” când fața sau corpul au deviat; vârsta la import și la poze; urcarea pozelor cu mesaje clare; refacerea dintr-o schiță nu mai lasă P-Video-2 ca model final |
| 1.4 | 20.11.2026 | corpul: MoveNet în telefon (încadrare cap + corp, ce se vede din corp în prompt, proporțiile în clip); semnele distinctive ale feței în prompt; ștergerea clipurilor din galerie (selecție, toate schițele), butoanele sub video |
| 1.3 | 20.11.2026 | încadrarea pozei de start: capul întreg, restul spre corp, formatul recomandat, mutarea cadrului; repară tăierea ochilor la selfie-uri de aproape în 16:9 |
| 1.2.1 | 20.11.2026 | schița are durata aleasă (P-Video-2 acceptă 1–20 s; înainte era tăiată greșit la 8 s); peste 20 s, schița are 20 s și se spune |
| 1.2 | 20.11.2026 | promptul asamblat în aplicație pe strategia fiecărui model, din planul structurat; limita de 2.000 verificată (nu tăiere la 2.500); fazele acțiunilor complexe; corpul ancorat pe ce se vede; mișcare naturală; contor de caractere |
| 1.1 | 20.11.2026 | fidelitatea față de text: planul pe secunde, promptul scris din plan, verificarea pașilor în clip, refacerea cu pașii lipsă accentuați; $0,00 în loc de $0,000 |
| 1.0.2 | 20.11.2026 | creditul insuficient la Runware: mesaj clar, „Reia” trimite din nou cererea eșuată |
| 1.0.1 | 19.11.2026 | clipul care nu se mai termina: ce spune Runware pe card, erorile citite din orice răspuns, detaliile sarcinii, „Renunță”, „Detalii”, avertizare la 10 min |
| 1.0 | 19.11.2026 | prima versiune: flux complet, 6 modele, import din Taifas, verificarea feței, galerie, costuri |
