/* Animas — fața (din Taifas 14.x): face-api găsește fața și cele 68 de puncte, ArcFace (w600k_mbf, ONNX Runtime Web)
   dă amprenta de 512 numere. Scorul de identitate: aceeași formulă ca în Taifas (100% = identic, ~64% = prag „aceeași persoană”). */
'use strict';
const FA = 'vendor/face-api/', ARC_DIR = 'vendor/arc/', ORT_DIR = 'vendor/ort/';
const ARC_PARTS = {wasm:{n:3, size:11246032}, onnx:{n:3, size:13616099}};
const AGE_MIN = 21;
let faP = null, arcP = null, faceErr = '';

function faceLoad(){
  if(faP) return faP;
  faP = new Promise((res, rej) => {
    const go = async () => {
      try{
        const f = window.faceapi; if(!f) throw new Error('biblioteca nu s-a încărcat');
        try{ if(f.tf.setWasmPaths) f.tf.setWasmPaths(new URL(FA, location.href).href); }catch(e){}
        let be = '';
        for(const x of ['webgl', 'wasm', 'cpu']){ try{ if(await f.tf.setBackend(x)){ await f.tf.ready(); be = x; break; } }catch(e){} }
        if(!be) throw new Error('niciun motor de calcul');
        await Promise.all([f.nets.tinyFaceDetector.loadFromUri(FA + 'model'), f.nets.faceLandmark68Net.loadFromUri(FA + 'model'), f.nets.ageGenderNet.loadFromUri(FA + 'model')]);
        res(f);
      }catch(e){ rej(e); }
    };
    if(window.faceapi) return go();
    const sc = document.createElement('script'); sc.src = FA + 'face-api.js'; sc.onload = go; sc.onerror = () => rej(new Error('nu pot încărca recunoașterea feței'));
    document.head.appendChild(sc);
  });
  faP.catch(e => { faP = null; faceErr = String(e && e.message || e); });
  return faP;
}
async function arcParts(base, P){
  const bufs = await Promise.all(Array.from({length:P.n}, async (_, i) => { const r = await fetch(base + '.' + i); if(!r.ok) throw new Error(base.split('/').pop() + '.' + i + ' lipsește (' + r.status + ')'); return new Uint8Array(await r.arrayBuffer()); }));
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let o = 0; for(const b of bufs){ out.set(b, o); o += b.length; }
  if(out.length !== P.size) throw new Error(base.split('/').pop() + ': ' + out.length + ' octeți în loc de ' + P.size);
  return out;
}
function arcLoad(){
  if(arcP) return arcP;
  arcP = (async () => {
    if(!window.ort) await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = ORT_DIR + 'ort.wasm.min.js'; sc.onload = res; sc.onerror = () => rej(new Error('ONNX Runtime nu s-a încărcat')); document.head.appendChild(sc); });
    ort.env.wasm.wasmPaths = new URL(ORT_DIR, location.href).href; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    const [wasm, model] = await Promise.all([arcParts(ORT_DIR + 'ort-wasm-simd-threaded.wasm', ARC_PARTS.wasm), arcParts(ARC_DIR + 'w600k_mbf.onnx', ARC_PARTS.onnx)]);
    ort.env.wasm.wasmBinary = wasm.buffer;
    return ort.InferenceSession.create(model, {executionProviders:['wasm'], graphOptimizationLevel:'all'});
  })();
  arcP.catch(e => { arcP = null; faceErr = String(e && e.message || e); });
  return arcP;
}
const ARC_T = [[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]];
function arc5(lm){ const m = (a, b) => { let x = 0, y = 0; for(let i = a; i <= b; i++){ x += lm[i][0]; y += lm[i][1]; } return [x / (b - a + 1), y / (b - a + 1)]; }; return [m(36, 41), m(42, 47), lm[30], lm[48], lm[54]]; }
function simT(src, dst){
  const n = src.length; let mx = 0, my = 0, ux = 0, uy = 0;
  for(let i = 0; i < n; i++){ mx += src[i][0]; my += src[i][1]; ux += dst[i][0]; uy += dst[i][1]; } mx /= n; my /= n; ux /= n; uy /= n;
  let A = 0, B = 0, D = 0;
  for(let i = 0; i < n; i++){ const px = src[i][0] - mx, py = src[i][1] - my, qx = dst[i][0] - ux, qy = dst[i][1] - uy; A += px * qx + py * qy; B += px * qy - py * qx; D += px * px + py * py; }
  const a = A / (D || 1), b = B / (D || 1); return {a, b, tx:ux - (a * mx - b * my), ty:uy - (b * mx + a * my)};
}
async function arcEmb(im, lm){
  const ses = await arcLoad(), t = simT(arc5(lm), ARC_T);
  const cv = document.createElement('canvas'); cv.width = cv.height = 112; const g = cv.getContext('2d', {willReadFrequently:true});
  g.fillStyle = '#000'; g.fillRect(0, 0, 112, 112); g.imageSmoothingQuality = 'high'; g.setTransform(t.a, t.b, -t.b, t.a, t.tx, t.ty); g.drawImage(im, 0, 0);
  const px = g.getImageData(0, 0, 112, 112).data, N = 112 * 112, x = new Float32Array(3 * N);
  for(let i = 0; i < N; i++){ x[i] = (px[i * 4] - 127.5) / 127.5; x[N + i] = (px[i * 4 + 1] - 127.5) / 127.5; x[2 * N + i] = (px[i * 4 + 2] - 127.5) / 127.5; }
  const out = await ses.run({[ses.inputNames[0]]:new ort.Tensor('float32', x, [1, 3, 112, 112])}), e = out[ses.outputNames[0]].data;
  let n = 0; for(const v of e) n += v * v; n = Math.sqrt(n) || 1;
  return Array.from(e, v => Math.round(v / n * 1e4) / 1e4);
}
// cea mai mare față din poză: {emb, box, W, H, age} sau null
async function faceOf(blob, {age = false} = {}){
  const f = await faceLoad(), u = URL.createObjectURL(blob);
  try{
    const im = await loadImg(u);
    let q = f.detectAllFaces(im, new f.TinyFaceDetectorOptions({inputSize:608, scoreThreshold:.4})).withFaceLandmarks();
    if(age) q = q.withAgeAndGender();
    let r = await q;
    if(!r.length){
      if(!f.nets.ssdMobilenetv1.isLoaded) await f.nets.ssdMobilenetv1.loadFromUri(FA + 'model');
      let q2 = f.detectAllFaces(im, new f.SsdMobilenetv1Options({minConfidence:.35})).withFaceLandmarks();
      if(age) q2 = q2.withAgeAndGender();
      r = await q2;
    }
    if(!r.length) return null;
    const x = r.sort((a, b) => b.detection.box.area - a.detection.box.area)[0], B = x.detection.box;
    const lm = x.landmarks.positions.map(p => [p.x, p.y]);
    return {emb:await arcEmb(im, lm), box:{x:B.x, y:B.y, w:B.width, h:B.height}, W:im.naturalWidth, H:im.naturalHeight, age:age ? Math.round(x.age) : null};
  } finally { URL.revokeObjectURL(u); }
}
const cosDist = (a, b) => { let d = 0, na = 0, nb = 0; for(let i = 0; i < a.length; i++){ d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return 1 - d / (Math.sqrt(na * nb) || 1); };
const idPct = d => Math.round(100 * Math.max(0, Math.min(1, (.9 - d) / .55)));
const ID_OK = 64;
// amprentele de referință ale personajului (portretul de aproape + poza de profil), ținute pe personaj
async function refEmbs(c){
  const keys = [c.face, c.photo].filter(Boolean), k = keys.join('|');
  if(c.emb && c.emb.k === k && c.emb.d.length) return c.emb.d;
  const d = [];
  for(const key of keys){ const b = await DB.get(key).catch(() => null); if(!b) continue; const f = await faceOf(b).catch(() => null); if(f) d.push(f.emb); }
  c.emb = {k, d}; await saveChars();
  return d;
}
// scorul unei poze față de personaj (0–100) sau null dacă fața nu se vede
async function idScore(c, blob){
  const ref = await refEmbs(c); if(!ref.length) return null;
  const f = await faceOf(blob); if(!f) return null;
  return idPct(Math.min(...ref.map(r => cosDist(f.emb, r))));
}
// cadre din clip (egal depărtate) + o miniatură
async function videoFrames(blob, n = 6){
  const u = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
  try{
    await new Promise((res, rej) => { v.addEventListener('loadeddata', res, {once:true}); v.addEventListener('error', () => rej(new Error('video')), {once:true}); setTimeout(() => rej(new Error('timeout')), 20000); });
    const D = v.duration; if(!(D > 0) || !v.videoWidth) return [];
    const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; const g = cv.getContext('2d'), out = [];
    for(let i = 0; i < n; i++){
      const t = Math.min(D - .05, D * (i + .5) / n);
      await new Promise(res => { const tm = setTimeout(res, 4000); v.addEventListener('seeked', () => { clearTimeout(tm); res(); }, {once:true}); v.currentTime = t; });
      g.drawImage(v, 0, 0, cv.width, cv.height); const b = await cvBlob(cv, .9); if(b){ b.t = Math.round(t * 10) / 10; out.push(b); }
    }
    return out;
  } finally { URL.revokeObjectURL(u); try{ v.removeAttribute('src'); v.load(); }catch(e){} }
}
// scorul clipului: media și cel mai slab cadru în care se vede fața
async function clipScore(c, frames){
  const ref = await refEmbs(c); if(!ref.length) return null;
  const P = [];
  for(const b of frames){ const f = await faceOf(b).catch(() => null); if(f) P.push(idPct(Math.min(...ref.map(r => cosDist(f.emb, r))))); }
  if(!P.length) return {seen:0, n:frames.length, avg:null, min:null};
  return {seen:P.length, n:frames.length, avg:Math.round(P.reduce((a, b) => a + b, 0) / P.length), min:Math.min(...P)};
}
