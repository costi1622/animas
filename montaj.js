/* Animas 1.9.0 — 🎞 Montaj AI (AI Video Continuity): 2–10 clipuri (din galerie sau din telefon) → analiză (telefon + Claude) →
   ordinea propusă cu scoruri și motive → o schimbi dacă vrei (ordine, tăieturi, trecere) → previzualizare → un singur MP4, salvat în galerie.
   Folosește: videoAnalyzer.js, continuityEngine.js, videoMerger.js. Nu schimbă galeria, clipurile existente sau Runware. */
'use strict';
const MJ_MAX = 10;
const MJ = {items:[], cl:null, M:null, plan:null, order:null, busy:'', ac:null, prog:0, ptext:'', out:null, maxH:1080, fit:'pad', usd:0, claudeErr:''};
const mjOk = () => MJ.items.filter(it => it.a && it.a.ok);
const mjMB = b => (b / 1e6).toFixed(b < 1e7 ? 1 : 0).replace('.', ',') + ' MB';
const mjSec = s => (Math.round(s * 100) / 100).toFixed(2).replace('.', ',') + ' s';
function mjOpen(ids){
  go('montaj');
  if(Array.isArray(ids) && ids.length) mjAddIds(ids);
}
function mjAddIds(ids){
  let n = 0;
  for(const id of ids){
    if(MJ.items.length >= MJ_MAX){ toast(`Cel mult ${MJ_MAX} clipuri într-un montaj.`); break; }
    if(MJ.items.some(it => it.clipId === id)) continue;
    const x = clips.find(c => c.id === id); if(!x || !x.vid) continue;
    MJ.items.push({id:uid(), src:'g', clipId:id, name:x.label || String(x.text || 'Clip').slice(0, 40), th:x.th || x.start, size:null}); n++;
  }
  if(n) mjDirty(); renderMontaj();
}
function mjAddFiles(inp){
  const fs = [...(inp.files || [])]; inp.value = '';
  for(const f of fs){
    if(MJ.items.length >= MJ_MAX){ toast(`Cel mult ${MJ_MAX} clipuri într-un montaj.`); break; }
    if(!/^video\//.test(f.type) && !/\.(mp4|mov|m4v|webm|mkv|3gp)$/i.test(f.name)){ toast(`„${f.name}” nu e un video.`); continue; }
    MJ.items.push({id:uid(), src:'f', name:f.name.replace(/\.[^.]+$/, '').slice(0, 40), file:f, size:f.size});
  }
  mjDirty(); renderMontaj();
}
async function mjBlob(it){ if(it.file) return it.file; const x = clips.find(c => c.id === it.clipId); const b = x && await DB.get(x.vid); if(!b) throw new Error(`„${it.name}” lipsește din telefon.`); return b; }
// orice schimbare a listei: analiza de ordine trebuie refăcută (analiza fiecărui clip rămâne)
function mjDirty(){ MJ.M = null; MJ.plan = null; MJ.order = null; MJ.cl = null; MJ.out = null; }
function mjRemove(id){
  const k = MJ.items.findIndex(it => it.id === id); if(k < 0 || MJ.busy) return;
  const it = MJ.items[k]; if(it.thUrl) URL.revokeObjectURL(it.thUrl);
  if(MJ.plan){ // păstrez ordinea și părerea lui Claude pentru clipurile rămase
    const ok = mjOk(), ai = ok.indexOf(it), keep = ok.map((x, i) => i).filter(i => i !== ai);
    MJ.items.splice(k, 1); MJ.items.forEach(x => { x.userType = null; });
    if(ai >= 0 && mjOk().length >= 2){ MJ.cl = MJ.cl ? ceSub(MJ.cl, keep) : null; MJ.order = MJ.order.filter(i => i !== ai).map(i => keep.indexOf(i)); mjReplan(); }
    else if(ai >= 0) mjDirty();
  } else MJ.items.splice(k, 1);
  renderMontaj();
}
function ceSub(cl, keep){
  const pick2 = A => keep.map(i => keep.map(j => A[i][j])), pick = A => keep.map(i => A[i]);
  return {...cl, pair:pick2(cl.pair), type:pick2(cl.type), why:pick2(cl.why), open:pick(cl.open), close:pick(cl.close), trim:pick(cl.trim), actions:pick(cl.actions),
    incompat:cl.incompat.filter(x => keep.includes(x.a) && keep.includes(x.b)).map(x => ({...x, a:keep.indexOf(x.a), b:keep.indexOf(x.b)})), order:null};
}
// ordinea curentă → plan (tranziții, scoruri, tăieturi); tăieturile schimbate de tine rămân
function mjReplan(){
  const ok = mjOk(); if(ok.length < 2 || !MJ.order){ MJ.plan = null; return; }
  if(!MJ.M) MJ.M = ceMatrix(ok.map(it => it.a));
  MJ.plan = cePlan(ok.map(it => ({...it.a, name:it.name})), MJ.M, MJ.cl, MJ.order);
  ok.forEach((it, i) => { if(!it.userTrim){ it.st = MJ.plan.trims[i].start; it.en = MJ.plan.trims[i].end; } it.trimWhy = MJ.plan.trims[i].why; });
  MJ.plan.trans.forEach(t => { const it = ok[t.from]; t.type = it.userType && it.userType[t.to] || t.type; });
}
function mjMove(id, d){
  if(!MJ.order || MJ.busy) return;
  const ok = mjOk(), ai = ok.findIndex(it => it.id === id), p = MJ.order.indexOf(ai), q = p + d; if(p < 0 || q < 0 || q >= MJ.order.length) return;
  [MJ.order[p], MJ.order[q]] = [MJ.order[q], MJ.order[p]]; MJ.manual = true; MJ.out = null; mjReplan(); renderMontaj();
}
function mjTrim(id, which, v){
  const it = MJ.items.find(x => x.id === id); if(!it || !it.a) return;
  const D = it.a.D, x = Math.max(0, Math.min(D * .45, +String(v).replace(',', '.') || 0));
  it[which] = +x.toFixed(2); if(D - (it.st || 0) - (it.en || 0) < .5){ it[which] = Math.max(0, +(D - .5 - (which === 'st' ? it.en || 0 : it.st || 0)).toFixed(2)); toast('Rămân cel puțin 0,5 s din clip.'); }
  it.userTrim = true; MJ.out = null; renderMontaj();
}
function mjType(fromId, toIdx, v){ const it = MJ.items.find(x => x.id === fromId); if(!it) return; it.userType = it.userType || {}; it.userType[toIdx] = v; MJ.out = null; mjReplan(); renderMontaj(); }
function mjProg(p, t){ MJ.prog = p; MJ.ptext = t || MJ.ptext; const b = $('#mjBar'), s = $('#mjPtxt'); if(b) b.style.width = Math.round(p * 100) + '%'; if(s) s.textContent = MJ.ptext + ' ' + Math.round(p * 100) + '%'; }
function mjCancel(){ if(MJ.ac) MJ.ac.abort(); }
/* ── analiza: fiecare clip pe rând (telefon), apoi Claude, apoi ordinea ── */
async function mjAnalyze(){
  if(MJ.busy) return;
  if(MJ.items.length < 2) return toast('Alege cel puțin 2 clipuri.');
  MJ.prog = 0; MJ.ptext = '';
  MJ.busy = 'analiza'; MJ.ac = new AbortController(); const sig = MJ.ac.signal; MJ.out = null; MJ.claudeErr = ''; renderMontaj();
  try{
    const todo = MJ.items.filter(it => !it.a || !it.a.ok);
    for(let k = 0; k < todo.length; k++){
      const it = todo[k]; mjProg(.75 * k / Math.max(1, todo.length), `Analizez „${it.name}” (${k + 1}/${todo.length}): cadre, postură…`);
      const b = await mjBlob(it); it.size = b.size;
      it.a = await analyzeClip({name:it.name, blob:b}, {signal:sig});
      if(it.a.ok && !it.th && !it.thUrl){ it.thUrl = URL.createObjectURL(it.a.frames[it.a.rep[0]].blob); }
      renderMontaj();
    }
    const ok = mjOk(), bad = MJ.items.filter(it => it.a && !it.a.ok);
    if(bad.length) toast(`${bad.length === 1 ? '1 clip nu se poate citi' : bad.length + ' clipuri nu se pot citi'}: ${bad.map(x => x.name).join(', ')}. Scoate-l din listă.`, 6500);
    if(ok.length < 2) throw new Error('Rămân mai puțin de 2 clipuri care se pot citi.');
    mjProg(.78, 'Compar finalurile cu începuturile…');
    MJ.M = ceMatrix(ok.map(it => it.a));
    MJ.cl = null;
    if(S.clKey){
      mjProg(.82, 'Claude analizează cadrele…');
      try{ const r = await ceClaude(ok.map(it => it.a), sig); MJ.usd += r.usd || 0; MJ.cl = ceValidate(r.raw, ok.map(it => it.a)); }
      catch(e){ if(sig.aborted) throw new MergeCancel(); MJ.claudeErr = String(e.message || e).slice(0, 160); }
    } else MJ.claudeErr = 'fără cheia Anthropic (Setări)';
    ok.forEach(it => { it.userTrim = false; it.userType = null; });
    MJ.order = ceOrder(MJ.M, MJ.cl); MJ.manual = false; mjReplan();
    mjProg(1, 'Gata.');
  } catch(e){
    if(e && e.cancel || sig.aborted) toast('Analiza a fost anulată.'); else toast(String(e.message || e), 6000);
  } finally { MJ.busy = ''; MJ.ac = null; renderMontaj(); }
}
// ── previzualizarea: un singur <video>, clipurile pe rând, cu tăieturile (fără codare; fondu-urile apar doar în export)
async function mjPreview(id){
  const it = MJ.items.find(x => x.id === id); if(!it) return;
  const b = await mjBlob(it).catch(e => { toast(e.message); return null; }); if(!b) return;
  if(viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = URL.createObjectURL(b);
  sheet(`<video src="${viewUrl}" controls autoplay playsinline class="player"></video><div class="info"><b>${esc(it.name)}</b>${it.a && it.a.ok ? ' · ' + mjMetaLine(it) : ''}</div>`);
}
async function mjPreviewAll(){
  const ok = mjOk(); if(!MJ.order || ok.length < 2) return;
  const seq = MJ.order.map(i => ok[i]);
  sheet(`<video id="mjPv" controls autoplay playsinline class="player"></video><p class="muted" id="mjPvT"></p><p class="muted">Previzualizarea redă clipurile pe rând, cu tăieturile. Trecerile cu fondu și potrivirea formatelor apar doar în videoclipul final.</p>`);
  const v = $('#mjPv'); let k = -1, url = null;
  const next = async () => {
    k++; if(k >= seq.length || !document.body.contains(v)){ if(url) URL.revokeObjectURL(url); return; }
    const it = seq[k], b = await mjBlob(it); if(url) URL.revokeObjectURL(url); url = URL.createObjectURL(b);
    v.src = url; $('#mjPvT').textContent = `${k + 1}/${seq.length} · ${it.name}`;
    v.onloadedmetadata = () => { try{ v.currentTime = it.st || 0; }catch(e){} v.play().catch(() => {}); };
  };
  v.ontimeupdate = () => { const it = seq[k]; if(it && v.duration && v.currentTime >= v.duration - (it.en || 0) - .03) { v.pause(); next(); } };
  v.onended = () => next();
  next();
}
/* ── exportul: FFmpeg în telefon → verificare → galerie ── */
async function mjExport(){
  const ok = mjOk(); if(MJ.busy || !MJ.order || ok.length < 2) return;
  const seq = MJ.order.map(i => ok[i]);
  if(!window.__noConfirm && !confirm(`Fac videoclipul final din ${seq.length} clipuri, aici în telefon (FFmpeg). Durează câteva minute; poți anula oricând. Continui?`)) return;
  MJ.prog = 0; MJ.ptext = '';
  MJ.busy = 'export'; MJ.ac = new AbortController(); const sig = MJ.ac.signal; MJ.out = null; renderMontaj();
  const t0 = performance.now();
  try{
    const items = []; for(const it of seq) items.push({name:it.name, blob:await mjBlob(it), startTrim:it.st || 0, endTrim:it.en || 0});
    const trans = seq.slice(1).map((it, k) => { const t = MJ.plan.trans[k]; return {type:t.type, d:t.d || .4}; });
    const r = await mergeVideos(items, trans, {maxH:MJ.maxH, fit:MJ.fit, signal:sig, onProg:mjProg});
    items.length = 0;
    // verificarea în telefon: se poate reda?
    mjProg(.99, 'Verific redarea…');
    const play = await new Promise(res => { const u = URL.createObjectURL(r.blob), v = document.createElement('video'); v.muted = true; v.preload = 'metadata'; v.src = u;
      const end = x => { URL.revokeObjectURL(u); v.removeAttribute('src'); res(x); }; v.onloadedmetadata = () => end(v.videoWidth > 0 && v.duration > 0); v.onerror = () => end(false); setTimeout(() => end(null), 8000); });
    // în galerie
    const vid = await putBlob('vid', r.blob);
    let th = null; try{ const f = await videoFrames(r.blob, 1); if(f[0]) th = await putBlob('img', await toJpeg(f[0], 720, .85)); }catch(e){}
    if(!th){ const f0 = ok[MJ.order[0]].a.frames[0]; th = await putBlob('img', f0.blob); }
    const src = seq.map(it => it.clipId ? clips.find(c => c.id === it.clipId) : null), ch = [...new Set(src.map(x => x && x.charId).filter(Boolean))];
    const clip = {id:uid(), at:Date.now(), charId:ch.length === 1 && src.every(x => x && x.charId === ch[0]) ? ch[0] : null, text:'Montaj AI: ' + seq.map(it => it.name).join(' → '),
      label:`Montaj AI · ${seq.length} clipuri`, prompt:'', vid, th, start:th, sec:Math.round(r.dur * 10) / 10, res:Math.min(r.w, r.h) + 'p', aspect:vaAspect(r.w, r.h), mk:'Montaj AI', cost:0, audio:r.audio,
      montaj:{from:seq.map(it => it.clipId || null), names:seq.map(it => it.name), trims:seq.map(it => [it.st || 0, it.en || 0]), trans:trans.map(t => t.type), w:r.w, h:r.h, fps:r.fps, size:r.blob.size, overall:MJ.plan.overall}};
    clips.unshift(clip); await saveClips();
    MJ.out = {id:clip.id, ...r, size:r.blob.size, play, secs:Math.round((performance.now() - t0) / 1000)};
    toast('Videoclipul final e gata și e în galerie.', 4000);
  } catch(e){
    if(e && e.cancel || sig.aborted) toast('Exportul a fost anulat. Nimic nu s-a salvat.');
    else toast(String(e.message || e), 8000);
  } finally { MJ.busy = ''; MJ.ac = null; renderMontaj(); }
}
function mjMetaLine(it){
  const m = it.a.meta;
  return [mjSec(it.a.D), m.w && m.h ? `${m.w}×${m.h}` : '', m.fps ? m.fps + ' fps' : '', m.codec || '', m.audio === true ? 'cu sunet' : m.audio === false ? 'fără sunet' : '', mjMB(m.size || it.size || 0)].filter(Boolean).join(' · ');
}
function mjBadge(t){
  if(!t) return '';
  const pct = Math.round(t.score * 100), L = t.level;
  return `<div class="mjt ${L.k}"><b>${pct}%</b> ${L.t}${t.claude != null ? ` <span class="muted">(măsurat ${Math.round(t.local * 100)}%, Claude ${Math.round(t.claude * 100)}%)</span>` : ' <span class="muted">(doar măsurători)</span>'}
    <select onchange="mjType('${mjOk()[t.from].id}', ${t.to}, this.value)" ${MJ.busy ? 'disabled' : ''}><option value="cut" ${t.type === 'cut' ? 'selected' : ''}>tăietură directă</option><option value="fade" ${t.type === 'fade' ? 'selected' : ''}>fondu 0,4 s</option></select>
    ${t.why ? `<div class="muted">${esc(t.why)}</div>` : ''}</div>`;
}
function renderMontaj(){
  const el = $('#mjBody'); if(!el || $('#v-montaj').hidden) return;
  const ok = mjOk(), busy = !!MJ.busy, P = MJ.plan;
  const seq = P ? MJ.order.map(i => ok[i]).concat(MJ.items.filter(it => !ok.includes(it))) : MJ.items;
  const row = (it, pos) => {
    const a = it.a, isOk = a && a.ok, t = P && pos > 0 && pos < MJ.order.length ? P.trans[pos - 1] : null;
    return `${t ? mjBadge(t) : ''}<div class="mjrow ${a && !a.ok ? 'bad' : ''}">
      <div class="mjth">${it.th ? `<img data-k="${it.th}" alt="">` : it.thUrl ? `<img src="${it.thUrl}" alt="">` : '<span>🎞</span>'}${P && isOk ? `<span class="pos">${pos + 1}</span>` : ''}</div>
      <div class="mjmid"><b>${esc(it.name)}</b> <span class="muted">${it.src === 'f' ? '· din telefon' : '· din galerie'}</span>
        <div class="muted">${isOk ? mjMetaLine(it) : a ? '<span class="bad">' + esc(a.err) + '</span>' : (it.size ? mjMB(it.size) + ' · ' : '') + 'neanalizat'}</div>
        ${P && isOk ? `<div class="mjtrim">Taie la început <input type="number" inputmode="decimal" step="0.05" min="0" value="${it.st || 0}" onchange="mjTrim('${it.id}', 'st', this.value)" ${busy ? 'disabled' : ''}> s · la final <input type="number" inputmode="decimal" step="0.05" min="0" value="${it.en || 0}" onchange="mjTrim('${it.id}', 'en', this.value)" ${busy ? 'disabled' : ''}> s · rămân ${mjSec(a.D - (it.st || 0) - (it.en || 0))}${it.userTrim ? ' <span class="muted">(schimbat de tine)</span>' : ''}</div>` : ''}
        ${P && isOk && MJ.cl && MJ.cl.actions[ok.indexOf(it)] ? `<div class="muted">Claude: ${esc(MJ.cl.actions[ok.indexOf(it)])}</div>` : ''}
        ${it.trimWhy && it.trimWhy.length ? `<div class="muted">Tăietură: ${esc(it.trimWhy.join('; '))}</div>` : ''}</div>
      <div class="mjbtn"><button class="sm ghost" onclick="mjPreview('${it.id}')" aria-label="Vezi">▶</button>
        ${P && isOk ? `<button class="sm ghost" onclick="mjMove('${it.id}', -1)" ${busy || pos === 0 ? 'disabled' : ''} aria-label="Mai sus">⬆</button><button class="sm ghost" onclick="mjMove('${it.id}', 1)" ${busy || pos >= MJ.order.length - 1 ? 'disabled' : ''} aria-label="Mai jos">⬇</button>` : ''}
        <button class="sm ghost danger" onclick="mjRemove('${it.id}')" ${busy ? 'disabled' : ''} aria-label="Scoate">✕</button></div></div>`;
  };
  const metas = ok.map(it => it.a.meta), mixed = metas.length > 1 && new Set(metas.map(m => (m.w / m.h).toFixed(2))).size > 1;
  el.innerHTML = `
    <p class="muted">Alege 2–${MJ_MAX} clipuri. Aplicația le analizează (în telefon + Claude pe câteva cadre), propune ordinea și tăieturile, apoi face un singur MP4 aici în telefon (FFmpeg), fără server și fără Runware.</p>
    <div class="row wrap"><button class="sm" onclick="mjPickGallery()" ${busy || MJ.items.length >= MJ_MAX ? 'disabled' : ''}>+ Din galerie</button>
      <label class="btn sm ghost ${busy || MJ.items.length >= MJ_MAX ? 'off' : ''}">+ Din telefon<input type="file" accept="video/*" multiple hidden onchange="mjAddFiles(this)" ${busy ? 'disabled' : ''}></label>
      <span class="muted">${MJ.items.length}/${MJ_MAX}</span></div>
    ${busy ? `<div class="mjprog"><div class="bar"><i id="mjBar" style="width:${Math.round(MJ.prog * 100)}%"></i></div><span id="mjPtxt">${esc(MJ.ptext)} ${Math.round(MJ.prog * 100)}%</span> <button class="sm danger" onclick="mjCancel()">Anulează</button></div>` : ''}
    ${P ? `<div class="mjsum ${P.level.k}"><b>Ordinea ${MJ.manual ? 'ta' : 'propusă'}: ${Math.round(P.overall * 100)}%</b> (${P.level.t}) · ${MJ.cl ? 'măsurători + Claude' + (MJ.cl.confidence != null ? `, încrederea lui ${Math.round(MJ.cl.confidence * 100)}%` : '') : 'doar măsurătorile din telefon'}${MJ.claudeErr ? `<div class="warn">Claude nu a analizat (${esc(MJ.claudeErr)}): ordinea e doar după măsurători; verific-o.</div>` : ''}
      ${P.warn.length ? `<ul class="warn">${P.warn.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}<div class="muted">Scorurile sunt estimări ale aplicației, nu probabilități. 90–100% foarte bună · 75–89% bună · 50–74% incertă · sub 50% de verificat.</div></div>` : ''}
    <div class="mjlist">${MJ.items.length ? seq.map((it, p) => row(it, p)).join('') : '<div class="empty">Niciun clip ales.</div>'}</div>
    ${P ? `<div class="grid2"><label>Rezoluția<select onchange="MJ.maxH = +this.value; MJ.out = null; renderMontaj()" ${busy ? 'disabled' : ''}><option value="1080" ${MJ.maxH === 1080 ? 'selected' : ''}>ca la clipuri (cel mult 1080p)</option><option value="720" ${MJ.maxH === 720 ? 'selected' : ''}>720p (mai rapid, mai puțină memorie)</option></select></label>
      ${mixed ? `<label>Formate diferite<select onchange="MJ.fit = this.value; MJ.out = null; renderMontaj()" ${busy ? 'disabled' : ''}><option value="pad" ${MJ.fit === 'pad' ? 'selected' : ''}>păstrează tot (margini negre unde trebuie)</option><option value="crop" ${MJ.fit === 'crop' ? 'selected' : ''}>umple ecranul (taie marginile)</option></select></label>` : ''}</div>` : ''}
    <div class="row wrap acts">
      <button onclick="mjAnalyze()" ${busy || MJ.items.length < 2 ? 'disabled' : ''}>${P ? '🧠 Reanalizează' : '🧠 Analizează'}</button>
      ${P ? `<button class="ghost" onclick="mjPreviewAll()" ${busy ? 'disabled' : ''}>▶ Previzualizează</button><button onclick="mjExport()" ${busy ? 'disabled' : ''}>🎬 Generează videoclipul final</button>` : ''}
      ${!busy && MJ.items.length ? `<button class="ghost danger" onclick="mjClear()">Golește lista</button>` : ''}
    </div>
    ${MJ.usd ? `<p class="muted">Claude, în acest montaj: ${usdC(MJ.usd)}.</p>` : ''}
    ${MJ.out ? `<section class="box mjout"><h3>✓ Videoclipul final</h3><p>${mjSec(MJ.out.dur)} · ${MJ.out.w}×${MJ.out.h} · ${MJ.out.fps} fps · ${MJ.out.audio ? 'cu sunet' : 'fără sunet'} · ${mjMB(MJ.out.size)} · MP4 (H.264${MJ.out.audio ? ' + AAC' : ''}) · făcut în ${MJ.out.secs} s</p>
      <p class="muted">Verificat: decodat integral fără erori, durata corectă${MJ.out.play === true ? ', se redă în telefon' : MJ.out.play === false ? '; <span class="warn">telefonul nu l-a putut deschide pentru redare</span>' : ''}.</p>
      <div class="row wrap"><button onclick="openClip('${MJ.out.id}')">▶ Vezi</button><button class="ghost" onclick="saveClip('${MJ.out.id}')">Salvează în telefon</button><button class="ghost" onclick="go('galerie')">În galerie</button></div></section>` : ''}`;
  hydrate(el);
}
function mjClear(){ if(MJ.busy) return; MJ.items.forEach(it => it.thUrl && URL.revokeObjectURL(it.thUrl)); MJ.items = []; mjDirty(); MJ.usd = 0; renderMontaj(); }
function mjPickGallery(){
  const L = clips.filter(x => x.vid && !MJ.items.some(it => it.clipId === x.id));
  const room = MJ_MAX - MJ.items.length;
  sheet(`<h2>Alege clipurile</h2><p class="muted">Cel mult ${room} ${room === 1 ? 'clip' : 'clipuri'} în plus.</p>
    ${L.length ? `<div class="cspick">${L.map(x => `<label class="csrow mjpick"><input type="checkbox" value="${x.id}" onchange="mjPickCount(${room})"><img data-k="${x.th || x.start}" alt=""><div><b>${esc(x.label || String(x.text || 'clip').slice(0, 60))}</b><br><span class="muted">${x.sec || '?'} s · ${x.res || ''} · ${new Date(x.at).toLocaleDateString('ro-RO')}${x.storyId ? ' · scenă din poveste' : ''}</span></div></label>`).join('')}</div>
      <div class="row"><button id="mjPickGo" disabled onclick="mjAddIds([...document.querySelectorAll('.mjpick input:checked')].map(i => i.value)); closeSheet()">Adaugă</button></div>` : '<p>Nu mai sunt clipuri în galerie.</p>'}`);
  hydrate($('#sheet'));
}
function mjPickCount(room){ const n = document.querySelectorAll('.mjpick input:checked').length, b = $('#mjPickGo'); if(n > room){ event.target.checked = false; toast(`Cel mult ${MJ_MAX} clipuri într-un montaj.`); return mjPickCount(room); } if(b){ b.disabled = !n; b.textContent = n ? `Adaugă (${n})` : 'Adaugă'; } }
