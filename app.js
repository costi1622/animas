/* Animas 1.0.1 — poză + ce vrei să facă personajul → clip video realist.
   Text: doar Claude. Imagine și video: Runware. Fața: ArcFace (din Taifas). Totul rămâne în telefon (IndexedDB). */
'use strict';
window.__animas = true;
const APP_VER = '1.2';

/* ───────── utilitare ───────── */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = ms => new Promise(r => setTimeout(r, window.__fast ? Math.min(ms, 200) : ms));   // testele: așteptări scurte
const usd = (v, d = 2) => '$' + (+v || 0).toFixed(d).replace('.', ',');
const usdC = v => usd(v, v >= .005 && v < .1 ? 3 : 2);   // 1.1: sub o jumătate de cent → $0,00 (nu $0,000)
let toastT;
function toast(t, ms = 3200){ const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), ms); }
const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('poza nu se poate citi')); i.src = u; });
const cvBlob = (cv, q = .92) => new Promise(r => cv.toBlob(r, 'image/jpeg', q));
const b64 = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
async function toJpeg(blob, px = 1280, q = .92){
  const u = URL.createObjectURL(blob);
  try{
    const im = await loadImg(u), s = Math.min(1, px / Math.max(im.naturalWidth, im.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * s); cv.height = Math.round(im.naturalHeight * s);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, cv.width, cv.height);
    return await cvBlob(cv, q);
  } finally { URL.revokeObjectURL(u); }
}
const ASPECT = {'9:16':9 / 16, '16:9':16 / 9, '1:1':1};
// decupează poza la formatul ales, cu fața în cadru (cea mai mare zonă posibilă), latura lungă cel mult 1280
async function cropAspect(blob, aspect, box){
  const u = URL.createObjectURL(blob);
  try{
    const im = await loadImg(u), W = im.naturalWidth, H = im.naturalHeight, r = ASPECT[aspect] || 9 / 16;
    let w = W, h = Math.round(W / r); if(h > H){ h = H; w = Math.round(H * r); }
    const cx = box ? box.x + box.w / 2 : W / 2, cy = box ? box.y + box.h * .9 : H / 2;
    const x = Math.round(Math.max(0, Math.min(W - w, cx - w / 2))), y = Math.round(Math.max(0, Math.min(H - h, cy - h / 2.6)));
    const s = Math.min(1, 1280 / Math.max(w, h)), cv = document.createElement('canvas');
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, x, y, w, h, 0, 0, cv.width, cv.height);
    return await cvBlob(cv, .93);
  } finally { URL.revokeObjectURL(u); }
}
const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const when = t => new Date(t).toLocaleString('ro-RO', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'});

/* ───────── stocare: IndexedDB „animas”, un depozit cheie→valoare ───────── */
const DB = {
  db:null,
  open(){ return new Promise((res, rej) => { const r = indexedDB.open('animas', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { this.db = r.result; res(); }; r.onerror = () => rej(r.error); }); },
  _q(mode, fn){ return new Promise((res, rej) => { const q = fn(this.db.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  get(k){ return this._q('readonly', s => s.get(k)); },
  set(k, v){ return this._q('readwrite', s => s.put(v, k)); },
  del(k){ return this._q('readwrite', s => s.delete(k)); }
};
const DEF = {clKey:'', rwKey:'', clModel:'claude-sonnet-5-5', useClaude:'on', checkSteps:'on', mk:'kling4f', res:'720p', sec:5, audio:true, aspect:'9:16', checkFace:'on', costs:{days:{}, claude:0, runware:0}};
let S = {...DEF}, chars = [], clips = [], jobs = [];
const saveS = () => DB.set('settings', S);
const saveChars = () => DB.set('chars', chars);
const saveClips = () => DB.set('clips', clips);
const saveJobs = () => DB.set('jobs', jobs);
async function putBlob(prefix, b){ const k = prefix + ':' + uid(); await DB.set(k, b); return k; }
function addCost(kind, v){
  if(!(v > 0)) return; const c = S.costs || (S.costs = {days:{}, claude:0, runware:0}), d = dayKey();
  c.days[d] = Math.round(((c.days[d] || 0) + v) * 1e6) / 1e6; c[kind] = Math.round(((c[kind] || 0) + v) * 1e6) / 1e6; saveS(); renderCostLine();
}
const charById = id => chars.find(c => c.id === id);

/* ───────── pornire ───────── */
async function boot(){
  await DB.open();
  S = {...DEF, ...((await DB.get('settings')) || {})};
  chars = (await DB.get('chars')) || []; clips = (await DB.get('clips')) || []; jobs = (await DB.get('jobs')) || [];
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  $('#ver').textContent = APP_VER;
  if(!chars.length || !S.rwKey) setTimeout(() => { if(!S.rwKey) toast('Pune cheile în Setări sau preia-le din Taifas.', 5000); }, 800);
  C.charId = (chars[0] || {}).id || null;
  go(location.hash.slice(1) || 'creeaza');
  for(const j of jobs) runJob(j, true);
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}
function go(v){
  if(!['creeaza', 'galerie', 'personaje', 'setari'].includes(v)) v = 'creeaza';
  $$('.view').forEach(x => x.hidden = x.id !== 'v-' + v);
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  history.replaceState(null, '', '#' + v);
  ({creeaza:renderCreate, galerie:renderGallery, personaje:renderChars, setari:renderSettings})[v]();
}

/* ═════════ Creează ═════════ */
const C = {charId:null, start:null, startSrc:'', score:null, text:'', prompt:'', promptKey:'', edited:false, nota:'', scene:'', steps:[], fits:true, secSuggest:null, missing:null};
const promptKey = (mk = S.mk) => [C.text, mk, mk === SCHITA.model ? '' : S.sec, mk === SCHITA.model ? '' : S.audio, C.startSrc].join('|');
function renderCreate(){
  const ch = $('#cChars');
  ch.innerHTML = chars.map(c => `<button class="chip ${c.id === C.charId ? 'on' : ''}" onclick="pickChar('${c.id}')"><img data-k="${c.photo}" alt=""><span>${esc(c.name)}</span></button>`).join('')
    + `<button class="chip ${!C.charId ? 'on' : ''}" onclick="pickChar('')"><span class="ph">∅</span><span>Fără personaj</span></button>`
    + `<button class="chip add" onclick="go('personaje')"><span class="ph">+</span><span>Adaugă</span></button>`;
  hydrate(ch);
  renderStart(); renderOpts(); renderPrompt(); renderJobs(); renderLast();
}
function pickChar(id){ C.charId = id || null; C.start = null; C.startSrc = ''; C.score = null; renderCreate(); }
function renderStart(){
  const c = charById(C.charId), box = $('#cStart');
  $('#btnProfil').disabled = !c;
  $('#btnGen').disabled = !S.rwKey;
  if(!C.start){ box.innerHTML = `<div class="empty">${c ? 'Alege poza de start: profilul, o poză urcată sau o scenă generată.' : 'Urcă o poză de start.'}</div>`; return; }
  const u = URL.createObjectURL(C.start);
  box.innerHTML = `<img src="${u}" alt="poza de start" class="aspect-${S.aspect.replace(':', 'x')}"><div class="badge" id="cScore">${scoreTxt(C.score)}</div>`;
}
const scoreTxt = s => s === undefined ? 'Fața: se măsoară…' : s == null ? (C.charId ? 'Fața nu se vede' : '') : `Fața: ${s}%${s >= ID_OK ? ' · aceeași persoană' : ' · seamănă slab'}`;
async function setStart(blob, src){
  C.startRaw = blob; C.startSrc = src + ':' + uid();
  await applyAspect();
}
async function applyAspect(){
  if(!C.startRaw) return;
  let box = null; try{ const f = await faceOf(C.startRaw); box = f && f.box; }catch(e){}
  C.start = await cropAspect(C.startRaw, S.aspect, box); C.score = C.charId && S.checkFace === 'on' ? undefined : null; renderStart();
  if(C.score === undefined){ const c = charById(C.charId); try{ C.score = await idScore(c, C.start); }catch(e){ C.score = null; } const el = $('#cScore'); if(el) el.textContent = scoreTxt(C.score); }
}
async function useProfile(){ const c = charById(C.charId); if(!c) return; const b = await DB.get(c.photo); if(b) setStart(b, 'profil'); }
function uploadStart(inp){ const f = inp.files && inp.files[0]; inp.value = ''; if(f) setStart(f, 'urcata'); }
function openGen(){ $('#genBox').hidden = !$('#genBox').hidden; if(!$('#genBox').hidden) $('#genText').focus(); }
async function genStart(){
  const text = $('#genText').value.trim(); if(!text) return toast('Scrie scena pentru poză.');
  const c = charById(C.charId), btn = $('#btnGenGo'); btn.disabled = true; btn.textContent = 'Scriu promptul…';
  try{
    let prompt = text;
    if(S.useClaude === 'on' && S.clKey){ const r = await clImagePrompt({text, persona:c && c.desc, aspect:S.aspect, hasFace:!!(c && c.face)}); if(!r.image) throw new Error(r.nota || 'Claude a refuzat cererea.'); prompt = r.image; }
    const refs = [];
    if(c){ const full = await DB.get(c.full || c.photo).catch(() => null); if(full) refs.push(await dataUri(full, 1024)); const fc = c.face ? await DB.get(c.face).catch(() => null) : null; if(fc) refs.push(await dataUri(fc, 768)); }
    const [w, h] = {'9:16':[720, 1280], '16:9':[1280, 720], '1:1':[1024, 1024]}[S.aspect];
    btn.textContent = 'Fac poza…';
    const task = kleinTask(prompt, refs, w, h); await rwSend(task);
    const x = await rwWait(task.taskUUID, 'image', {onTick:s => btn.textContent = `Fac poza… ${s} s`});
    if(+x.cost > 0) addCost('runware', +x.cost);
    const b = x.imageBase64Data ? await (await fetch('data:image/jpeg;base64,' + x.imageBase64Data)).blob() : await fetchBlob(x.imageURL, 'image/jpeg');
    $('#genBox').hidden = true; await setStart(b, 'generata'); toast('Poza de start e gata' + (+x.cost > 0 ? ' · ' + usdC(+x.cost) : '') + '.');
  }catch(e){ toast(String(e.message || e), 6000); }
  finally{ btn.disabled = false; btn.textContent = 'Generează poza'; }
}
function renderOpts(){
  const m = MODELE[S.mk] || MODELE.kling4f; if(!MODELE[S.mk]) S.mk = 'kling4f';
  $('#oModel').innerHTML = Object.entries(MODELE).filter(([k]) => k !== 'pvideo2').map(([k, x]) => `<option value="${k}" ${k === S.mk ? 'selected' : ''}>${x.nume} — ${x.rol}</option>`).join('');
  if(!m.res.hasOwnProperty(S.res)) S.res = Object.keys(m.res)[0];
  $('#oRes').innerHTML = Object.keys(m.res).map(r => `<option ${r === S.res ? 'selected' : ''}>${r}</option>`).join('');
  if(!m.dur.includes(+S.sec)) S.sec = m.dur.includes(m.def) ? m.def : m.dur[0];
  $('#oSec').innerHTML = m.dur.map(s => `<option value="${s}" ${s === +S.sec ? 'selected' : ''}>${s} s</option>`).join('');
  if(!m.aspects.includes(S.aspect)) S.aspect = m.aspects[0];
  $('#oAspect').innerHTML = ['9:16', '16:9', '1:1'].map(a => `<button class="seg ${a === S.aspect ? 'on' : ''}" ${m.aspects.includes(a) ? '' : 'disabled'} onclick="setAspect('${a}')">${a}</button>`).join('');
  const au = $('#oAudio'); au.disabled = m.audio !== 'switch'; au.checked = m.audio === 'always' ? true : m.audio === 'off' ? false : !!S.audio;
  $('#oAudioNote').textContent = m.audio === 'always' ? 'Kling pune mereu sunet; îl descrii în prompt.' : m.audio === 'off' ? 'fără sunet' : '';
  renderCostLine(); saveS();
}
function setOpt(k, v){ S[k] = k === 'sec' ? +v : k === 'audio' ? !!v : v; renderOpts(); }
async function setAspect(a){ S.aspect = a; renderOpts(); await applyAspect(); }
function clipCost(final = true){
  const m = MODELE[S.mk];
  return final ? costClip(S.mk, S.res, +S.sec, m.audio === 'always' || (m.audio === 'switch' && S.audio), false)
    : costClip(SCHITA.model, SCHITA.res, Math.min(8, Math.max(4, +S.sec)), false, true);
}
function renderCostLine(){
  const el = $('#oCost'); if(!el) return;
  const f = clipCost(true), d = clipCost(false), today = ((S.costs || {}).days || {})[dayKey()] || 0;
  el.innerHTML = `Schiță: <b>${usdC(d.usd)}</b> · Final: <b>${f.min ? 'de la ' : ''}${usdC(f.usd)}</b>${f.min ? ' <span class="muted">(preț 1080p nepublicat; costul real apare după clip)</span>' : ''} · Azi: ${usdC(today)}`;
  const bd = $('#btnDraft'), bf = $('#btnFinal'); if(bd) bd.textContent = `Schiță · ${usdC(d.usd)}`; if(bf) bf.textContent = `Clip final · ${f.min ? '≥' : ''}${usdC(f.usd)}`;
}
function renderPrompt(){
  $('#cText').value = C.text;
  const has = !!C.prompt, stale = has && !C.edited && C.promptKey !== promptKey() && C.promptKey !== promptKey(SCHITA.model);
  $('#pBox').hidden = !has;
  if(has) renderLen();
  if(has){ $('#pText').value = C.prompt; $('#pNota').textContent = (C.nota || '') + (stale ? ' (se rescrie la trimitere: s-au schimbat textul sau setările)' : ''); }
  // 1.1: planul pe secunde, cum îl va juca modelul
  const ps = $('#pSteps');
  ps.innerHTML = has && C.steps.length ? '<label>Planul pe secunde (ce va face, în ordine)</label><ol class="steps">' + C.steps.map(x => `<li><span class="sec">${fmtS(x.t0)}–${fmtS(x.t1)} s</span> ${esc(x.ro || x.en)}</li>`).join('') + '</ol>'
    + (!C.fits ? `<div class="warn">Pașii nu încap firesc în ${S.sec} s${C.secSuggest ? `: recomand ${C.secSuggest} s. <button class="sm" onclick="useSuggest()">Pune ${C.secSuggest} s</button>` : '. Scurtează textul sau alege o durată mai mare.'}</div>` : '')
    + (C.missing && C.missing.length ? `<div class="muted">Accentuat față de încercarea anterioară: ${esc(C.missing.join('; '))}</div>` : '') : '';
}
const fmtS = v => String(Math.round(v * 10) / 10).replace('.', ',');
async function useSuggest(){ if(!C.secSuggest) return; setOpt('sec', C.secSuggest); const b = $('#btnPrep'); b.disabled = true; b.textContent = 'Claude refă planul…'; try{ await preparePrompt(); }catch(e){ toast(e.message, 6000); } finally{ b.disabled = false; b.textContent = 'Pregătește promptul'; } }
function onText(v){ C.text = v; C.missing = null; }
function onPromptEdit(v){ C.prompt = v; C.edited = true; renderLen(); }
// 1.2: câte caractere are promptul (Runware: cel mult 2.000)
function renderLen(){ const el = $('#pLen'); if(!el) return; const n = String(C.prompt || '').trim().length; el.className = n > PROMPT_MAX ? 'errtxt' : 'muted'; el.textContent = `${n.toLocaleString('ro-RO')} / ${PROMPT_MAX.toLocaleString('ro-RO')} caractere` + (n > PROMPT_MAX ? ' — prea lung: Runware nu-l primește. Scurtează-l.' : ''); }
async function preparePrompt(mk = S.mk, sec = +S.sec, audio = S.audio){
  if(!C.start) throw new Error('Alege întâi poza de start.');
  if(!C.text.trim()) throw new Error('Scrie ce să facă personajul.');
  if(S.useClaude !== 'on' || !S.clKey){ C.prompt = C.text; C.steps = []; C.fits = true; C.nota = 'fără Claude: textul tău merge direct la model'; C.edited = false; C.promptKey = promptKey(mk); renderPrompt(); return C.prompt; }
  const c = charById(C.charId), m = MODELE[mk];
  if(mk === SCHITA.model) sec = Math.min(8, Math.max(4, sec));
  const r = await clVideoPrompt({text:C.text, start:C.start, mk, sec, audio:m.audio === 'always' || (m.audio === 'switch' && audio), persona:c && c.desc, missing:C.missing});
  if(!r.video) throw new Error(r.nota || 'Claude a refuzat cererea.');
  C.prompt = r.video; C.steps = r.steps; C.fits = r.fits; C.secSuggest = r.secSuggest; C.nota = r.nota + ' · ' + usdC(r.usd); C.edited = false; C.promptKey = promptKey(mk); renderPrompt();
  return C.prompt;
}
async function btnPrepare(){ const b = $('#btnPrep'); b.disabled = true; b.textContent = 'Claude scrie…'; try{ await preparePrompt(); }catch(e){ toast(e.message, 6000); } finally{ b.disabled = false; b.textContent = 'Pregătește promptul'; } }
async function send(final){
  if(!S.rwKey) return toast('Lipsește cheia Runware (Setări).');
  const btn = final ? $('#btnFinal') : $('#btnDraft'); btn.disabled = true;
  try{
    const tmk = final ? S.mk : SCHITA.model;
    if(!C.prompt || (!C.edited && C.promptKey !== promptKey(tmk))){ btn.textContent = 'Claude scrie promptul…'; await preparePrompt(tmk); }
    if(String(C.prompt).trim().length > PROMPT_MAX) throw new Error(`Promptul are ${String(C.prompt).trim().length} caractere; Runware primește cel mult ${PROMPT_MAX}. Scurtează-l sau șterge-l ca să-l refacă Claude.`);
    const mk = final ? S.mk : SCHITA.model, m = MODELE[mk];
    const p = {mk, res:final ? S.res : SCHITA.res, sec:final ? +S.sec : Math.min(8, Math.max(4, +S.sec)), audio:final ? (m.audio === 'always' || (m.audio === 'switch' && !!S.audio)) : false, draft:!final, aspect:S.aspect};
    const est = costClip(p.mk, p.res, p.sec, p.audio, p.draft);
    const startKey = await putBlob('img', C.start);
    const job = {id:uid(), at:Date.now(), charId:C.charId, text:C.text, prompt:C.prompt, nota:C.nota, steps:C.edited ? [] : (C.steps || []), start:startKey, startScore:C.score ?? null, ...p, est:est.usd, estMin:est.min, state:'trimit'};
    jobs.unshift(job); await saveJobs(); renderJobs();
    runJob(job);
    toast(final ? 'Clipul final a pornit. Poți închide aplicația; continuă la Runware.' : 'Schița a pornit.');
  }catch(e){ toast(String(e.message || e), 6000); }
  finally{ btn.disabled = false; renderCostLine(); }
}

/* ───────── lucrări (persistente: se reiau la pornire) ───────── */
const jobTick = {};
async function runJob(job, resume, got){
  try{
    if(!job.taskUUID){
      if(resume) throw new Error('Trimiterea s-a întrerupt înainte să ajungă la Runware.');
      const start = await DB.get(job.start); if(!start) throw new Error('Poza de start lipsește.');
      const task = await videoTask({mk:job.mk, res:job.res, sec:job.sec, audio:job.audio, draft:job.draft, prompt:job.prompt, start});
      job.taskUUID = task.taskUUID; job.state = 'trimis'; await saveJobs();
      try{ await rwSend(task); }
      catch(e){ if(!e.net) delete job.taskUUID; if(!e.net && /insufficient|balance/i.test(e.message)) throw rwFail(e.message.replace(/^Runware:\s*/, '').replace(/\s*\(reîncarcă[^)]*\)$/, '')); throw e; }   // 1.0.2: refuzată la trimitere = n-a pornit
    }
    job.state = 'lucru'; await saveJobs(); renderJobs();
    const ac = new AbortController(); JOB_AC[job.id] = ac;
    const x = got || await rwWait(job.taskUUID, 'video', {signal:ac.signal, maxMs:30 * 60e3,
      onTick:s => { jobTick[job.id] = Math.round((Date.now() - job.at) / 1000); updJob(job); },
      onStatus:o => { const r = JOB_RW[job.id] || (JOB_RW[job.id] = {}); if(o.st) r.st = o.st; if(o.raw) r.raw = o.raw; if(o.det) r.det = o.det; r.at = Date.now(); updJob(job); }});
    delete JOB_AC[job.id];
    job.state = 'descarc'; updJob(job);
    const vb = await fetchBlob(x.videoURL || x.mediaURL || x.outputURL, 'video/mp4');
    const cost = +x.cost > 0 ? +x.cost : job.est; addCost('runware', cost);
    const vid = await putBlob('vid', vb);
    job.state = 'verific'; updJob(job);
    let frames = [], score = null, th = null;
    try{ frames = await videoFrames(vb, 8); }catch(e){}
    if(frames.length) th = await putBlob('th', await toJpeg(frames[Math.min(1, frames.length - 1)], 480, .8));
    const c = charById(job.charId);
    if(c && S.checkFace === 'on' && frames.length){ try{ score = await clipScore(c, frames); }catch(e){} }
    // 1.1: au apărut pașii ceruți? (Claude vede 8 cadre)
    let check = null;
    if(S.checkSteps !== 'off' && S.clKey && job.steps && job.steps.length && frames.length >= 4){ job.state = 'pasi'; updJob(job); try{ check = await clCheckSteps(job.steps, frames); }catch(e){ check = {err:String(e.message || e).slice(0, 160)}; } }
    const clip = {id:uid(), at:Date.now(), charId:job.charId, text:job.text, prompt:job.prompt, nota:job.nota, start:job.start, startScore:job.startScore,
      mk:job.mk, res:job.res, sec:job.sec, audio:job.audio, draft:job.draft, aspect:job.aspect, cost, costReal:+x.cost > 0, vid, th, score, steps:job.steps || [], check};
    clips.unshift(clip); await saveClips();
    jobs = jobs.filter(j => j.id !== job.id); await saveJobs();
    toast(`${job.draft ? 'Schița' : 'Clipul'} e gata · ${usdC(cost)}${score && score.avg != null ? ' · fața ' + score.avg + '%' : ''}${check && check.n ? ` · pași ${check.ok}/${check.n}` : ''}`, 5000);
    if(!$('#v-creeaza').hidden){ renderJobs(); renderLast(); } else if(!$('#v-galerie').hidden) renderGallery();
  }catch(e){
    delete JOB_AC[job.id];
    if(e.name === 'AbortError'){
      // oprit din „Detalii” (gata sau eroare la Runware) sau din „Renunță”
      if(job.stopGot){ const g = job.stopGot; delete job.stopGot; job.state = 'lucru'; renderJobs(); return runJob(job, false, g); }
      job.state = 'eroare'; job.err = job.stopWhy || 'Oprit de tine. Dacă Runware îl termină totuși, „Reia” îl preia fără să-l plătești din nou.'; delete job.stopWhy;
      await saveJobs(); renderJobs(); return;
    }
    // Runware nu știe de sarcină = n-a ajuns la ei: „Reia” o trimite din nou (nu se plătește de două ori)
    if(e.notFound && job.taskUUID){ delete job.taskUUID; e = new Error('Clipul n-a ajuns la Runware. Apasă „Reia” ca să-l trimiți din nou.'); }
    if(e.taskFailed && !e.credit && /insufficient|balance/i.test(e.message)) e = rwFail(e.message.replace(/^Runware:\s*/, '').replace(/\s*\(reîncarcă[^)]*\)$/, ''));
    if(e.taskFailed) delete job.taskUUID;   // 1.0.2: eșuată la Runware (neplătită): „Reia” o trimite din nou, nu mai întreabă de cea eșuată
    job.state = 'eroare'; job.err = String(e.message || e).slice(0, 300); await saveJobs(); renderJobs();
  }
}
const JOB_AC = {}, JOB_RW = {};   // 1.0.1: oprirea și ce a răspuns Runware ultima dată, pe lucrare
const JOB_ST = {trimit:'se trimite', trimis:'trimis', lucru:'Runware lucrează', descarc:'descarc clipul', verific:'verific fața', pasi:'verific pașii', eroare:'eroare'};
function jobHTML(j){
  const m = MODELE[j.mk] || {nume:j.mk}, el = jobTick[j.id] ?? Math.round((Date.now() - j.at) / 1000);
  return `<div class="job ${j.state === 'eroare' ? 'err' : ''}" id="job-${j.id}"><div><b>${j.draft ? 'Schiță' : 'Final'} · ${esc(m.nume)} ${j.res} · ${j.sec} s</b>
    <div class="muted">${JOB_ST[j.state] || j.state}${j.state !== 'eroare' ? ' · ' + Math.floor(el / 60) + ':' + String(el % 60).padStart(2, '0') : ''} · ${j.estMin ? '≥' : ''}${usdC(j.est)}</div>
    ${j.state === 'lucru' ? rwLine(j, el) : ''}
    ${j.err ? `<div class="errtxt">${esc(j.err)}</div>` : ''}
    ${j.state === 'lucru' || j.state === 'eroare' ? `<div class="row wrap">${j.state === 'eroare' ? `<button class="sm" onclick="retryJob('${j.id}')">Reia</button><button class="sm ghost" onclick="dropJob('${j.id}')">Șterge</button>` : `<button class="sm ghost" onclick="stopJob('${j.id}')">Renunță</button>`}${j.taskUUID ? `<button class="sm ghost" onclick="jobDetails('${j.id}')">Detalii</button>` : ''}</div>` : ''}</div>
    ${j.state === 'eroare' ? '' : '<span class="spin"></span>'}</div>`;
}
// ce a spus Runware ultima dată + avertizarea după 10 minute
function rwLine(j, el){
  const r = JOB_RW[j.id], ago = r && r.at ? Math.round((Date.now() - r.at) / 1000) : null;
  const st = r && r.st ? ({processing:'în lucru', success:'gata'}[r.st] || r.st) : 'aștept primul răspuns';
  return `<div class="muted">Runware: ${esc(st)}${ago != null ? ` (acum ${ago} s)` : ''}${r && r.det ? ' · detalii: ' + esc(r.det.msg) : ''}</div>`
    + (el > 600 ? '<div class="warn" style="font-size:13px">Durează mai mult decât de obicei (~2 min pentru 8 s). Aplicația verifică singură și detaliile la Runware la fiecare 2 minute.</div>' : '');
}
function stopJob(id){ const ac = JOB_AC[id]; if(ac) ac.abort(); else { const j = jobs.find(x => x.id === id); if(j){ j.state = 'eroare'; j.err = 'Oprit de tine.'; saveJobs(); renderJobs(); } } }
async function jobDetails(id){
  const j = jobs.find(x => x.id === id); if(!j || !j.taskUUID) return;
  sheet('<h2>Detalii de la Runware</h2><p class="muted">Cer detaliile…</p>');
  let det; try{ det = await rwDetails(j.taskUUID); }catch(e){ det = {state:'necunoscut', msg:e.message}; }
  const r = JOB_RW[j.id] || {}, q = det.req || {};
  sheet(`<h2>Detalii de la Runware</h2>
    <div class="info"><div><b>Stare:</b> ${esc({gata:'gata', eroare:'eroare', lucru:'în lucru', necunoscut:'necunoscută'}[det.state] || det.state)} — ${esc(det.msg || '')}</div>
    <div><b>Cerere:</b> ${esc(q.model || j.mk)} · ${esc(q.resolution || j.res)} · ${esc(q.duration || j.sec)} s</div>
    <div class="muted">Cod: <span class="mono">${esc(j.taskUUID)}</span></div>
    ${r.raw ? `<details><summary>Ultimul răspuns la verificare</summary><p class="mono">${esc(r.raw)}</p></details>` : ''}</div>
    ${det.state === 'gata' ? '<p class="ok">Clipul e gata la Runware: aplicația îl preia la următoarea verificare.</p>' : ''}`);
  if(det.state === 'gata' || det.state === 'eroare'){
    const ac = JOB_AC[id];
    if(det.state === 'gata'){ if(ac){ j.stopGot = det.item; ac.abort(); } else { j.err = ''; j.state = 'lucru'; renderJobs(); runJob(j, false, det.item); } }
    else { j.stopWhy = rwFail(det.msg).message; delete j.taskUUID; if(ac) ac.abort(); else { j.state = 'eroare'; j.err = j.stopWhy; delete j.stopWhy; await saveJobs(); renderJobs(); } }
  }
}
function renderJobs(){ const el = $('#cJobs'); if(!el) return; el.innerHTML = jobs.length ? '<h3>În lucru</h3>' + jobs.map(jobHTML).join('') : ''; }
function updJob(j){ const el = document.getElementById('job-' + j.id); if(el) el.outerHTML = jobHTML(j); }
async function retryJob(id){ const j = jobs.find(x => x.id === id); if(!j) return; if(j.taskUUID && /^(Runware:|Credit insuficient)/.test(j.err || '')) delete j.taskUUID;   /* 1.0.2: eșuată la Runware: se trimite din nou */ const hadTask = !!j.taskUUID; j.err = ''; j.state = hadTask ? 'lucru' : 'trimit'; j.at = Date.now(); await saveJobs(); renderJobs(); runJob(j, false); }
async function dropJob(id){ jobs = jobs.filter(x => x.id !== id); await saveJobs(); renderJobs(); }
function renderLast(){
  const el = $('#cLast'); if(!el) return; const x = clips[0];
  el.innerHTML = x ? '<h3>Ultimul clip</h3>' + clipCard(x) : ''; hydrate(el);
}

/* ═════════ Galerie ═════════ */
function clipCard(x){
  const c = charById(x.charId), m = MODELE[x.mk] || {nume:x.mk}, s = x.score;
  return `<div class="card" onclick="openClip('${x.id}')"><div class="th aspect-${String(x.aspect || '9:16').replace(':', 'x')}"><img data-k="${x.th || x.start}" alt=""><span class="play">▶</span>${x.draft ? '<span class="tag">schiță</span>' : ''}</div>
    <div class="meta"><b>${esc(c ? c.name : 'Fără personaj')}</b><span>${esc(m.nume)} · ${x.res} · ${x.sec} s · ${usdC(x.cost)}</span>${s && s.avg != null ? `<span class="${s.avg >= ID_OK ? 'ok' : 'warn'}">fața ${s.avg}% (min ${s.min}%)</span>` : ''}${x.check && x.check.n ? `<span class="${x.check.ok === x.check.n ? 'ok' : 'warn'}">pași ${x.check.ok}/${x.check.n}</span>` : ''}<span class="muted">${when(x.at)}</span></div></div>`;
}
function renderGallery(){
  const el = $('#gList');
  el.innerHTML = clips.length ? clips.map(clipCard).join('') : '<div class="empty">Niciun clip încă.</div>';
  const tot = clips.reduce((a, x) => a + (x.cost || 0), 0);
  $('#gSum').textContent = clips.length ? `${clips.length} clipuri · ${usdC(tot)} în total` : '';
  hydrate(el);
}
let viewUrl = null;
async function openClip(id){
  const x = clips.find(c => c.id === id); if(!x) return;
  const c = charById(x.charId), m = MODELE[x.mk] || {nume:x.mk}, s = x.score, vb = await DB.get(x.vid);
  if(viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = vb ? URL.createObjectURL(vb) : '';
  sheet(`<video src="${viewUrl}" controls autoplay loop playsinline class="player"></video>
    <div class="info"><b>${esc(c ? c.name : 'Fără personaj')}</b> · ${x.draft ? 'schiță' : 'final'} · ${esc(m.nume)} ${x.res} · ${x.sec} s${x.audio ? ' · cu sunet' : ''} · ${usdC(x.cost)}${x.costReal ? '' : ' (estimat)'}
    ${s && s.avg != null ? `<div class="${s.avg >= ID_OK ? 'ok' : 'warn'}">Fața: ${s.avg}% în medie, cel mai slab cadru ${s.min}% (${s.seen} din ${s.n} cadre)${x.startScore != null ? ' · poza de start ' + x.startScore + '%' : ''}</div>` : s ? '<div class="muted">Fața nu se vede în cadrele verificate.</div>' : ''}
    ${stepsHTML(x)}
    <div class="muted">${when(x.at)}</div>
    <details><summary>Ce ai cerut</summary><p>${esc(x.text)}</p><p class="mono">${esc(x.prompt)}</p>${x.nota ? `<p class="muted">${esc(x.nota)}</p>` : ''}</details></div>
    <div class="row wrap">
      <button onclick="saveClip('${x.id}')">Salvează în telefon</button>
      ${x.draft ? `<button onclick="reuse('${x.id}', true)">Fă clipul final</button>` : ''}
      ${missOf(x).length ? `<button onclick="reuse('${x.id}', false, true)">Refă cu pașii lipsă accentuați</button>` : ''}
      <button class="ghost" onclick="reuse('${x.id}', false)">Refă / modifică</button>
      <button class="ghost danger" onclick="delClip('${x.id}')">Șterge</button>
    </div>`);
}
// 1.1: lista pașilor din clip, cu verdictul fiecăruia
const STEP_V = {da:['✓', 'ok', 'făcut'], partial:['~', 'warn', 'parțial'], nu:['✗', 'bad', 'lipsește'], nesigur:['?', 'muted', 'nesigur']};
function stepsHTML(x){
  if(!x.steps || !x.steps.length) return '';
  const ch = x.check && x.check.steps;
  return `<div><b>Pașii${x.check && x.check.n ? ` · ${x.check.ok} din ${x.check.n} făcuți` : ''}</b>${x.check && x.check.err ? ` <span class="muted">(verificarea n-a mers: ${esc(x.check.err)})</span>` : ''}<ol class="steps">`
    + x.steps.map((s, i) => { const v = ch && ch[i], V = v ? STEP_V[v.v] || STEP_V.nesigur : null;
      return `<li>${V ? `<span class="${V[1]}">${V[0]}</span> ` : ''}<span class="sec">${fmtS(s.t0)}–${fmtS(s.t1)} s</span> ${esc(s.ro || s.en)}${v && v.ro ? ` <span class="muted">— ${esc(v.ro)}</span>` : ''}</li>`; }).join('') + '</ol></div>';
}
const missOf = x => !x.check || !x.check.steps ? [] : x.steps.filter((s, i) => x.check.steps[i] && (x.check.steps[i].v === 'nu' || x.check.steps[i].v === 'partial')).map(s => s.en || s.ro);
async function saveClip(id){
  const x = clips.find(c => c.id === id), vb = x && await DB.get(x.vid); if(!vb) return toast('Clipul lipsește.');
  const name = `animas-${new Date(x.at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.mp4`, f = new File([vb], name, {type:'video/mp4'});
  try{ if(navigator.canShare && navigator.canShare({files:[f]})){ await navigator.share({files:[f], title:'Animas'}); return; } }catch(e){ if(e.name === 'AbortError') return; }
  const a = document.createElement('a'), u = URL.createObjectURL(vb); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 30000);
}
// ia scena unui clip în Creează (pentru final sau pentru o variantă)
async function reuse(id, final, fix){
  const x = clips.find(c => c.id === id); if(!x) return;
  closeSheet();
  C.charId = x.charId; C.text = x.text || ''; C.startRaw = await DB.get(x.start); C.start = C.startRaw; C.startSrc = 'clip:' + x.id; C.score = x.startScore;
  S.aspect = x.aspect || S.aspect; C.prompt = x.draft ? '' : x.prompt; C.edited = false; C.promptKey = x.draft ? '' : promptKey(x.mk); C.nota = x.nota || '';
  C.steps = x.steps || []; C.fits = true; C.secSuggest = null; C.missing = null;
  if(fix){ C.missing = missOf(x); C.prompt = ''; C.edited = false; C.steps = []; S.mk = x.mk; S.res = x.res; S.sec = x.sec; }   // 1.1: același model, plan refăcut
  go('creeaza');
  if(final){ toast('Scena e în Creează. Verifică modelul și apasă „Clip final”.', 5000); }
}
async function delClip(id){
  if(!confirm('Ștergi clipul?')) return;
  const x = clips.find(c => c.id === id); clips = clips.filter(c => c.id !== id); await saveClips();
  if(x){ for(const k of [x.vid, x.th]) if(k) DB.del(k).catch(() => {}); if(x.start && !clips.some(c => c.start === x.start) && !jobs.some(j => j.start === x.start)) DB.del(x.start).catch(() => {}); }
  closeSheet(); renderGallery(); renderLast();
}

/* ═════════ Personaje ═════════ */
function renderChars(){
  const el = $('#pList');
  el.innerHTML = chars.length ? chars.map(c => `<div class="pc" onclick="editChar('${c.id}')"><img data-k="${c.photo}" alt=""><div><b>${esc(c.name)}</b><span class="muted">${c.src === 'taifas' ? 'din Taifas' : 'creat în Animas'}${c.face ? ' · portret de aproape' : ''}</span></div></div>`).join('') : '<div class="empty">Niciun personaj. Importă-le din Taifas sau creează unul nou.</div>';
  hydrate(el);
}
// imaginile din listă se încarcă din baza de date (o singură dată pe element)
const urlCache = new Map();
async function hydrate(root){
  for(const im of root.querySelectorAll('img[data-k]')){
    const k = im.dataset.k; if(!k || k === 'undefined') continue;
    let u = urlCache.get(k); if(!u){ const b = await DB.get(k).catch(() => null); if(!b) continue; u = URL.createObjectURL(b); urlCache.set(k, u); }
    im.src = u;
  }
}
let ed = null;
function editChar(id){
  const c = id ? charById(id) : null;
  ed = c ? {...c, photoB:null, faceB:null} : {id:null, name:'', desc:'', photo:null, face:null, photoB:null, faceB:null, ok:false};
  sheet(`<h2>${c ? 'Personaj' : 'Personaj nou'}</h2>
    <label>Nume<input id="eName" value="${esc(ed.name)}" maxlength="40"></label>
    <div class="row"><div class="slot"><img id="ePhoto" data-k="${ed.photo || ''}" alt=""><label class="btn sm">Poza de profil<input type="file" accept="image/*" hidden onchange="edFile(this, 'photo')"></label></div>
      <div class="slot"><img id="eFace" data-k="${ed.face || ''}" alt=""><label class="btn sm ghost">Portret de aproape<input type="file" accept="image/*" hidden onchange="edFile(this, 'face')"></label></div></div>
    <p class="muted">Portretul de aproape (opțional) ajută verificarea feței și poza de start generată.</p>
    <label>Descriere fizică (engleză, pentru modele)<textarea id="eDesc" rows="4">${esc(ed.desc || '')}</textarea></label>
    <button class="ghost sm" id="eDescBtn" onclick="edDescribe()">Claude scrie descrierea din poză</button>
    ${c ? '' : `<label class="chk"><input type="checkbox" id="eOk"> Personajul e creat de mine (AI) sau am acordul persoanei din poză.</label>`}
    <div class="row wrap"><button onclick="edSave()">Salvează</button>${c ? `<button class="ghost danger" onclick="delChar('${c.id}')">Șterge</button>` : ''}</div>`);
  hydrate($('#sheet'));
}
async function edFile(inp, which){
  const f = inp.files && inp.files[0]; inp.value = ''; if(!f) return;
  const b = await toJpeg(f, 1600, .93); ed[which + 'B'] = b;
  $(which === 'photo' ? '#ePhoto' : '#eFace').src = URL.createObjectURL(b);
}
async function edDescribe(){
  const b = ed.photoB || (ed.photo && await DB.get(ed.photo)); if(!b) return toast('Pune întâi poza de profil.');
  const btn = $('#eDescBtn'); btn.disabled = true; btn.textContent = 'Claude se uită…';
  try{ $('#eDesc').value = await clDescribe(b); }catch(e){ toast(e.message, 6000); }
  finally{ btn.disabled = false; btn.textContent = 'Claude scrie descrierea din poză'; }
}
async function edSave(){
  const name = $('#eName').value.trim(); if(!name) return toast('Pune un nume.');
  if(!ed.id && !$('#eOk').checked) return toast('Bifează confirmarea despre poză.');
  if(!ed.photo && !ed.photoB) return toast('Pune poza de profil.');
  // vârsta: aceeași regulă ca în Taifas (estimarea din telefon, prag 21)
  for(const b of [ed.photoB, ed.faceB].filter(Boolean)){
    try{ const f = await faceOf(b, {age:true}); if(f && f.age != null && f.age < AGE_MIN) return toast(`Persoana din poză pare să aibă ${f.age} ani: Animas nu creează personaje care par sub ${AGE_MIN} ani.`, 7000); }catch(e){}
  }
  let c = ed.id ? charById(ed.id) : null;
  if(!c){ c = {id:uid(), src:'nou', at:Date.now()}; chars.push(c); }
  c.name = name; c.desc = $('#eDesc').value.trim();
  if(ed.photoB){ if(c.photo) DB.del(c.photo).catch(() => {}); c.photo = await putBlob('img', ed.photoB); c.full = null; delete c.emb; }
  if(ed.faceB){ if(c.face) DB.del(c.face).catch(() => {}); c.face = await putBlob('img', ed.faceB); delete c.emb; }
  await saveChars(); closeSheet(); renderChars(); toast('Salvat.');
}
async function delChar(id){
  if(!confirm('Ștergi personajul? Clipurile lui rămân în galerie.')) return;
  const c = charById(id); chars = chars.filter(x => x.id !== id); await saveChars();
  if(c) for(const k of [c.photo, c.face, c.full]) if(k) DB.del(k).catch(() => {});
  if(C.charId === id) C.charId = null; closeSheet(); renderChars();
}

/* ───────── import din Taifas (aceeași adresă: costi1622.github.io → aceeași bază de date a telefonului) ─────────
   Doar citire: Animas nu scrie nimic în baza lui Taifas. Dacă baza nu există, crearea ei e anulată (Taifas rămâne neatins). */
function taifasOpen(){
  return new Promise(async (res, rej) => {
    try{ if(indexedDB.databases){ const L = await indexedDB.databases(); if(!L.some(d => d.name === 'taifas2')) return rej(new Error('Nu găsesc Taifas în acest browser. Deschide Animas din același Chrome în care folosești Taifas.')); } }catch(e){}
    const r = indexedDB.open('taifas2');
    r.onupgradeneeded = () => { try{ r.transaction.abort(); }catch(e){} };
    r.onsuccess = () => { const db = r.result; if(!db.objectStoreNames.contains('kv')){ db.close(); return rej(new Error('Baza Taifas nu are datele așteptate.')); } res(db); };
    r.onerror = () => rej(new Error('Nu găsesc Taifas în acest browser.'));
  });
}
const tGet = (db, k) => new Promise((res, rej) => { const q = db.transaction('kv', 'readonly').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
let tfList = null, tfDb = null;
async function taifasPick(){
  try{
    tfDb = await taifasOpen();
    const tc = (await tGet(tfDb, 'chars')) || [], ts = (await tGet(tfDb, 'settings')) || {};
    const all = [];
    for(const c of tc){ if(c && c.photo && !c.dead) all.push(c); const b = c && c.duo && c.duo.b; if(b && b.photo) all.push(b); }
    tfList = {all, ts};
    if(!all.length) return toast('Taifas nu are personaje cu poză de profil.');
    const keysTxt = [ts.rwKey ? 'Runware' : '', ts.key && ts.vault !== 'on' ? 'Anthropic' : ''].filter(Boolean).join(' și ');
    sheet(`<h2>Import din Taifas</h2><p class="muted">Se copiază numele, poza de profil, portretul de aproape, poza întreagă și descrierea fizică. Taifas rămâne neschimbat.</p>
      <div class="picklist">${all.map((c, i) => `<label class="chk"><input type="checkbox" data-i="${i}" checked> ${esc(c.name || 'fără nume')}${chars.some(x => x.srcId === c.id) ? ' <span class="muted">(se actualizează)</span>' : ''}</label>`).join('')}</div>
      ${keysTxt ? `<label class="chk"><input type="checkbox" id="tfKeys" checked> Preia și cheile ${keysTxt}</label>` : '<p class="muted">Taifas nu are chei în telefon (folosește seiful din Worker): pune cheile în Setări.</p>'}
      <button onclick="taifasImport()">Importă</button>`);
  }catch(e){ toast(e.message, 7000); }
}
async function taifasImport(){
  const pick = $$('.picklist input:checked').map(x => tfList.all[+x.dataset.i]);
  const btn = $('#sheet button:last-of-type'); if(btn){ btn.disabled = true; btn.textContent = 'Import…'; }
  let n = 0;
  try{
    for(const t of pick){
      const blob = async k => k ? await tGet(tfDb, k).catch(() => null) : null;
      const photo = await blob(t.photo); if(!(photo instanceof Blob)) continue;
      const cr = t.closeRef && t.closeRef.k === t.photo && !t.closeRef.off ? await blob(t.closeRef.img) : null;
      const full = await blob(t.photoFull);
      let c = chars.find(x => x.srcId === t.id);
      if(!c){ c = {id:uid(), src:'taifas', srcId:t.id, at:Date.now()}; chars.push(c); }
      for(const k of [c.photo, c.face, c.full]) if(k) DB.del(k).catch(() => {});
      c.name = t.name || 'Fără nume'; c.desc = t.physEn || t.look || '';
      c.photo = await putBlob('img', photo); c.face = cr instanceof Blob ? await putBlob('img', cr) : null; c.full = full instanceof Blob ? await putBlob('img', full) : null;
      delete c.emb; n++;
    }
    const k = $('#tfKeys');
    if(k && k.checked){ const ts = tfList.ts; if(ts.rwKey) S.rwKey = ts.rwKey; if(ts.key && ts.vault !== 'on') S.clKey = ts.key; await saveS(); }
    await saveChars(); closeSheet(); renderChars(); toast(`Importate: ${n} personaje.`);
    if(!C.charId && chars[0]) C.charId = chars[0].id;
  }catch(e){ toast('Importul s-a oprit: ' + e.message, 7000); }
  finally{ try{ tfDb && tfDb.close(); }catch(e){} tfDb = null; }
}

/* ═════════ Setări ═════════ */
function renderSettings(){
  $('#sCl').value = S.clKey || ''; $('#sRw').value = S.rwKey || '';
  $('#sUseCl').checked = S.useClaude === 'on'; $('#sFace').checked = S.checkFace === 'on'; $('#sSteps').checked = S.checkSteps !== 'off';
  const c = S.costs || {days:{}}, d = dayKey(), mo = d.slice(0, 7);
  const month = Object.entries(c.days || {}).filter(([k]) => k.startsWith(mo)).reduce((a, [, v]) => a + v, 0);
  $('#sCosts').innerHTML = `Azi: <b>${usdC(c.days[d] || 0)}</b> · Luna aceasta: <b>${usdC(month)}</b><br>Total Runware: ${usdC(c.runware || 0)} · Total Claude: ${usdC(c.claude || 0)}`;
  if(navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(e => { $('#sStore').textContent = `Spațiu folosit: ${(e.usage / 1048576).toFixed(0)} MB din ${(e.quota / 1048576 / 1024).toFixed(1)} GB disponibili`; }).catch(() => {});
}
function setKey(k, v){ S[k] = v.trim(); saveS(); }
function setFlag(k, on){ S[k] = on ? 'on' : 'off'; saveS(); }
async function testKeys(){
  const out = $('#sTest'); out.textContent = 'Verific…';
  const r = [];
  try{ await claudeCall('Answer with OK.', [{type:'text', text:'OK?'}], {max:5}); r.push('Claude: merge'); }catch(e){ r.push(e.message); }
  // o întrebare despre o sarcină inexistentă: cheia bună dă „nu există”, cheia greșită dă 401
  if(!S.rwKey) r.push('Runware: lipsește cheia');
  else try{ await rwPost([{taskType:'getResponse', taskUUID:crypto.randomUUID()}]); r.push('Runware: merge'); }
  catch(e){ r.push(e.status === 401 || e.status === 403 || /auth|api ?key|unauthori[sz]ed|invalid key/i.test(e.message) ? 'Runware: cheia nu e bună' : 'Runware: merge'); }
  out.textContent = r.join(' · ');
}

/* ───────── foaia de jos (dialog) ───────── */
function sheet(html){ $('#sheet').innerHTML = '<button class="x" onclick="closeSheet()" aria-label="Închide">✕</button>' + html; $('#sheetBg').hidden = false; $('#sheet').scrollTop = 0; }
function closeSheet(){ $('#sheetBg').hidden = true; const v = $('#sheet video'); if(v){ v.pause(); v.removeAttribute('src'); } $('#sheet').innerHTML = ''; }

addEventListener('DOMContentLoaded', () => boot().catch(e => { document.body.innerHTML = '<p style="padding:20px">Animas nu pornește: ' + esc(e.message) + '</p>'; }));
