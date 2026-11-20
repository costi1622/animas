/* Animas 1.4 — corpul: MoveNet Lightning (17 puncte: nas, ochi, urechi, umeri, coate, încheieturi, șolduri, genunchi, glezne),
   în telefon, prin TensorFlow.js din face-api. Folosit pentru: încadrarea pozei de start (capul și corpul vizibil în cadru),
   ce parte din corp se vede (pentru prompt) și consecvența proporțiilor în clip (umeri, trunchi, șolduri, brațe, picioare). */
'use strict';
const POSE_URL = 'vendor/pose/movenet-lightning.json', POSE_THR = .3;
const KP = ['nas', 'ochiS', 'ochiD', 'urecheS', 'urecheD', 'umarS', 'umarD', 'cotS', 'cotD', 'incheieturaS', 'incheieturaD', 'soldS', 'soldD', 'genunchiS', 'genunchiD', 'gleznaS', 'gleznaD'];
let poseP = null;
function poseLoad(){
  if(poseP) return poseP;
  poseP = (async () => { const f = await faceLoad(); return f.tf.loadGraphModel(new URL(POSE_URL, location.href).href); })();
  poseP.catch(() => { poseP = null; });
  return poseP;
}
// punctele corpului în pixeli ai pozei: [{x, y, s}] × 17 (s = încrederea 0–1), sau null
async function bodyOf(blob){
  const model = await poseLoad(), tf = window.faceapi.tf, u = URL.createObjectURL(blob);
  try{
    const im = await loadImg(u), W = im.naturalWidth, H = im.naturalHeight, S = Math.max(W, H);
    // pătrat cu margini (fără deformare), 192×192
    const cv = document.createElement('canvas'); cv.width = cv.height = 192; const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 192, 192); const k = 192 / S, ox = (S - W) / 2 * k, oy = (S - H) / 2 * k;
    g.drawImage(im, ox, oy, W * k, H * k);
    const out = tf.tidy(() => model.execute(tf.cast(tf.browser.fromPixels(cv), 'int32').expandDims(0)));
    const d = await out.data(); out.dispose();
    const kp = KP.map((n, i) => ({n, x:(d[i * 3 + 1] * 192 - ox) / k, y:(d[i * 3] * 192 - oy) / k, s:d[i * 3 + 2]}));
    return kp.filter(p => p.s >= POSE_THR).length >= 4 ? {kp, W, H} : null;
  } finally { URL.revokeObjectURL(u); }
}
const kpOk = (b, n) => { const p = b && b.kp.find(x => x.n === n); return p && p.s >= POSE_THR ? p : null; };
// dreptunghiul corpului vizibil (fără cap; capul vine din față)
function bodyBox(b){
  const P = b ? b.kp.filter(p => p.s >= POSE_THR && !/nas|ochi|ureche/.test(p.n)) : [];
  if(P.length < 2) return null;
  const xs = P.map(p => p.x), ys = P.map(p => p.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (x1 - x0) * .12;
  return {x:Math.max(0, x0 - pad), y:Math.max(0, y0 - pad), w:Math.min(b.W, x1 + pad) - Math.max(0, x0 - pad), h:Math.min(b.H, y1 + pad * 1.5) - Math.max(0, y0 - pad)};
}
// ce parte din corp se vede: {ro, en}
function bodyView(b){
  const has = n => kpOk(b, n + 'S') || kpOk(b, n + 'D');
  if(!b) return null;
  if(has('glezna')) return {ro:'tot corpul', en:'full body visible, head to feet'};
  if(has('genunchi')) return {ro:'de la cap la genunchi', en:'visible from head to knees'};
  if(has('sold')) return {ro:'de la cap la șolduri', en:'visible from head to hips'};
  if(has('umar')) return {ro:'cap și umeri', en:'head and shoulders visible'};
  return {ro:'doar capul', en:'only the head visible'};
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({x:(a.x + b.x) / 2, y:(a.y + b.y) / 2});
// proporțiile corpului (rapoarte, deci nu depind de cât de aproape e camera)
function bodyProps(b){
  const g = n => kpOk(b, n), r = {};
  const uS = g('umarS'), uD = g('umarD'), sS = g('soldS'), sD = g('soldD');
  if(uS && uD && sS && sD){ const tr = dist(mid(uS, uD), mid(sS, sD)); if(tr > 1){ r.umeri_trunchi = dist(uS, uD) / tr; r.solduri_umeri = dist(sS, sD) / dist(uS, uD); } }
  const seg = (a, b, c) => { const A = g(a), B = g(b), Cc = g(c); return A && B && Cc && dist(B, Cc) > 1 ? dist(A, B) / dist(B, Cc) : null; };
  const arm = [seg('umarS', 'cotS', 'incheieturaS'), seg('umarD', 'cotD', 'incheieturaD')].filter(Boolean);
  if(arm.length) r.brat_antebrat = arm.reduce((a, v) => a + v, 0) / arm.length;
  const leg = [seg('soldS', 'genunchiS', 'gleznaS'), seg('soldD', 'genunchiD', 'gleznaD')].filter(Boolean);
  if(leg.length) r.coapsa_gamba = leg.reduce((a, v) => a + v, 0) / leg.length;
  return r;
}
// cât de mult se potrivesc proporțiile (0–100): media abaterilor rapoartelor comune (fiecare plafonată la 50%); 5% → 90, 10% → 80, 25% → 50
// 1.5: media, nu mediana: cu mediana, o singură proporție schimbată (ex. șoldurile) era ascunsă de celelalte trei neschimbate
function propMatch(a, b){
  const k = Object.keys(a).filter(x => b[x] != null); if(!k.length) return null;
  const dev = k.map(x => Math.min(.5, Math.abs(b[x] - a[x]) / a[x])), mean = dev.reduce((p, q) => p + q, 0) / dev.length;
  return Math.round(Math.max(0, Math.min(100, 100 - mean * 200)));
}
/* 1.5: comparația de încredere. Un raport se folosește doar dacă poziția din cadru îl lasă măsurabil:
   - umeri/trunchi: nu dacă s-a întors (nasul s-a mutat față de mijlocul umerilor) sau s-a aplecat (trunchiul s-a înclinat > 20°)
   - șolduri/umeri: nu dacă e aproape din profil (umerii au scăzut sub jumătate față de trunchi, față de poza de start)
   - braț/antebraț, coapsă/gambă: nu dacă unul din segmente e „scurtat” de unghi (sub 80% din lungimea lui din poza de start,
     raportat la trunchi): un braț întins spre cameră pare mai scurt, deși nu e
   Cadrele în care nu rămâne nimic măsurabil sunt sărite (și numărate). */
const RATIO_RO = {umeri_trunchi:'umeri/trunchi', solduri_umeri:'șolduri/umeri', brat_antebrat:'braț/antebraț', coapsa_gamba:'coapsă/gambă'};
function poseGeo(b){
  const g = n => kpOk(b, n), uS = g('umarS'), uD = g('umarD'), sS = g('soldS'), sD = g('soldD'), nas = g('nas'), G = {};
  if(uS && uD){ G.sw = dist(uS, uD); G.ms = mid(uS, uD); }
  if(sS && sD){ G.hw = dist(sS, sD); G.mh = mid(sS, sD); }
  if(G.ms && G.mh){ G.tr = dist(G.ms, G.mh); G.ang = Math.atan2(G.mh.x - G.ms.x, G.mh.y - G.ms.y) * 180 / Math.PI; }
  if(nas && G.ms && G.sw) G.turn = (nas.x - G.ms.x) / G.sw;
  const seg = (a, c) => { const A = g(a), B = g(c); return A && B ? dist(A, B) : null; };
  G.seg = {bS:seg('umarS', 'cotS'), bD:seg('umarD', 'cotD'), aS:seg('cotS', 'incheieturaS'), aD:seg('cotD', 'incheieturaD'),
           cS:seg('soldS', 'genunchiS'), cD:seg('soldD', 'genunchiD'), gS:seg('genunchiS', 'gleznaS'), gD:seg('genunchiD', 'gleznaD')};
  return G;
}
function bodyCompare(b0, b1){
  const A = bodyProps(b0), B = bodyProps(b1), G0 = poseGeo(b0), G1 = poseGeo(b1), use = {};
  const turned = G0.turn != null && G1.turn != null ? Math.abs(G1.turn - G0.turn) > .2 : false;
  const bent = G0.ang != null && G1.ang != null ? Math.abs(G1.ang - G0.ang) > 20 : false;
  if(A.umeri_trunchi != null && B.umeri_trunchi != null && !turned && !bent) use.umeri_trunchi = 1;
  if(A.solduri_umeri != null && B.solduri_umeri != null && G0.tr && G1.tr && G1.sw / G1.tr >= .5 * (G0.sw / G0.tr)) use.solduri_umeri = 1;
  const full = (k0, k1) => { const s0 = G0.seg[k0], s1 = G1.seg[k1 || k0]; return s0 && s1 && G0.tr && G1.tr && !bent && s1 / G1.tr >= .8 * (s0 / G0.tr); };
  if(A.brat_antebrat != null && B.brat_antebrat != null && ((full('bS') && full('aS')) || (full('bD') && full('aD')))) use.brat_antebrat = 1;
  if(A.coapsa_gamba != null && B.coapsa_gamba != null && ((full('cS') && full('gS')) || (full('cD') && full('gD')))) use.coapsa_gamba = 1;
  const k = Object.keys(use); if(!k.length) return null;
  const a = {}, b = {}; for(const x of k){ a[x] = A[x]; b[x] = B[x]; }
  const devs = k.map(x => ({r:x, d:Math.abs(B[x] - A[x]) / A[x]})).sort((p, q) => q.d - p.d);
  return {pct:propMatch(a, b), used:k, worst:devs[0]};
}
async function bodyScore(start, frames){
  const b0 = await bodyOf(start).catch(() => null); if(!b0) return null;
  if(!Object.keys(bodyProps(b0)).length) return null;
  const P = []; let skip = 0, worst = null;
  for(const f of frames){
    const b = await bodyOf(f).catch(() => null); if(!b){ skip++; continue; }
    const r = bodyCompare(b0, b); if(!r){ skip++; continue; }
    P.push(r.pct); if(!worst || r.worst.d > worst.d) worst = {...r.worst, t:f.t};
  }
  const out = {seen:P.length, n:frames.length, skip, v:2};
  if(P.length < 2) return {...out, avg:null, min:null, why:'prea puține cadre comparabile (poziția diferă mult de poza de start)'};
  return {...out, avg:Math.round(P.reduce((a, v) => a + v, 0) / P.length), min:Math.min(...P), worst:worst && {r:RATIO_RO[worst.r] || worst.r, pct:Math.round(worst.d * 100), t:worst.t}};
}
// 1.5: vârsta aparentă (face-api, ca în Taifas): mediana pe poză și oglinda ei; null dacă nu se vede fața
async function ageOf(blob){
  const ages = [];
  for(const flip of [false, true]){
    let b = blob;
    if(flip){ const u = URL.createObjectURL(blob); try{ const im = await loadImg(u), cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const g = cv.getContext('2d'); g.translate(cv.width, 0); g.scale(-1, 1); g.drawImage(im, 0, 0); b = await cvBlob(cv, .92); } finally { URL.revokeObjectURL(u); } }
    try{ const f = await faceOf(b, {age:true}); if(f && Number.isFinite(f.age)) ages.push(f.age); }catch(e){}
  }
  return ages.length ? Math.round(ages.reduce((a, v) => a + v, 0) / ages.length) : null;
}
