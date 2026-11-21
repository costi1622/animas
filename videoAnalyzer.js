/* Animas 1.9.0 — 🎞 Montaj AI · videoAnalyzer: ce e în fiecare clip, măsurat în telefon.
   Metadate (durată, rezoluție, fps, codec, sunet, dimensiune, format) din antetul MP4/MOV (fără decodare) + din <video>;
   cadre: 0 / 25 / 50 / 75 / 100% (pentru Claude) și capetele fine (primele / ultimele ~1,5 s, din 0,25 în 0,25 s) pentru tăieturi;
   pe fiecare cadru: miniatura alb-negru 36×64, histograma de culoare, postura (MoveNet: capul, brațele, distanța, poziția).
   Dacă telefonul nu poate reda fișierul (codec necunoscut), cadrele vin din FFmpeg (videoMerger.js). Clipurile se citesc pe rând. */
'use strict';
const VA_EDGE = 1.5, VA_STEP = .25, VA_PX = 320;
// ── antetul MP4 / MOV: cutiile moov → trak → tkhd / mdhd / hdlr / stsd / stts (fără să citesc tot fișierul)
async function mp4Meta(blob){
  const rd = async (o, n) => new DataView(await blob.slice(o, o + n).arrayBuffer());
  let off = 0, moov = null, guard = 0;
  while(off + 8 <= blob.size && guard++ < 64){
    const h = await rd(off, 16); let size = h.getUint32(0); const type = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
    if(size === 1) size = Number(h.getBigUint64(8)); else if(size === 0) size = blob.size - off;
    if(size < 8) return null;
    if(type === 'moov'){ if(size > 64e6) return null; moov = await rd(off, size); break; }
    off += size;
  }
  if(!moov) return null;
  const kids = (dv, s, e) => { const out = []; let o = s; while(o + 8 <= e){ const z = dv.getUint32(o), t = String.fromCharCode(dv.getUint8(o + 4), dv.getUint8(o + 5), dv.getUint8(o + 6), dv.getUint8(o + 7)); if(z < 8 || o + z > e) break; out.push({t, s:o, e:o + z}); o += z; } return out; };
  const find = (dv, b, path) => { let cur = [b]; for(const p of path){ const n = cur.flatMap(x => kids(dv, x.s + 8, x.e)).filter(x => x.t === p); if(!n.length) return null; cur = n; } return cur[0]; };
  const all = (dv, b, t) => kids(dv, b.s + 8, b.e).filter(x => x.t === t);
  const root = {s:-8, e:moov.byteLength}, mv = find(moov, root, ['moov']); if(!mv) return null;
  const M = {audio:false};
  for(const tr of all(moov, mv, 'trak')){
    const hd = find(moov, tr, ['mdia', 'hdlr']), md = find(moov, tr, ['mdia', 'mdhd']); if(!hd || !md) continue;
    const kind = String.fromCharCode(...[0, 1, 2, 3].map(i => moov.getUint8(hd.s + 16 + i)));
    const v1 = moov.getUint8(md.s + 8) === 1, ts = moov.getUint32(md.s + (v1 ? 28 : 20)), du = v1 ? Number(moov.getBigUint64(md.s + 32)) : moov.getUint32(md.s + 24);
    if(kind === 'soun'){ M.audio = true; continue; }
    if(kind !== 'vide' || M.w) continue;
    const tk = find(moov, tr, ['tkhd']);
    if(tk){ const t1 = moov.getUint8(tk.s + 8) === 1, b0 = tk.s + (t1 ? 60 : 48); const a = moov.getInt32(b0), b = moov.getInt32(b0 + 4);
      M.w = Math.round(moov.getUint32(tk.e - 8) / 65536); M.h = Math.round(moov.getUint32(tk.e - 4) / 65536); if(a === 0 && Math.abs(b) === 65536){ const x = M.w; M.w = M.h; M.h = x; } }
    const sd = find(moov, tr, ['mdia', 'minf', 'stbl', 'stsd']); if(sd) M.codec = String.fromCharCode(...[0, 1, 2, 3].map(i => moov.getUint8(sd.s + 20 + i))).trim();
    const st = find(moov, tr, ['mdia', 'minf', 'stbl', 'stts']);
    if(st && ts){ const n = moov.getUint32(st.s + 12); let cnt = 0; for(let i = 0; i < n && i < 4096; i++) cnt += moov.getUint32(st.s + 16 + i * 8); M.dur = du / ts; if(M.dur > 0) M.fps = Math.round(cnt / M.dur * 100) / 100; }
  }
  return M.w ? M : null;
}
const CODEC_RO = {avc1:'H.264', avc3:'H.264', hvc1:'H.265', hev1:'H.265', vp09:'VP9', av01:'AV1', mp4v:'MPEG-4'};
// ── cadrele: un singur <video>, căutări pe rând; fiecare cadru → JPEG mic + alb-negru 36×64 + histogramă
function vaPix(src, W, H){
  const cv = document.createElement('canvas'); cv.width = 36; cv.height = 64; const g = cv.getContext('2d');
  g.drawImage(src, 0, 0, W, H, 0, 0, 36, 64); const d = g.getImageData(0, 0, 36, 64).data, gray = new Float32Array(36 * 64), hist = new Float32Array(48);
  for(let i = 0, p = 0; i < d.length; i += 4, p++){ gray[p] = (.3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]) / 255; hist[d[i] >> 4]++; hist[16 + (d[i + 1] >> 4)]++; hist[32 + (d[i + 2] >> 4)]++; }
  for(let i = 0; i < 48; i++) hist[i] /= 36 * 64;
  return {gray, hist};
}
async function vaFramesVideo(blob, plan, signal){
  const u = URL.createObjectURL(blob), v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = u;
  try{
    await new Promise((res, rej) => { v.addEventListener('loadeddata', res, {once:true}); v.addEventListener('error', () => rej(new Error('nu se poate reda')), {once:true}); setTimeout(() => rej(new Error('nu se poate reda (timp depășit)')), 15000); });
    const D = v.duration; if(!(D > 0) || !isFinite(D) || !v.videoWidth) throw new Error('nu se poate reda');
    // fps (când antetul nu-l dă, ex. WebM): ~0,5 s de redare fără sunet, numărând cadrele afișate
    let fps = null;
    if(v.requestVideoFrameCallback && plan.fps !== false) try{ fps = await new Promise(res => { let n = 0, t0 = null, t1 = null; const tm = setTimeout(() => { v.pause(); res(t1 > t0 && n > 3 ? (n - 1) / (t1 - t0) : null); }, 900);
      const cb = (now, md) => { n++; if(t0 == null) t0 = md.mediaTime; t1 = md.mediaTime; if(n < 14) v.requestVideoFrameCallback(cb); else { clearTimeout(tm); v.pause(); res((n - 1) / (t1 - t0)); } };
      v.requestVideoFrameCallback(cb); v.play().catch(() => { clearTimeout(tm); res(null); }); }); }catch(e){ fps = null; }
    if(fps) fps = [24, 25, 30, 50, 60].find(f => Math.abs(f - fps) / f < .06) || Math.round(fps);
    const W = v.videoWidth, H = v.videoHeight, k = Math.min(1, VA_PX / W), cv = document.createElement('canvas'); cv.width = Math.round(W * k); cv.height = Math.round(H * k);
    const g = cv.getContext('2d'), out = [];
    for(const t0 of plan(D)){
      if(signal && signal.aborted) throw new MergeCancel();
      const t = Math.max(0, Math.min(D - .04, t0));
      await new Promise(res => { const tm = setTimeout(res, 4000); v.addEventListener('seeked', () => { clearTimeout(tm); res(); }, {once:true}); v.currentTime = t; });
      g.drawImage(v, 0, 0, cv.width, cv.height); const b = await cvBlob(cv, .85); if(!b) continue;
      out.push({t:Math.round(t * 100) / 100, blob:b, ...vaPix(cv, cv.width, cv.height)});
    }
    return {D, W, H, frames:out, fps};
  } finally { URL.revokeObjectURL(u); try{ v.removeAttribute('src'); v.load(); }catch(e){} }
}
async function vaFramesFF(blob, plan, signal){
  const probe = await ffFrames(blob, [0], 64, signal), D = probe.info.dur; if(!(D > 0)) throw new Error('fișier stricat');
  const r = await ffFrames(blob, plan(D), VA_PX, signal), out = [];
  for(const f of r.frames){ const im = await createImageBitmap(f.blob); out.push({t:f.t, blob:f.blob, ...vaPix(im, im.width, im.height)}); im.close && im.close(); }
  return {D, W:r.info.w, H:r.info.h, frames:out, info:r.info};
}
// momentele: reprezentative (0/25/50/75/100%) + capetele fine
function vaPlan(D){
  const e = Math.min(VA_EDGE, D / 3), T = new Set();
  [0, .25, .5, .75, 1].forEach(p => T.add(+(Math.max(.02, Math.min(D - .05, D * p))).toFixed(2)));
  for(let t = 0; t <= e + 1e-6; t += VA_STEP){ T.add(+(Math.max(.02, t)).toFixed(2)); T.add(+(Math.max(.02, D - .05 - t)).toFixed(2)); }
  return [...T].sort((a, b) => a - b);
}
// postura pe cadru: punctele normalizate (0–1), centrul, scara (distanța față de cameră), capul (întoarcerea), brațele
function vaPose(b){
  if(!b) return null;
  const P = {}; for(const p of b.kp) if(p.s >= POSE_THR) P[p.n] = {x:p.x / b.W, y:p.y / b.H};
  const g = poseGeo(b), uS = P.umarS, uD = P.umarD;
  const sw = uS && uD ? Math.hypot((uS.x - uD.x) * b.W, (uS.y - uD.y) * b.H) / Math.max(b.W, b.H) : null;
  const pts = Object.values(P), c = uS && uD ? {x:(uS.x + uD.x) / 2, y:(uS.y + uD.y) / 2} : pts.length ? {x:pts.reduce((a, p) => a + p.x, 0) / pts.length, y:pts.reduce((a, p) => a + p.y, 0) / pts.length} : null;
  const bx = bodyBox(b), scale = sw || (bx ? bx.h / b.H / 3 : null);
  return {P, c, scale, turn:g.turn != null ? +g.turn.toFixed(3) : null, ears:(P.urecheS ? 1 : 0) + (P.urecheD ? 1 : 0), view:(bodyView(b) || {}).en || ''};
}
// descrierea măsurată a unui cadru, pentru Claude (în engleză, scurt)
function vaDescribe(p){
  if(!p) return 'no person/pose detected';
  const s = [];
  if(p.turn != null) s.push('head ' + (Math.abs(p.turn) < .12 ? 'facing camera' : p.turn < 0 ? 'turned to image-left (' + p.turn + ')' : 'turned to image-right (+' + p.turn + ')'));
  if(p.scale != null) s.push('distance ' + (p.scale > .45 ? 'very close' : p.scale > .28 ? 'close' : p.scale > .16 ? 'medium' : 'far') + ' (shoulders ' + Math.round(p.scale * 100) + '% of frame)');
  if(p.c) s.push('body center x=' + p.c.x.toFixed(2) + ', y=' + p.c.y.toFixed(2));
  const arm = side => { const w = p.P['incheietura' + side], u = p.P['umar' + side]; if(!w || !u) return null; return (side === 'S' ? 'left' : 'right') + ' hand ' + (w.y < u.y - .03 ? 'raised above shoulder' : w.y < u.y + .12 ? 'at chest/shoulder height' : 'low'); };
  const a = [arm('S'), arm('D')].filter(Boolean); if(a.length) s.push(a.join(', '));
  if(p.view) s.push(p.view);
  return s.join('; ');
}
/* analiza unui clip: {name, blob, src} → {ok, err, meta, D, frames[], rep[], head[], tail[]}
   meta: {dur, w, h, fps, codec, audio, size, aspect} */
