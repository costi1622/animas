/* Animas 1.9.0 — 🎞 Montaj AI · videoMerger: lipirea locală, în telefon, cu FFmpeg.wasm (un singur fir, fără server, fără Runware).
   Pașii: fiecare clip, pe rând (nu toate în memorie odată): tăiere exactă → scalare fără deformare (margini doar dacă formatele diferă și
   ai ales „margini”) → fps comun → sunetul lui sau liniște → H.264 + AAC. Apoi: lipire fără recodare (tăieturi directe) sau, unde ai ales
   fondu, o trecere scurtă (xfade + acrossfade). La final, fișierul e decodat integral (verificare) înainte de „gata”. */
'use strict';
const FF_DIR = 'vendor/ffmpeg/', FF_PARTS = {n:7, size:32232419};
let ffP = null, ffNow = null;
class MergeCancel extends Error { constructor(){ super('Anulat.'); this.cancel = true; } }
const loadScript = src => new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = src; sc.onload = res; sc.onerror = () => rej(new Error(src.split('/').pop() + ' nu s-a încărcat')); document.head.appendChild(sc); });
// bucățile wasm-ului, cu progres (descărcarea se face o singură dată; apoi vin din copia telefonului)
async function ffParts(onProg){
  const bufs = [];
  for(let i = 0; i < FF_PARTS.n; i++){
    const r = await fetch(FF_DIR + 'ffmpeg-core.wasm.' + i); if(!r.ok) throw new Error('ffmpeg-core.wasm.' + i + ' lipsește (' + r.status + ')');
    bufs.push(new Uint8Array(await r.arrayBuffer())); onProg && onProg((i + 1) / FF_PARTS.n);
  }
  const out = new Uint8Array(bufs.reduce((a, b) => a + b.length, 0)); let o = 0; for(const b of bufs){ out.set(b, o); o += b.length; }
  if(out.length !== FF_PARTS.size) throw new Error('ffmpeg-core.wasm: ' + out.length + ' octeți în loc de ' + FF_PARTS.size);
  return out;
}
function ffLoad(onProg){
  if(ffP) return ffP;
  ffP = (async () => {
    if(!window.FFmpegWASM) await loadScript(FF_DIR + 'ffmpeg.js');
    const wasm = await ffParts(onProg), wasmURL = URL.createObjectURL(new Blob([wasm], {type:'application/wasm'}));
    const ff = new FFmpegWASM.FFmpeg();
    try{ await ff.load({coreURL:new URL(FF_DIR + 'ffmpeg-core.js', location.href).href, wasmURL}); }
    finally { URL.revokeObjectURL(wasmURL); }
    ff.__log = []; ff.__base = 0; ff.on('log', ({message}) => { ff.__log.push(message); if(ff.__log.length > 4000){ ff.__log.splice(0, 2000); ff.__base += 2000; } });
    return ff;
  })();
  ffP.catch(() => { ffP = null; });
  return ffP;
}
// jurnalul FFmpeg: poziții absolute (lista se scurtează din față când crește), ca să nu pierd liniile unei comenzi
const logMark = ff => ff.__base + ff.__log.length, logSince = (ff, m) => ff.__log.slice(Math.max(0, m - ff.__base));
function ffKill(){ const f = ffNow; ffNow = null; ffP = null; if(f) try{ f.terminate(); }catch(e){} }
// rulează o comandă; întoarce jurnalul ei; aruncă la cod ≠ 0 (cu ultimele linii ale lui FFmpeg)
async function ffRun(ff, args, signal){
  if(signal && signal.aborted) throw new MergeCancel();
  if(!args.includes('-v')) args = ['-v', 'info', ...args];   // nivelul de jurnal rămâne setat între comenzi în FFmpeg.wasm (progresul îl citește din jurnal)
  const from = logMark(ff); let code;
  try{ code = await ff.exec(args); }
  catch(e){ if(signal && signal.aborted) throw new MergeCancel(); throw ffErr(e, logSince(ff, from)); }
  if(signal && signal.aborted) throw new MergeCancel();
  const log = logSince(ff, from);
  if(code !== 0) throw ffErr(null, log);
  return log;
}
function ffErr(e, log){
  const t = String(e && (e.message || e) || '') + ' ' + log.slice(-12).join(' | ');
  if(/out of memory|OOM|Cannot enlarge memory|memory access out of bounds|RangeError/i.test(t)) { const x = new Error('Telefonul nu mai are memorie pentru montaj. Alege mai puține clipuri sau rezoluția 720p.'); x.oom = true; return x; }
  const x = new Error('FFmpeg: ' + (log.filter(l => /error|invalid|failed|no such|could not|unable/i.test(l)).slice(-2).join(' · ') || String(e && (e.message || e) || 'eroare necunoscută')).slice(0, 240)); x.ff = true; return x;
}
// ce spune FFmpeg despre un fișier (fără decodare): durată, rezoluție, fps, codec, sunet
function ffInfo(log){
  const L = log.join('\n'), I = {};
  const d = L.match(/Duration:\s*(\d+):(\d+):([\d.]+)/); if(d) I.dur = +d[1] * 3600 + +d[2] * 60 + +d[3];
  const v = L.match(/Stream #\d+:\d+[^\n]*?: Video: (\w+)[^\n]*?, (\d{2,5})x(\d{2,5})[^\n]*/);
  if(v){ I.codec = v[1]; I.w = +v[2]; I.h = +v[3]; const f = v[0].match(/([\d.]+) fps/) || v[0].match(/([\d.]+) tbr/); if(f) I.fps = +f[1];
    const r = v[0].match(/rotate\s*:\s*(-?\d+)/) || L.match(/rotation of (-?[\d.]+) degrees/); if(r && Math.abs(+r[1]) % 180 === 90){ const t = I.w; I.w = I.h; I.h = t; } }
  I.audio = /Stream #\d+:\d+[^\n]*?: Audio:/.test(L);
  return I;
}
async function ffProbe(ff, name, signal){
  const from = logMark(ff);
  try{ await ff.exec(['-hide_banner', '-v', 'info', '-i', name]); }catch(e){ if(signal && signal.aborted) throw new MergeCancel(); const x = ffErr(e, []); if(x.oom || /terminate/i.test(String(e && e.message))) throw x; }   // nivelul de jurnal rămâne setat între comenzi în FFmpeg.wasm   // fără ieșire: FFmpeg spune doar ce e în fișier
  if(signal && signal.aborted) throw new MergeCancel();
  return ffInfo(logSince(ff, from));
}
const even = x => Math.max(2, Math.round(x / 2) * 2);
// formatul montajului: raportul cel mai des întâlnit (fără deformare), înălțimea cea mai mare a lor (plafonată), fps comun sau 30
function mergeTarget(metas, {maxH = 1080} = {}){
  const ar = m => m.w / m.h, groups = {};
  for(const m of metas){ const k = (Math.round(ar(m) * 100) / 100).toFixed(2); (groups[k] = groups[k] || []).push(m); }
  const best = Object.values(groups).sort((a, b) => b.length - a.length || Math.max(...b.map(m => m.w * m.h)) - Math.max(...a.map(m => m.w * m.h)))[0];
  // rezoluția: cea mai mare din grupul ales, fără mărire; latura scurtă cel mult maxH (1080 sau 720), cea lungă cel mult 1920
  const top = best.slice().sort((a, b) => b.w * b.h - a.w * a.h)[0], R = top.w / top.h;
  const k = Math.min(1, maxH / Math.min(top.w, top.h), 1920 / Math.max(top.w, top.h));
  const W = even(top.w * k), H = even(W / R);
  const fpsL = metas.map(m => Math.round(m.fps || 0)).filter(Boolean), same = fpsL.length === metas.length && fpsL.every(f => f === fpsL[0]);
  const fps = same ? Math.min(60, fpsL[0]) : 30;
  return {w:W, h:H, fps, mixed:Object.keys(groups).length > 1, audio:metas.some(m => m.audio)};
}
/* items: [{name, blob, startTrim, endTrim, dur}], trans: [{type:'cut'|'fade', d}] (între items[k] și items[k+1]),
   opts: {maxH, fit:'pad'|'crop', signal, onProg(p 0–1, text)} → {blob, dur, w, h, fps, audio} */
async function mergeVideos(items, trans, opts = {}){
  const {signal, onProg = () => {}} = opts;
  if(items.length < 2) throw new Error('Montajul are nevoie de cel puțin 2 clipuri.');
  const est = items.reduce((a, x) => a + (x.blob.size || 0), 0), dm = navigator.deviceMemory || 4;
  const big = items.reduce((a, x) => Math.max(a, x.blob.size || 0), 0);
  if(big > 450e6 || est > 1.6e9) throw Object.assign(new Error(`Clipurile sunt prea mari pentru montajul în telefon (${Math.round(est / 1e6)} MB). Alege mai puține sau mai scurte.`), {oom:true});
  onProg(0, 'Pregătesc FFmpeg (prima dată se descarcă ~32 MB)…');
  const ff = await ffLoad(p => onProg(.06 * p, `Pregătesc FFmpeg… ${Math.round(p * 100)}%`)); ffNow = ff;
  if(signal && signal.aborted) throw new MergeCancel();
  const onAbort = () => ffKill(); if(signal) signal.addEventListener('abort', onAbort, {once:true});
  const files = [];
  const rm = async n => { try{ await ff.deleteFile(n); }catch(e){} };
  try{
    // 1) ce e în fiecare (pe rând)
    const metas = [];
    for(let k = 0; k < items.length; k++){
      const n = 'p' + k; await ff.writeFile(n, new Uint8Array(await items[k].blob.arrayBuffer()));
      const I = await ffProbe(ff, n, signal); await rm(n);
      if(!I.w || !I.dur) throw new Error(`„${items[k].name}” nu se poate citi (fișier stricat sau format necunoscut).`);
      metas.push(I); onProg(.06 + .04 * (k + 1) / items.length, `Citesc clipurile… ${k + 1}/${items.length}`);
    }
    let T = mergeTarget(metas, opts);
    if(dm <= 2 && Math.min(T.w, T.h) > 720){ const q = 720 / Math.min(T.w, T.h); T = {...T, w:even(T.w * q), h:even(T.h * q), low:true}; }   // telefon cu ≤ 2 GB: 720p
    const fit = opts.fit === 'crop' ? 'crop' : 'pad';
    const vf = `scale=${T.w}:${T.h}:force_original_aspect_ratio=${fit === 'crop' ? 'increase' : 'decrease'},${fit === 'crop' ? `crop=${T.w}:${T.h}` : `pad=${T.w}:${T.h}:(ow-iw)/2:(oh-ih)/2:color=black`},setsar=1,fps=${T.fps},format=yuv420p`;
    // 2) fiecare clip normalizat, pe rând
    const lens = [];
    for(let k = 0; k < items.length; k++){
      const it = items[k], M = metas[k], st = Math.max(0, +it.startTrim || 0), en = Math.max(0, +it.endTrim || 0), len = +(Math.floor((M.dur - st - en) * T.fps + 1e-6) / T.fps).toFixed(4);   // cadre întregi: fără goluri la lipire
      if(!(len >= .3)) throw new Error(`„${it.name}”: tăieturile lasă mai puțin de 0,3 s.`);
      const n = 'i' + k, o = 's' + k + '.mp4'; await ff.writeFile(n, new Uint8Array(await it.blob.arrayBuffer()));
      const a = ['-hide_banner', '-v', 'info', '-y', '-ss', String(st), '-t', String(len), '-i', n];
      if(T.audio && !M.audio) a.push('-f', 'lavfi', '-t', String(len), '-i', 'anullsrc=r=48000:cl=stereo');
      a.push('-map', '0:v:0');
      if(T.audio) a.push('-map', M.audio ? '0:a:0' : '1:a:0', '-af', `aresample=48000:async=1,aformat=channel_layouts=stereo,apad,atrim=0:${len}`, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2'); else a.push('-an');
      a.push('-vf', vf, '-t', String(len), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', String(T.fps * 2), '-r', String(T.fps), '-video_track_timescale', '90000', '-shortest', o);
      const base = .1 + .75 * k / items.length, span = .75 / items.length;
      const pr = ({progress}) => onProg(base + span * Math.max(0, Math.min(1, progress || 0)), `Pregătesc clipul ${k + 1}/${items.length}…`);
      ff.on('progress', pr);
      try{ await ffRun(ff, a, signal); } finally { ff.off('progress', pr); await rm(n); }
      files.push(o); lens.push(len);
      onProg(base + span, `Pregătesc clipul ${k + 1}/${items.length}…`);
    }
    // 3) lipirea
    const out = 'montaj.mp4', fades = trans.map(t => t && t.type === 'fade');
    let total;
    if(!fades.some(Boolean)){
      await ff.writeFile('lista.txt', files.map(f => `file '${f}'`).join('\n'));
      await ffRun(ff, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', 'lista.txt', '-c', 'copy', '-movflags', '+faststart', out], signal);
      await rm('lista.txt'); total = lens.reduce((a, b) => a + b, 0);
    } else {
      const a = ['-hide_banner', '-v', 'info', '-y']; files.forEach(f => a.push('-i', f));
      // aceeași bază de timp pentru toate (altfel xfade refuză ieșirea unui concat)
      let fc = files.map((f, k) => `[${k}:v]settb=AVTB,setpts=PTS-STARTPTS[x${k}];` + (T.audio ? `[${k}:a]asetpts=PTS-STARTPTS[y${k}];` : '')).join('');
      let v = '[x0]', au = '[y0]', acc = lens[0];
      for(let k = 1; k < files.length; k++){
        const t = trans[k - 1] || {}, isF = t.type === 'fade', d = isF ? Math.min(+t.d || .4, lens[k - 1] / 2, lens[k] / 2, 1) : 0;
        const vo = `[v${k}]`, ao = `[a${k}]`, xi = `[x${k}]`, yi = `[y${k}]`;
        if(isF){ fc += `${v}${xi}xfade=transition=fade:duration=${d.toFixed(3)}:offset=${(acc - d).toFixed(3)}${vo};`; if(T.audio) fc += `${au}${yi}acrossfade=d=${d.toFixed(3)}${ao};`; acc += lens[k] - d; }
        else { fc += T.audio ? `${v}${au}${xi}${yi}concat=n=2:v=1:a=1${vo}${ao};` : `${v}${xi}concat=n=2:v=1:a=0${vo};`; acc += lens[k]; }
        v = vo; au = ao;
      }
      a.push('-filter_complex', fc.replace(/;$/, ''), '-map', v); if(T.audio) a.push('-map', au, '-c:a', 'aac', '-b:a', '128k');
      a.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(T.fps), '-movflags', '+faststart', out);
      const pr = ({progress}) => onProg(.85 + .1 * Math.max(0, Math.min(1, progress || 0)), 'Lipesc clipurile (cu treceri)…');
      ff.on('progress', pr); try{ await ffRun(ff, a, signal); } finally { ff.off('progress', pr); }
      total = acc;
    }
    for(const f of files) await rm(f);
    // 4) verificarea: fișierul se decodează integral, fără erori, și are durata așteptată
    onProg(.96, 'Verific fișierul…');
    const log = await ffRun(ff, ['-hide_banner', '-v', 'error', '-i', out, '-f', 'null', '-'], signal);
    if(log.some(l => /error|invalid|corrupt/i.test(l) && !/^\s*$/.test(l))) throw new Error('Fișierul final are erori la decodare: ' + log.slice(-2).join(' · ').slice(0, 200));
    const I = await ffProbe(ff, out, signal);
    if(!I.w || !(Math.abs((I.dur || 0) - total) < .6)) throw new Error(`Fișierul final nu are durata așteptată (${(I.dur || 0).toFixed(1)} s în loc de ${total.toFixed(1)} s).`);
    const data = await ff.readFile(out); await rm(out);
    const blob = new Blob([data.buffer], {type:'video/mp4'});
    const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer());
    if(String.fromCharCode(...head) !== 'ftyp') throw new Error('Fișierul final nu e un MP4 valid.');
    onProg(1, 'Gata.');
    return {blob, dur:+I.dur.toFixed(2), w:I.w, h:I.h, fps:T.fps, audio:I.audio, codec:I.codec, mixed:T.mixed};
  } catch(e){
    if(signal && signal.aborted) throw new MergeCancel();
    if(e && e.oom) ffKill();
    throw e;
  } finally {
    if(signal) signal.removeEventListener('abort', onAbort);
    if(ffNow === ff) for(const f of [...files, 'montaj.mp4', 'lista.txt']) await rm(f);
  }
}
// cadre dintr-un fișier pe care telefonul nu-l poate reda (rezervă pentru videoAnalyzer): JPEG la momentele cerute
async function ffFrames(blob, times, px = 320, signal){
  const ff = await ffLoad(); ffNow = ff;
  await ff.writeFile('fr', new Uint8Array(await blob.arrayBuffer()));
  const out = [];
  try{
    const I = await ffProbe(ff, 'fr', signal);
    for(let i = 0; i < times.length; i++){
      const t = Math.max(0, Math.min((I.dur || 0) - .05, times[i]));
      try{ await ffRun(ff, ['-hide_banner', '-y', '-ss', String(t), '-i', 'fr', '-frames:v', '1', '-vf', `scale=${px}:-2`, '-q:v', '3', 'f.jpg'], signal);
        const d = await ff.readFile('f.jpg'); const b = new Blob([d.buffer], {type:'image/jpeg'}); b.t = Math.round(t * 100) / 100; out.push(b); }
      catch(e){ if(e.cancel) throw e; }
    }
    return {frames:out, info:I};
  } finally { try{ await ff.deleteFile('fr'); }catch(e){} try{ await ff.deleteFile('f.jpg'); }catch(e){} }
}
