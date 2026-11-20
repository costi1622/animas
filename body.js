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
// cât de mult se potrivesc proporțiile din clip cu poza de start (0–100); aproximativ: unghiul și poziția schimbă măsurătorile
function propMatch(a, b){
  const k = Object.keys(a).filter(x => b[x] != null); if(!k.length) return null;
  const dev = k.map(x => Math.abs(b[x] - a[x]) / a[x]).sort((p, q) => p - q), med = dev[Math.floor((dev.length - 1) / 2)];
  return Math.round(Math.max(0, Math.min(100, 100 - med * 200)));   // 5% abatere → 90, 15% → 70
}
async function bodyScore(start, frames){
  const b0 = await bodyOf(start).catch(() => null); if(!b0) return null;
  const p0 = bodyProps(b0); if(!Object.keys(p0).length) return null;
  const P = [];
  for(const f of frames){ const b = await bodyOf(f).catch(() => null); if(!b) continue; const m = propMatch(p0, bodyProps(b)); if(m != null) P.push(m); }
  if(!P.length) return {seen:0, n:frames.length, avg:null, min:null};
  return {seen:P.length, n:frames.length, avg:Math.round(P.reduce((a, v) => a + v, 0) / P.length), min:Math.min(...P)};
}