async function analyzeClip(item, {signal, pose = true} = {}){
  const meta = {size:item.blob.size, type:item.blob.type || ''};
  let m = null; try{ m = await mp4Meta(item.blob); }catch(e){}
  if(m) Object.assign(meta, {dur:m.dur, w:m.w, h:m.h, fps:m.fps, codec:CODEC_RO[m.codec] || m.codec, audio:m.audio});
  let F;
  try{ F = await vaFramesVideo(item.blob, vaPlan, signal); }
  catch(e){
    if(e && e.cancel) throw e;
    try{ F = await vaFramesFF(item.blob, vaPlan, signal); if(F.info){ meta.fps = meta.fps || F.info.fps; meta.codec = meta.codec || F.info.codec; if(meta.audio == null) meta.audio = F.info.audio; } }
    catch(e2){ if(e2 && e2.cancel) throw e2; return {ok:false, err:'Fișierul nu se poate citi (stricat sau format necunoscut).', meta}; }
  }
  if(!F.frames.length) return {ok:false, err:'Fișierul nu are cadre care se pot citi.', meta};
  meta.dur = meta.dur || F.D; meta.w = meta.w || F.W; meta.h = meta.h || F.H;
  if(!meta.fps && F.fps) meta.fps = F.fps;
  if(!meta.codec) meta.codec = /webm/.test(meta.type) ? 'WebM' : '';
  meta.aspect = vaAspect(meta.w, meta.h);
  const D = F.D, e = Math.min(VA_EDGE, D / 3) + .01;
  if(pose && typeof bodyOf === 'function'){
    for(const f of F.frames){ if(signal && signal.aborted) throw new MergeCancel(); try{ f.pose = vaPose(await bodyOf(f.blob)); }catch(err){ f.pose = null; } }
  }
  const idx = pred => F.frames.map((f, i) => pred(f) ? i : -1).filter(i => i >= 0);
  const rep = [0, .25, .5, .75, 1].map(p => { const t = Math.max(.02, Math.min(D - .05, D * p)); let bi = 0; F.frames.forEach((f, i) => { if(Math.abs(f.t - t) < Math.abs(F.frames[bi].t - t)) bi = i; }); return bi; });
  return {ok:true, meta, D, frames:F.frames, rep, head:idx(f => f.t <= e), tail:idx(f => f.t >= D - .05 - e).reverse()};
}
function vaAspect(w, h){
  if(!w || !h) return '';
  const r = w / h, K = [['9:16', 9 / 16], ['3:4', 3 / 4], ['1:1', 1], ['4:3', 4 / 3], ['16:9', 16 / 9]];
  const b = K.reduce((a, k) => Math.abs(k[1] - r) < Math.abs(a[1] - r) ? k : a); return Math.abs(b[1] - r) < .03 ? b[0] : `${w}:${h}`;
}
