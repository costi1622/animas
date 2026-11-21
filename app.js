/* Animas 1.8.1 — poză + ce vrei să facă personajul → clip video realist.
   Text: doar Claude. Imagine și video: Runware. Fața: ArcFace (din Taifas). Totul rămâne în telefon (IndexedDB). */
'use strict';
window.__animas = true;
const APP_VER = '1.9.5';
const BODY_OK = 80;   // 1.4: sub 80% proporțiile corpului s-au schimbat vizibil (~10% abatere)

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
/* 1.3: încadrarea. Capul întreg în cadru (fața + ~50% deasupra pentru frunte și păr), puțin aer deasupra capului, iar restul
   cadrului merge în jos, spre corp. 1.0–1.2 puneau bărbia la 38% din înălțime: la un selfie de aproape în 16:9 tăia ochii și
   fruntea (și scorul feței scădea, pentru că fața tăiată se măsoară prost). shift = mutarea ta (pași de 10% din cadru). */
function cropRect(W, H, aspect, box, shift = 0, body = null){
  const r = ASPECT[aspect] || 9 / 16;
  let w = W, h = Math.round(W / r); if(h > H){ h = H; w = Math.round(H * r); }
  let x = Math.round((W - w) / 2), y = Math.round((H - h) / 2), cut = false;
  if(box){
    const top = Math.max(0, box.y - box.h * .5), bot = Math.min(H, box.y + box.h * 1.12), cx = box.x + box.w / 2;   // capul cât există în poză
    x = Math.round(cx - w / 2);
    if(bot - top + h * .06 <= h) y = Math.round(top - h * .06);          // capul încape: aer deasupra, restul spre corp
    else { y = Math.round(box.y + box.h * .45 - h / 2); cut = true; }     // nu încape: ochii la mijloc, capul tăiat (spus)
    // 1.4: corpul găsit (MoveNet): dacă cap + corp încap, cadrul le cuprinde pe amândouă, centrat
    if(body && !cut){
      const rt = top, rb = Math.max(bot, body.y + body.h), rl = Math.min(box.x, body.x), rr = Math.max(box.x + box.w, body.x + body.w);
      if(rb - rt + h * .06 <= h) y = Math.round(Math.min(rt - h * .06, (rt + rb) / 2 - h / 2));
      if(rr - rl <= w) x = Math.round((rl + rr) / 2 - w / 2);
    }
  } else if(body){ y = Math.round(body.y + body.h / 2 - h / 2); x = Math.round(body.x + body.w / 2 - w / 2); }
  y += Math.round(shift * h * .1);
  x = Math.max(0, Math.min(W - w, x)); y = Math.max(0, Math.min(H - h, y));
  if(box && !cut) cut = Math.max(0, box.y - box.h * .5) < y - 2 || Math.min(H, box.y + box.h * 1.12) > y + h + 2 || box.x < x - 2 || box.x + box.w > x + w + 2;
  return {x, y, w, h, cut, kept:Math.round(100 * w * h / (W * H)), slackY:H - h, slackX:W - w};
}
// formatul care păstrează capul întreg și cea mai mare parte din poză, dintre cele permise de model
function bestAspect(W, H, box, allowed, body){
  let best = null;
  for(const a of allowed){ const c = cropRect(W, H, a, box, 0, body); const sc = (c.cut ? 0 : 1000) + c.kept; if(!best || sc > best.sc) best = {a, sc, c}; }
  return best && best.a;
}
async function cropAspect(blob, aspect, box, shift = 0, body = null){
  const u = URL.createObjectURL(blob);
  try{
    const im = await loadImg(u), W = im.naturalWidth, H = im.naturalHeight, c = cropRect(W, H, aspect, box, shift, body);
    const s = Math.min(1, 1280 / Math.max(c.w, c.h)), cv = document.createElement('canvas');
    cv.width = Math.round(c.w * s); cv.height = Math.round(c.h * s);
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, c.x, c.y, c.w, c.h, 0, 0, cv.width, cv.height);
    const b = await cvBlob(cv, .93); b.crop = {...c, W, H}; return b;
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
const DEF = {clKey:'', rwKey:'', clModel:'claude-sonnet-5-5', useClaude:'on', checkSteps:'on', endFrame:'on', best2:'off', autoFix:'off', mk:'kling4f', res:'720p', sec:5, audio:true, aspect:'9:16', checkFace:'on', costs:{days:{}, claude:0, runware:0}};
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
/* 1.5: vârsta, ca în Taifas: un personaj sau o poză care pare sub 21 de ani nu se folosește pentru clipuri (estimarea din telefon,
   media pe poză și oglinda ei; la personaje, portretul și portretul de aproape). Se verifică la import, la pozele urcate sau generate
   și, o dată, la personajele deja importate. */
const isYoung = c => !!(c && c.age && c.age.k === c.photo && c.age.young);
async function charAge(c){
  if(!c || !c.photo) return null;
  if(c.age && c.age.k === c.photo && c.age.v === 1) return c.age;
  const a = [];
  for(const k of [c.photo, c.face]){ if(!k) continue; const b = await DB.get(k).catch(() => null); if(!b) continue; const v = await ageOf(b).catch(() => null); if(v != null) a.push(v); }
  const m = a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
  c.age = {k:c.photo, v:1, a:m, young:m != null && m < AGE_MIN}; await saveChars(); return c.age;
}
async function checkAges(){
  let n = 0;
  for(const c of chars.slice()){ if(c.age && c.age.k === c.photo && c.age.v === 1) continue; try{ const r = await charAge(c); if(r && r.young) n++; }catch(e){} }
  if(n){ if(isYoung(charById(C.charId))) pickChar(''); if(!$('#v-creeaza').hidden) renderCreate(); if(!$('#v-personaje').hidden) renderChars(); toast(`${n} ${n === 1 ? 'personaj pare' : 'personaje par'} sub ${AGE_MIN} de ani: nu se pot folosi pentru clipuri.`, 6000); }
}

/* ───────── pornire ───────── */
async function boot(){
  await DB.open();
  S = {...DEF, ...((await DB.get('settings')) || {})};
  chars = (await DB.get('chars')) || []; clips = (await DB.get('clips')) || []; jobs = (await DB.get('jobs')) || []; stories = (await DB.get('stories')) || []; callsets = (await DB.get('callsets')) || [];
  try{ if(navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(e){}
  $('#ver').textContent = APP_VER;
  if(!chars.length || !S.rwKey) setTimeout(() => { if(!S.rwKey) toast('Pune cheile în Setări sau preia-le din Taifas.', 5000); }, 800);
  if(S.mk === 'pvideo2') S.mk = 'kling4f';
  C.charId = (chars.find(c => !isYoung(c)) || {}).id || null;
  go(location.hash.slice(1) || 'creeaza');
  for(const j of jobs) runJob(j, true);
  setTimeout(() => checkAges().catch(() => {}), 1500);
  for(const st of stories) if(st.state === 'lucru') setTimeout(() => storyNext(st.id), 2000);   // 1.6: poveștile în lucru continuă
  setMode(S.mode || 'clip');
  if('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', {updateViaCache:'none'}).then(r => { document.addEventListener('visibilitychange', () => { if(!document.hidden) r.update().catch(() => {}); }); }).catch(() => {});
  if(/[?&]v=\d/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);   // după actualizarea forțată
  setTimeout(() => checkUpdate().catch(() => {}), 3000);
  document.addEventListener('visibilitychange', () => { if(!document.hidden) checkUpdate().catch(() => {}); });
}
/* ═════════ 1.9.1: actualizarea ═════════
   Cauza versiunilor vechi: GitHub Pages trimite fișierele cu „păstrează 10 minute” (HTTP cache), iar service worker-ul vechi le servea din
   copie; uneori telefonul rămânea pe codul vechi și după ce urcai versiunea nouă. Acum: (1) service worker-ul cere codul cu revalidare
   (no-cache) și e verificat la fiecare revenire în aplicație; (2) la pornire și la revenire, aplicația compară versiunea ei cu cea de pe
   GitHub și arată o bară „E versiunea nouă X”; (3) „⟳ Actualizează forțat” (Setări și bara): scoate service worker-ul, șterge copiile
   codului (NU datele: clipurile, personajele, setările, cheile rămân; nici bibliotecile mari, ca FFmpeg), descarcă din nou fișierele
   ocolind orice copie și repornește aplicația. */
async function serverVer(){
  const r = await fetch('app.js?nocache=' + Date.now(), {cache:'no-store'}); if(!r.ok) throw new Error('HTTP ' + r.status);
  const m = (await r.text()).match(/const APP_VER = '([^']+)'/); return m ? m[1] : null;
}
const verNewer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for(let i = 0; i < Math.max(x.length, y.length); i++){ if((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let UPD = {server:null, at:0};
async function checkUpdate(force){
  if(!navigator.onLine || (!force && Date.now() - UPD.at < 60e3)) return UPD.server;
  UPD.at = Date.now(); UPD.server = await serverVer();
  const bar = $('#updBar');
  if(bar){ const nw = UPD.server && verNewer(UPD.server, APP_VER); bar.hidden = !nw; if(nw) bar.querySelector('b').textContent = UPD.server; }
  renderUpd(); return UPD.server;
}
function renderUpd(){
  const el = $('#sUpd'); if(!el) return;
  el.innerHTML = `În telefon: <b>v${APP_VER}</b> · pe GitHub: <b>${UPD.server ? 'v' + UPD.server : navigator.onLine ? 'verific…' : 'fără rețea'}</b>${UPD.server ? (verNewer(UPD.server, APP_VER) ? ' — <span class="warn">e o versiune nouă</span>' : UPD.server === APP_VER ? ' — <span class="ok">ești la zi</span>' : '') : ''}`;
}
async function forceUpdate(){
  if(typeof MJ !== 'undefined' && MJ.busy) return toast('Așteaptă să se termine montajul (sau anulează-l).');
  if(!navigator.onLine) return toast('Fără rețea: actualizarea are nevoie de internet.');
  const live = jobs.filter(j => j.state !== 'eroare').length;
  if(!window.__noConfirm && !confirm(`Actualizez forțat: iau din nou toate fișierele aplicației de pe GitHub și repornesc.\nClipurile, personajele, setările și cheile rămân.${live ? `\n${live} ${live === 1 ? 'clip în lucru continuă' : 'clipuri în lucru continuă'} la Runware și ${live === 1 ? 'se reia' : 'se reiau'} după repornire.` : ''}\nContinui?`)) return;
  toast('Actualizez…', 8000);
  const files = ['./', 'index.html', 'sw.js', 'manifest.webmanifest', ...[...document.scripts].map(s => s.getAttribute('src')).filter(s => s && !/^https?:/.test(s))];
  try{ if('serviceWorker' in navigator) for(const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); }catch(e){}
  try{ for(const k of await caches.keys()) if(k.startsWith('animas-') && !k.startsWith('animas-lib')) await caches.delete(k); }catch(e){}
  await Promise.all(files.map(f => fetch(f, {cache:'reload'}).catch(() => null)));   // copia HTTP a browserului primește versiunea nouă
  location.replace(location.pathname + '?v=' + Date.now() + location.hash);
}
function go(v){
  if(!['creeaza', 'galerie', 'personaje', 'setari', 'montaj'].includes(v)) v = 'creeaza';   // 1.9.0: + 🎞 Montaj AI (din Galerie)
  $$('.view').forEach(x => x.hidden = x.id !== 'v-' + v); if(v !== 'galerie') G.sel = null;
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === (v === 'montaj' ? 'galerie' : v)));
  history.replaceState(null, '', '#' + v);
  ({creeaza:renderCreate, galerie:renderGallery, personaje:renderChars, setari:renderSettings, montaj:renderMontaj})[v]();
}

/* ═════════ Creează ═════════ */
const C = {charId:null, start:null, startSrc:'', score:null, text:'', prompt:'', promptKey:'', edited:false, nota:'', scene:'', steps:[], fits:true, secSuggest:null, missing:null};
const promptKey = (mk = S.mk) => [C.text, mk, mk === SCHITA.model ? '' : S.sec, mk === SCHITA.model ? '' : S.audio, C.startSrc].join('|');
function renderCreate(){
  const ch = $('#cChars');
  if(isYoung(charById(C.charId))) C.charId = null;
  ch.innerHTML = chars.filter(c => !isYoung(c)).map(c => `<button class="chip ${c.id === C.charId ? 'on' : ''}" onclick="pickChar('${c.id}')"><img data-k="${c.photo}" alt=""><span>${esc(c.name)}</span></button>`).join('')
    + `<button class="chip ${!C.charId ? 'on' : ''}" onclick="pickChar('')"><span class="ph">∅</span><span>Fără personaj</span></button>`
    + `<button class="chip add" onclick="go('personaje')"><span class="ph">+</span><span>Adaugă</span></button>`;
  hydrate(ch);
  renderStart(); renderOpts(); renderPrompt(); renderJobs(); renderLast(); renderCallSet();
}
function pickChar(id){ if(id && isYoung(charById(id))) return toast(`Personajul pare sub ${AGE_MIN} de ani: nu se folosește pentru clipuri.`, 5000); C.charId = id || null; C.start = null; C.startRaw = null; C.crop = null; C.startSrc = ''; C.score = null; renderCreate(); }
function renderStart(){
  const c = charById(C.charId), box = $('#cStart');
  $('#btnProfil').disabled = !c;
  $('#btnGen').disabled = !S.rwKey;
  if(!C.start){ box.innerHTML = `<div class="empty">${c ? 'Alege poza de start: profilul, o poză urcată sau o scenă generată.' : 'Urcă o poză de start.'}</div>`; return; }
  const u = URL.createObjectURL(C.start);
  box.innerHTML = `<img src="${u}" alt="poza de start" class="aspect-${S.aspect.replace(':', 'x')}"><div class="badge" id="cScore">${scoreTxt(C.score)}</div>`;
  // 1.3: cât din poză rămâne, dacă se taie capul, ce format e mai bun, mutarea cadrului
  const k = C.crop, el = $('#cCrop'); if(!el) return;
  if(!k){ el.innerHTML = ''; return; }
  const m = MODELE[S.mk] || MODELE.kling4f, best = bestAspect(k.W, k.H, C.box, m.aspects, C.bbox);
  const can = k.slackY > 0 || (C.shift || 0) !== 0;
  el.innerHTML = `<div class="muted">${S.aspect} păstrează ${k.kept}% din poză${C.box ? '' : ' · fața nu s-a găsit'}${C.view ? ' · în cadru: ' + C.view.ro : C.body ? '' : ' · corpul nu s-a găsit'}</div>`
    + (C.startSrc.startsWith('generata') && C.genBody != null ? (C.genBody === 'n' ? '<div class="muted">Corpul față de fișă (tot corpul): nu se poate compara (poziția sau încadrarea diferă prea mult)</div>' : `<div class="${C.genBody >= BODY_OK ? 'ok' : 'warn'}">Corpul față de fișă (tot corpul): ${C.genBody}%</div>`) : '')
    + (k.cut ? `<div class="warn">Capul nu încape întreg în ${S.aspect}.</div>` : '')
    + (best && best !== S.aspect && (k.cut || k.kept < 60) ? `<div class="row"><span class="muted">Recomand ${best}: ${bestKeep(best)}% din poză, capul întreg.</span><button class="sm" onclick="setAspect('${best}')">Pune ${best}</button></div>` : '')
    + (can ? `<div class="row"><span class="muted">Cadrul:</span><button class="sm ghost" onclick="nudge(-1)">▲ mai sus</button><button class="sm ghost" onclick="nudge(1)">▼ mai jos</button>${C.shift ? `<button class="sm ghost" onclick="nudge(0)">auto</button>` : ''}</div>` : '');
}
const bestKeep = a => C.crop ? cropRect(C.crop.W, C.crop.H, a, C.box, 0, C.bbox).kept : 0;
async function nudge(d){ C.shift = d ? (C.shift || 0) + d : 0; await applyAspect(true); }
const scoreTxt = s => s === undefined ? 'Fața: se măsoară…' : s == null ? (C.charId ? 'Fața nu se vede' : '') : `Fața: ${s}%${s >= ID_OK ? ' · aceeași persoană' : ' · seamănă slab'}`;
async function setStart(blob, src){
  C.genBody = null;
  // 1.5: poza se arată imediat, iar erorile se spun (înainte, o poză care nu se putea citi nu făcea nimic, în tăcere)
  $('#cStart').innerHTML = '<div class="empty">Se încarcă poza…</div>'; $('#cCrop').innerHTML = '';
  if(src !== 'profil'){
    const ag = await ageOf(blob).catch(() => null);
    if(ag != null && ag < AGE_MIN){ C.startRaw = null; C.start = null; renderStart(); return toast(`Persoana din poză pare să aibă ${ag} ani: Animas nu folosește poze cu persoane care par sub ${AGE_MIN} de ani.`, 7000); }
  }
  C.end = null; C.endFor = null; C.endScore = null;
  C.startRaw = blob; C.box = null; C.body = null; C.bbox = null; C.view = null; C.boxFor = null; C.shift = 0; C.startSrc = src + ':' + uid();
  try{ await applyAspect(); }
  catch(e){ C.startRaw = null; C.start = null; renderStart(); toast('Poza nu s-a putut pregăti: ' + (e.message || e), 7000); }
}
async function applyAspect(keepShift){
  if(!C.startRaw) return;
  if(!keepShift) C.shift = 0;
  C.score = C.charId && S.checkFace === 'on' ? undefined : null; C.start = null; C.crop = null;   // 1.4: „se măsoară” până e gata tot
  // fața se caută o singură dată pe poza întreagă (nu la fiecare mutare)
  if(C.boxFor !== C.startRaw){
    let box = null; try{ const f = await faceOf(C.startRaw); box = f && f.box; }catch(e){}
    let b = null; try{ b = await bodyOf(C.startRaw); }catch(e){}       // 1.4: corpul, o dată pe poza întreagă
    C.box = box; C.body = b; C.bbox = bodyBox(b); C.boxFor = C.startRaw;
  }
  C.start = await cropAspect(C.startRaw, S.aspect, C.box, C.shift || 0, C.bbox); C.crop = C.start.crop;
  C.view = null; try{ C.view = bodyView(await bodyOf(C.start)); }catch(e){}   // ce se vede din corp în cadrul final (pentru prompt)
  C.score = C.charId && S.checkFace === 'on' ? undefined : null; renderStart();
  if(C.score === undefined){ const c = charById(C.charId); try{ C.score = await idScore(c, C.start); }catch(e){ C.score = null; } const el = $('#cScore'); if(el) el.textContent = scoreTxt(C.score); }
}
async function useProfile(){ const c = charById(C.charId); if(!c) return; const b = await DB.get(c.photo); if(b) setStart(b, 'profil'); }
async function uploadStart(inp){
  const f = inp.files && inp.files[0]; if(!f) return;
  $('#cStart').innerHTML = '<div class="empty">Se încarcă poza…</div>';
  let b;
  try{ b = await toJpeg(f, 2400, .93); }   // o citim imediat (înainte de a goli câmpul) și o aducem la JPEG de cel mult 2.400 px
  catch(e){ inp.value = ''; renderStart(); return toast(/hei[cf]/i.test(f.type + f.name) ? 'Poza e HEIC/HEIF și Chrome nu o poate citi. Pune camera pe JPG (Cameră → Setări → Format) sau alege o poză JPG/PNG.' : `Nu pot citi poza (${f.type || 'tip necunoscut'}, ${(f.size / 1048576).toFixed(1)} MB). Încearcă alta (JPG/PNG).`, 8000); }
  inp.value = '';
  setStart(b, 'urcata');
}
function openGen(){ $('#genBox').hidden = !$('#genBox').hidden; if(!$('#genBox').hidden) $('#genText').focus(); }
async function genStart(){
  const text = $('#genText').value.trim(); if(!text) return toast('Scrie scena pentru poză.');
  const c = charById(C.charId), btn = $('#btnGenGo'); btn.disabled = true; btn.textContent = 'Scriu promptul…';
  try{
    let prompt = text;
    if(S.useClaude === 'on' && S.clKey){ const r = await clImagePrompt({text, persona:c && c.desc, aspect:S.aspect, hasFace:!!(c && c.face)}); if(!r.image) throw new Error(r.nota || 'Claude a refuzat cererea.'); prompt = r.image; }
    const refs = [];
    if(c){ const full = await DB.get(c.full || c.photo).catch(() => null); if(full) refs.push(await dataUri(full, 1024)); const fc = c.face ? await DB.get(c.face).catch(() => null) : null; if(fc) refs.push(await dataUri(fc, 768)); const sd = c.side ? await DB.get(c.side).catch(() => null) : null; if(sd) refs.push(await dataUri(sd, 768)); }
    const [w, h] = {'9:16':[720, 1280], '16:9':[1280, 720], '1:1':[1024, 1024]}[S.aspect];
    btn.textContent = 'Fac poza…';
    const task = kleinTask(prompt, refs, w, h); await rwSend(task);
    const x = await rwWait(task.taskUUID, 'image', {onTick:s => btn.textContent = `Fac poza… ${s} s`});
    if(+x.cost > 0) addCost('runware', +x.cost);
    const b = x.imageBase64Data ? await (await fetch('data:image/jpeg;base64,' + x.imageBase64Data)).blob() : await fetchBlob(x.imageURL, 'image/jpeg');
    $('#genBox').hidden = true; await setStart(b, 'generata');
    // 1.6: corpul din poza generată față de poza cu tot corpul din fișă (proporțiile)
    if(c && c.full){ try{ const f0 = await bodyOf(await DB.get(c.full)), f1 = await bodyOf(b), r = f0 && f1 && bodyCompare(f0, f1); C.genBody = r ? r.pct : 'n'; }catch(e){ C.genBody = 'n'; } renderStart(); } toast('Poza de start e gata' + (+x.cost > 0 ? ' · ' + usdC(+x.cost) : '') + '.');
  }catch(e){ toast(String(e.message || e), 6000); }
  finally{ btn.disabled = false; btn.textContent = 'Generează poza'; }
}
function renderOpts(){
  if(!MODELE[S.mk] || S.mk === SCHITA.model) S.mk = 'kling4f';   /* 1.5: schița nu e model final (o refacere dintr-o schiță îl lăsa pe P-Video-2) */
  const m = MODELE[S.mk];
  $('#oModel').innerHTML = Object.entries(MODELE).filter(([k]) => k !== 'pvideo2').map(([k, x]) => `<option value="${k}" ${k === S.mk ? 'selected' : ''}>${x.nume} — ${x.rol}</option>`).join('');
  if(!m.res.hasOwnProperty(S.res)) S.res = Object.keys(m.res)[0];
  $('#oRes').innerHTML = Object.keys(m.res).map(r => `<option ${r === S.res ? 'selected' : ''}>${r}</option>`).join('');
  if(!m.dur.includes(+S.sec)) S.sec = m.dur.includes(m.def) ? m.def : m.dur[0];
  $('#oSec').innerHTML = m.dur.map(s => `<option value="${s}" ${s === +S.sec ? 'selected' : ''}>${s} s</option>`).join('');
  if(!m.aspects.includes(S.aspect)) S.aspect = m.aspects[0];
  $('#oAspect').innerHTML = ['9:16', '16:9', '1:1'].map(a => `<button class="seg ${a === S.aspect ? 'on' : ''}" ${m.aspects.includes(a) ? '' : 'disabled'} onclick="setAspect('${a}')">${a}</button>`).join('');
  const au = $('#oAudio'); au.disabled = m.audio !== 'switch'; au.checked = m.audio === 'always' ? true : m.audio === 'off' ? false : !!S.audio;
  $('#oAudioNote').textContent = m.audio === 'always' ? 'Kling pune mereu sunet; îl descrii în prompt.' : m.audio === 'off' ? 'fără sunet' : '';
  renderCostLine(); saveS(); renderRec();
  const b2 = $('#oBest2'); if(b2) b2.checked = S.best2 === 'on';
}
function setOpt(k, v){ S[k] = k === 'sec' ? +v : k === 'audio' ? !!v : v; renderOpts(); }
async function setAspect(a){ S.aspect = a; renderOpts(); await applyAspect(); }
function clipCost(final = true){
  const m = MODELE[S.mk];
  return final ? costClip(S.mk, S.res, +S.sec, m.audio === 'always' || (m.audio === 'switch' && S.audio), false)
    : costClip(SCHITA.model, SCHITA.res, draftSec(+S.sec), false, true);
}
// 1.2.1: schița are aceeași durată ca finalul (P-Video-2 acceptă 1–20 s pe Runware; 1.0–1.2 o tăiau greșit la 8 s)
const draftSec = sec => Math.min(20, Math.max(1, +sec || 5));
function renderCostLine(){
  const el = $('#oCost'); if(!el) return;
  const f = clipCost(true), d = clipCost(false), today = ((S.costs || {}).days || {})[dayKey()] || 0;
  el.innerHTML = `Schiță: <b>${usdC(d.usd)}</b> · Final: <b>${f.min ? 'de la ' : ''}${usdC(f.usd)}</b>${f.min ? ' <span class="muted">(preț 1080p nepublicat; costul real apare după clip)</span>' : ''} · Azi: ${usdC(today)}`;
  if(+S.sec > 20) el.innerHTML += ` <span class="muted">(schița: 20 s, maximul P-Video-2)</span>`;
  const n2 = S.best2 === 'on' ? 2 : 1, x2 = n2 > 1 ? ' (×2)' : '';
  const bd = $('#btnDraft'), bf = $('#btnFinal'); if(bd) bd.textContent = `Schiță · ${usdC(d.usd * n2)}${x2}`; if(bf) bf.textContent = `Clip final · ${f.min ? '≥' : ''}${usdC(f.usd * n2)}${x2}`;
}
function renderPrompt(){
  $('#cText').value = C.text;
  const has = !!C.prompt, stale = has && !C.edited && C.promptKey !== promptKey() && C.promptKey !== promptKey(SCHITA.model);
  $('#pBox').hidden = !has;
  if(has) renderLen();
  if(has){ $('#pText').value = C.prompt; $('#pNota').textContent = (C.nota || '') + (stale ? ' (se rescrie la trimitere: s-au schimbat textul sau setările)' : ''); }
  // 1.5: cadrul final ancorat
  const pe = $('#pEnd');
  if(pe){
    const m = MODELE[S.mk] || {}, es = C.endScore || {};
    pe.innerHTML = !has ? '' : S.endFrame === 'off' ? '' : !m.last ? `<div class="muted">${esc(m.nume || '')} acceptă doar primul cadru: fără cadru final ancorat (îl au Kling 4.0, Veo 3.1, Seedance 2.5 și schița).</div>`
      : C.end ? `<label>Cadrul final (clipul se termină aici)</label><div class="endrow"><img id="pEndImg" alt="cadrul final"><div><div class="${es.face == null || es.face >= ID_OK ? 'ok' : 'warn'}">${es.face != null ? 'Fața: ' + es.face + '%' : 'Fața: nemăsurată'}</div><div class="${es.body == null || es.body >= BODY_OK ? 'ok' : 'warn'}">${es.body != null ? 'Corpul: ' + es.body + '%' : 'Corpul: nemăsurabil'}</div><button class="sm ghost" id="btnEndRe" onclick="redoEnd()">↻ Refă cadrul final</button></div></div>`
      : C.endPose ? '<div class="muted">Cadrul final se face la trimitere (sau apasă din nou „Pregătește promptul”).</div>' : '';
    const ei = $('#pEndImg'); if(ei && C.end) ei.src = URL.createObjectURL(C.end);
  }
  // 1.1: planul pe secunde, cum îl va juca modelul
  const ps = $('#pSteps');
  ps.innerHTML = has && C.steps.length ? '<label>Planul pe secunde (ce va face, în ordine)</label><ol class="steps">' + C.steps.map(x => `<li><span class="sec">${fmtS(x.t0)}–${fmtS(x.t1)} s</span> ${esc(x.ro || x.en)}</li>`).join('') + '</ol>'
    + (!C.fits ? `<div class="warn">Pașii nu încap firesc în ${S.sec} s${C.secSuggest ? `: recomand ${C.secSuggest} s. <button class="sm" onclick="useSuggest()">Pune ${C.secSuggest} s</button>` : '. Scurtează textul sau alege o durată mai mare.'}</div>` : '')
    + (C.missing && C.missing.length ? `<div class="muted">Accentuat față de încercarea anterioară: ${esc(C.missing.join('; '))}</div>` : '') : '';
}
const fmtS = v => String(Math.round(v * 10) / 10).replace('.', ',');
async function useSuggest(){ if(!C.secSuggest) return; setOpt('sec', C.secSuggest); const b = $('#btnPrep'); b.disabled = true; b.textContent = 'Claude refă planul…'; try{ await preparePrompt(); }catch(e){ toast(e.message, 6000); } finally{ b.disabled = false; b.textContent = 'Pregătește promptul'; } }
function onText(v){ C.text = v; C.missing = null; clearTimeout(onText.t); onText.t = setTimeout(renderRec, 400); }
function onPromptEdit(v){ C.prompt = v; C.edited = true; renderLen(); }
// 1.2: câte caractere are promptul (Runware: cel mult 2.000)
function renderLen(){ const el = $('#pLen'); if(!el) return; const n = String(C.prompt || '').trim().length; el.className = n > PROMPT_MAX ? 'errtxt' : 'muted'; el.textContent = `${n.toLocaleString('ro-RO')} / ${PROMPT_MAX.toLocaleString('ro-RO')} caractere` + (n > PROMPT_MAX ? ' — prea lung: Runware nu-l primește. Scurtează-l.' : ''); }
// 1.6: planul + promptul pentru orice scenă (clip sau poveste), fără să depindă de ecranul Creează
async function planFor({text, start, mk, sec, audio, c, missing, framing}){
  const m = MODELE[mk];
  if(mk === SCHITA.model) sec = draftSec(sec);
  return clVideoPrompt({text, start, mk, sec, audio:m.audio === 'always' || (m.audio === 'switch' && audio), persona:c && c.desc, missing, framing, anchorEnd:anchorOn(mk)});
}
async function preparePrompt(mk = S.mk, sec = +S.sec, audio = S.audio){
  if(!C.start) throw new Error('Alege întâi poza de start.');
  if(!C.text.trim()) throw new Error('Scrie ce să facă personajul.');
  if(S.useClaude !== 'on' || !S.clKey){ C.prompt = C.text; C.steps = []; C.fits = true; C.nota = 'fără Claude: textul tău merge direct la model'; C.edited = false; C.promptKey = promptKey(mk); renderPrompt(); return C.prompt; }
  const c = charById(C.charId), m = MODELE[mk];
  if(mk === SCHITA.model) sec = draftSec(sec);
  const r = await planFor({text:C.text, start:C.start, mk, sec, audio, c, missing:C.missing, framing:C.view && C.view.en});
  C.plan = r.plan || null;
  if(r.plan && r.plan.endPose !== C.endPose){ C.endPose = r.plan.endPose; C.end = null; C.endFor = null; C.endScore = null; }
  if(!r.video) throw new Error(r.nota || 'Claude a refuzat cererea.');
  C.prompt = r.video; C.steps = r.steps; C.fits = r.fits; C.secSuggest = r.secSuggest; C.nota = r.nota + ' · ' + usdC(r.usd); C.edited = false; C.promptKey = promptKey(mk); renderPrompt(); renderRec();
  return C.prompt;
}
/* 1.5: cadrul final ancorat. Din poza de start (reperul 1) și portretul de aproape (reperul 2), FLUX.2 klein 9B face ultima imagine
   a clipului: aceeași persoană, același corp și aceleași haine, același loc și aceeași încadrare, în poziția de la finalul acțiunii.
   Se verifică fața (ArcFace) și proporțiile corpului față de poza de start; până la 2 încercări, se păstrează cea mai bună.
   Modelul video face apoi tranziția între două imagini cu același corp, în loc să-l reinventeze pe parcurs. */
const anchorOn = mk => S.endFrame !== 'off' && !!(MODELE[mk] || {}).last;
async function makeEnd(onStep){ return makeEndFor({start:C.start, endPose:C.endPose, c:charById(C.charId), onStep}); }
// 1.6: aceeași funcție pentru clipuri și pentru scenele din povești
async function makeEndFor({start, endPose, c, onStep}){
  if(!start || !endPose) return null;
  const refs = [await dataUri(start, 1280)];
  const fc = c && c.face ? await DB.get(c.face).catch(() => null) : null; if(fc) refs.push(await dataUri(fc, 768));
  const im = await loadImg(URL.createObjectURL(start)), sc = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(256, Math.round(im.naturalWidth * sc / 16) * 16), h = Math.max(256, Math.round(im.naturalHeight * sc / 16) * 16);
  const prompt = `Image 1 is the first frame of a video. Create the LAST frame of the same video: exactly the same person as in image 1, with the same face, hair and distinctive features, the same body build, height and proportions, the same clothes and fit, in the same place, with the same light, camera position, lens and framing. Change only the pose: ${endPose}.${fc ? ' Image 2 is a close-up of the same face, for facial detail.' : ''} Photorealistic phone photo, natural skin texture, no text.`;
  const b0 = await bodyOf(start).catch(() => null);
  let best = null;
  for(let i = 0; i < 2; i++){
    if(onStep) onStep(i);
    const task = kleinTask(prompt, refs, w, h); await rwSend(task);
    const x = await rwWait(task.taskUUID, 'image');
    if(+x.cost > 0) addCost('runware', +x.cost);
    const b = x.imageBase64Data ? await (await fetch('data:image/jpeg;base64,' + x.imageBase64Data)).blob() : await fetchBlob(x.imageURL, 'image/jpeg');
    let face = null, body = null;
    if(c) try{ face = await idScore(c, b); }catch(e){}
    if(b0) try{ const b1 = await bodyOf(b); const r = b1 && bodyCompare(b0, b1); body = r ? r.pct : null; }catch(e){}
    const sc2 = (face == null ? 70 : face) + (body == null ? 80 : body);
    if(!best || sc2 > best.sc) best = {b, face, body, sc:sc2};
    if((face == null || face >= ID_OK) && (body == null || body >= BODY_OK)) break;
  }
  return best;
}
async function ensureEnd(mk, btn){
  if(!anchorOn(mk) || !C.endPose) return null;
  if(C.end && C.endFor === C.endPose) return C.end;
  const t0 = btn && btn.textContent;
  try{
    const r = await makeEnd(i => { if(btn) btn.textContent = i ? 'Refac cadrul final…' : 'Fac cadrul final…'; });
    if(r){ C.end = r.b; C.endFor = C.endPose; C.endScore = {face:r.face, body:r.body}; renderPrompt(); }
  }catch(e){ C.end = null; toast('Cadrul final n-a ieșit (' + e.message + '); clipul pornește doar din poza de start.', 6000); }
  finally{ if(btn && t0) btn.textContent = t0; }
  return C.end;
}
async function redoEnd(){ C.end = null; C.endFor = null; const b = $('#btnEndRe'); if(b) b.disabled = true; await ensureEnd(S.mk, b); }
async function btnPrepare(){ const b = $('#btnPrep'); b.disabled = true; b.textContent = 'Claude scrie…'; try{ await preparePrompt(); await ensureEnd(S.mk, b); }catch(e){ toast(e.message, 6000); } finally{ b.disabled = false; b.textContent = 'Pregătește promptul'; } }
async function send(final){
  if(!S.rwKey) return toast('Lipsește cheia Runware (Setări).');
  const btn = final ? $('#btnFinal') : $('#btnDraft'); btn.disabled = true;
  try{
    const tmk = final ? S.mk : SCHITA.model;
    if(!C.prompt || (!C.edited && C.promptKey !== promptKey(tmk))){ btn.textContent = 'Claude scrie promptul…'; await preparePrompt(tmk); }
    if(String(C.prompt).trim().length > PROMPT_MAX) throw new Error(`Promptul are ${String(C.prompt).trim().length} caractere; Runware primește cel mult ${PROMPT_MAX}. Scurtează-l sau șterge-l ca să-l refacă Claude.`);
    const mk = final ? S.mk : SCHITA.model, m = MODELE[mk];
    const p = {mk, res:final ? S.res : SCHITA.res, sec:final ? +S.sec : draftSec(+S.sec), audio:final ? (m.audio === 'always' || (m.audio === 'switch' && !!S.audio)) : false, draft:!final, aspect:S.aspect};
    const est = costClip(p.mk, p.res, p.sec, p.audio, p.draft);
    if(isYoung(charById(C.charId))) throw new Error(`Personajul pare sub ${AGE_MIN} de ani: nu se folosește pentru clipuri.`);
    const end = await ensureEnd(mk, btn);
    const startKey = await putBlob('img', C.start), endKey = end && anchorOn(mk) ? await putBlob('img', end) : null;
    const n2 = S.best2 === 'on' ? 2 : 1, gid = n2 > 1 ? uid() : null;   // 1.6: cel mai bun din 2
    for(let k = 0; k < n2; k++){
    const job = {id:uid(), at:Date.now(), charId:C.charId, group:gid, gi:k, text:C.text, prompt:C.prompt, nota:C.nota, steps:C.edited ? [] : (C.steps || []), start:startKey, startScore:C.score ?? null, end:endKey, endPose:C.endPose || '', endScore:endKey ? C.endScore : null, ...p, est:est.usd, estMin:est.min, state:'trimit'};
    jobs.unshift(job); await saveJobs(); renderJobs();
    runJob(job);
    }
    toast((n2 > 1 ? 'Două variante, aleg singur cea mai bună. ' : '') + (final ? 'Clipul final a pornit. Poți închide aplicația; continuă la Runware.' : 'Schița a pornit.'));
  }catch(e){ toast(String(e.message || e), 6000); }
  finally{ btn.disabled = false; renderCostLine(); }
}

/* ───────── lucrări (persistente: se reiau la pornire) ───────── */
const jobTick = {};
// 1.7: o singură verificare grea în telefon odată (coadă)
let VQ = Promise.resolve();
function vAcquire(){ let r; const p = new Promise(x => r = x), prev = VQ; VQ = prev.then(() => p); return prev.then(() => r); }
async function runJob(job, resume, got){
  try{
    if(!job.taskUUID){
      if(resume) throw new Error('Trimiterea s-a întrerupt înainte să ajungă la Runware.');
      let task;
      if(job.kind && job.kind !== 'video') task = await postTask(job);   // 1.6: reparat fața, mărit, voce
      else {
        const start = await DB.get(job.start); if(!start) throw new Error('Poza de start lipsește.');
        const end = job.end ? await DB.get(job.end).catch(() => null) : null;
        task = await videoTask({mk:job.mk, res:job.res, sec:job.sec, audio:job.audio, draft:job.draft, prompt:job.prompt, start, end});
      }
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
    const vid = await putBlob('vid', vb), rw = {uuid:x.videoUUID || null, url:x.videoURL || null};   // 1.6: codul clipului la Runware, pentru prelucrări
    if(job.kind && job.kind !== 'video') return finishPost(job, x, vb, vid, rw, cost);
    let frames = [], score = null, th = null, body = null, check = null;
    const rel = await vAcquire(); try{   // 1.7: verificările din telefon (cadre, față, corp) pe rând: mai multe clipuri gata deodată nu mai umplu memoria
    job.state = 'verific'; updJob(job);
    try{ frames = await videoFrames(vb, 8); }catch(e){}
    if(frames.length) th = await putBlob('th', await toJpeg(frames[Math.min(1, frames.length - 1)], 480, .8));
    const c = charById(job.charId);
    if(c && S.checkFace === 'on' && frames.length){ try{ score = await clipScore(c, frames); }catch(e){} }
    // 1.4: proporțiile corpului în clip față de poza de start (umeri, trunchi, șolduri, brațe, picioare)
    if(S.checkFace === 'on' && frames.length){ job.state = 'corp'; updJob(job); try{ body = await bodyScore(await DB.get(job.start), frames); }catch(e){} }
    // 1.1: au apărut pașii ceruți? (Claude vede 8 cadre)
    if(S.checkSteps !== 'off' && S.clKey && job.steps && job.steps.length && frames.length >= 4){ job.state = 'pasi'; updJob(job); try{ check = await clCheckSteps(job.steps, frames); }catch(e){ check = {err:String(e.message || e).slice(0, 160)}; } }
    } finally { rel(); }
    const clip = {id:uid(), at:Date.now(), charId:job.charId, text:job.text, prompt:job.prompt, nota:job.nota, start:job.start, startScore:job.startScore,
      mk:job.mk, res:job.res, sec:job.sec, audio:job.audio, draft:job.draft, aspect:job.aspect, cost, costReal:+x.cost > 0, vid, th, score, body, steps:job.steps || [], check, end:job.end || null, endScore:job.endScore || null, endPose:job.endPose || '',
      rw, group:job.group || null, storyId:job.storyId || null, seg:job.seg ?? null};
    clips.unshift(clip); await saveClips();
    jobs = jobs.filter(j => j.id !== job.id); await saveJobs();
    if(job.group) await groupDone(job.group);
    if(job.storyId) storyNext(job.storyId);
    if(job.callSet) csGot(job, clip).catch(() => {});   // 1.7: clipul pentru setul de apel
    if(S.autoFix === 'on' && score && score.avg != null && score.avg < ID_OK && rw.uuid && !job.group && !job.callSet) postJob('replace', clip, {res:job.res === '1080p' ? '1080p' : '720p', quiet:true});
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
    if(job.group) groupDone(job.group);
    if(job.storyId) storyPause(job.storyId, job.err);
  }
}
const JOB_AC = {}, JOB_RW = {};   // 1.0.1: oprirea și ce a răspuns Runware ultima dată, pe lucrare
/* 1.6: rezultatul unei prelucrări devine un clip nou, legat de cel de pornire (parent) */
async function finishPost(job, x, vb, vid, rw, cost){
  const src = clips.find(c => c.id === job.src) || {};
  job.state = 'verific'; updJob(job);
  let frames = [], th = null; try{ frames = await videoFrames(vb, 8); }catch(e){}
  if(frames.length) th = await putBlob('th', await toJpeg(frames[Math.min(1, frames.length - 1)], 480, .8));
  let score = src.score || null, body = src.body || null;
  if(job.kind === 'replace' && frames.length){ const c = charById(job.charId); if(c) try{ score = await clipScore(c, frames); }catch(e){} try{ body = await bodyScore(await DB.get(src.start), frames); }catch(e){} }
  const tag = {replace:'fața reparată', upscale:`mărit ${job.opts.res}${job.opts.fps ? ' · ' + job.opts.fps + ' fps' : ''}`, lipsync:'cu voce'}[job.kind];
  const clip = {...src, id:uid(), at:Date.now(), parent:src.id || null, kind:job.kind, tag, vid, th, rw, cost:cost + (job.ttsCost || 0), costReal:+x.cost > 0, score, body,
    res:job.kind === 'upscale' ? job.opts.res : job.kind === 'replace' ? job.opts.res : src.res, lipText:job.kind === 'lipsync' ? job.opts.text : src.lipText || '', group:null, alt:false};
  if(job.callSet && job.kind==='lipsync'){
    clip.callStudio={mode:'scripted',dialogue:job.callSet.dialogue,voice:job.callSet.voice,style:job.callSet.style,role:job.callSet.role};
  }
  clips.unshift(clip); await saveClips();
  jobs = jobs.filter(j => j.id !== job.id); await saveJobs();
  // Nu atribui automat clipul cu dialog fix rolului din apel: Taifas 14.9.2
  // încă ignoră pista audio și ar putea afișa o replică nepotrivită.
  // Clipul final rămâne în galerie cu metadatele callStudio pentru etapa de integrare.
  toast(`Gata: ${tag} · ${usdC(clip.cost)}${job.kind === 'replace' && score && score.avg != null ? ' · fața ' + score.avg + '%' : ''}`, 5000);
  if(!$('#v-creeaza').hidden){ renderJobs(); renderLast(); } else if(!$('#v-galerie').hidden) renderGallery();
}
/* 1.6: cel mai bun din 2 — când ambele variante sunt gata (sau una a eșuat), se alege după față, corp și pași */
const clipMark = x => (x.score && x.score.avg != null ? x.score.avg : 70) + (x.body && x.body.avg != null ? x.body.avg : 80) + (x.check && x.check.n ? 100 * x.check.ok / x.check.n : 70);
async function groupDone(gid){
  if(jobs.some(j => j.group === gid && j.state !== 'eroare')) return;   // mai lucrează una
  const G2 = clips.filter(x => x.group === gid); if(!G2.length) return;
  const best = G2.reduce((a, b) => clipMark(b) > clipMark(a) ? b : a);
  for(const x of G2){ x.best = x === best; x.alt = x !== best; }
  if(G2.length > 1){ const i = clips.indexOf(best); clips.splice(i, 1); clips.unshift(best); }
  await saveClips();
  if(G2.length > 1) toast(`Am ales varianta mai bună: ${best.score && best.score.avg != null ? 'fața ' + best.score.avg + '%' : ''}${best.body && best.body.avg != null ? ' · corpul ' + best.body.avg + '%' : ''}${best.check && best.check.n ? ` · pași ${best.check.ok}/${best.check.n}` : ''}. Cealaltă e în galerie, ca alternativă.`, 6000);
  if(!$('#v-creeaza').hidden) renderLast(); else if(!$('#v-galerie').hidden) renderGallery();
}
const JOB_ST = {voce:'fac vocea', trimit:'se trimite', trimis:'trimis', lucru:'Runware lucrează', descarc:'descarc clipul', verific:'verific fața', corp:'verific corpul', pasi:'verific pașii', eroare:'eroare'};
function jobHTML(j){
  const m = MODELE[j.mk] || {nume:j.mk}, el = jobTick[j.id] ?? Math.round((Date.now() - j.at) / 1000);
  const what = j.kind && j.kind !== 'video' ? {replace:'Repar fața', upscale:'Măresc', lipsync:'Voce și buze'}[j.kind] : (j.storyId ? `Poveste · scena ${j.seg + 1}` : j.draft ? 'Schiță' : 'Final') + (j.group ? ` · varianta ${j.gi + 1}/2` : '');
  return `<div class="job ${j.state === 'eroare' ? 'err' : ''}" id="job-${j.id}"><div><b>${what} · ${esc(m.nume)} ${j.res} · ${j.sec} s</b>
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
  const pick = G.sel && !$('#v-galerie').hidden;
  return `<div class="card ${pick && G.sel.has(x.id) ? 'picked' : ''}" onclick="cardTap('${x.id}')"><div class="th aspect-${String(x.aspect || '9:16').replace(':', 'x')}"><img data-k="${x.th || x.start}" alt="">${pick ? `<span class="pick">${G.sel.has(x.id) ? '✓' : ''}</span>` : '<span class="play">▶</span>'}${x.draft ? '<span class="tag">schiță</span>' : ''}${x.tag ? `<span class="tag t2">${esc(x.tag)}</span>` : ''}${x.alt ? '<span class="tag t3">alternativă</span>' : x.best ? '<span class="tag t3 ok2">ales din 2</span>' : ''}</div>
    <div class="meta"><b>${esc(x.label || (x.text || 'Clip fără nume').slice(0, 58))}</b><span>${esc(c ? c.name : 'Fără personaj')} · ${esc(m.nume)} · ${x.res} · ${x.sec} s · ${usdC(x.cost)}</span>${s && s.avg != null ? `<span class="${s.avg >= ID_OK ? 'ok' : 'warn'}">fața ${s.avg}% (min ${s.min}%)</span>` : ''}${x.body && x.body.avg != null ? `<span class="${x.body.avg >= BODY_OK ? 'ok' : 'warn'}">corpul ${x.body.avg}%</span>` : x.body && x.body.why ? '<span class="muted">corpul: nemăsurabil</span>' : ''}${x.check && x.check.n ? `<span class="${x.check.ok === x.check.n ? 'ok' : 'warn'}">pași ${x.check.ok}/${x.check.n}</span>` : ''}<span class="muted">${when(x.at)}</span></div></div>`;
}
// 1.4: selecția în galerie, pentru ștergere (una, mai multe, toate schițele)
const G = {sel:null};
function renderGallery(){
  const el = $('#gList'), own = clips.filter(x => !x.storyId);   // 1.6: scenele poveștilor stau în povestea lor
  $('#gStories').innerHTML = storyCards();
  el.innerHTML = own.length ? own.map(clipCard).join('') : (stories.length ? '' : '<div class="empty">Niciun clip încă.</div>');
  const tot = clips.reduce((a, x) => a + (x.cost || 0), 0), drafts = clips.filter(x => x.draft).length;
  $('#gSum').textContent = clips.length ? `${clips.length} clipuri · ${usdC(tot)} în total` : '';
  $('#gBar').innerHTML = !clips.length ? '' : G.sel
    ? `<button class="danger" ${G.sel.size ? '' : 'disabled'} onclick="delClips([...G.sel])">🗑 Șterge (${G.sel.size})</button><button class="sm" ${G.sel.size >= 2 && G.sel.size <= MJ_MAX ? '' : 'disabled'} onclick="mjOpen([...G.sel])">🎞 Montaj (${G.sel.size})</button><button class="sm ghost" onclick="selAll()">${G.sel.size === clips.length ? 'Niciunul' : 'Toate'}</button><button class="sm ghost" onclick="selMode(false)">Anulează</button>`
    : `<button class="sm ghost" onclick="selMode(true)">Selectează</button><button class="sm ghost" onclick="mjOpen()">🎞 Montaj AI</button>${drafts ? `<button class="sm ghost danger" onclick="delClips(clips.filter(x => x.draft).map(x => x.id), ${drafts} === 1 ? 'schița' : 'toate cele ${drafts} schițe')">Șterge schițele (${drafts})</button>` : ''}`;
  hydrate(el);
}
function selMode(on){ G.sel = on ? new Set() : null; renderGallery(); }
function selAll(){ G.sel = G.sel.size === clips.length ? new Set() : new Set(clips.map(x => x.id)); renderGallery(); }
function cardTap(id){ if(G.sel && !$('#v-galerie').hidden){ G.sel.has(id) ? G.sel.delete(id) : G.sel.add(id); renderGallery(); } else openClip(id); }
let viewUrl = null;
async function openClip(id){
  const x = clips.find(c => c.id === id); if(!x) return;
  const c = charById(x.charId), m = MODELE[x.mk] || {nume:x.mk}, s = x.score, vb = await DB.get(x.vid);
  if(viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = vb ? URL.createObjectURL(vb) : '';
  sheet(`<video src="${viewUrl}" controls autoplay loop playsinline class="player"></video>
    <section class="box" style="margin:12px 0;padding:12px">
      <h3>Organizează clipul</h3>
      <label>Numele clipului<input id="clipLabel" maxlength="80" value="${esc(x.label || (x.text || '').slice(0, 58))}" placeholder="Ex.: Sharon – vorbește natural"></label>
      <label>Personaj<select id="clipAssignChar"><option value="">Alege personajul</option>${chars.filter(q => !isYoung(q)).map(q => `<option value="${q.id}" ${q.id === x.charId ? 'selected' : ''}>${esc(q.name)}${q.srcId ? '' : ' · nu e importat din Taifas'}</option>`).join('')}</select></label>
      <div class="grid2"><label>Locul din profil<select id="clipAssignPlace">${CS_PLACES.filter(q => q[0] !== 'toate').map(([k,n]) => `<option value="${k}" ${k === 'casa' ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
      <label>Rolul clipului<select id="clipAssignRole">${CS_ROLES.map(([k,n]) => `<option value="${k}" ${k === 'activ' ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label></div>
      <button onclick="assignViewedClip('${x.id}')">Salvează și atribuie profilului</button>
      <p class="muted">Dacă personajul este importat din Taifas, clipul verificat va fi preluat automat la următoarea deschidere a profilului.</p>
    </section>
    <div class="row wrap acts">
      <button onclick="saveClip('${x.id}')">Salvează în telefon</button>
      ${x.draft ? `<button onclick="reuse('${x.id}', true)">Fă clipul final</button>` : ''}
      ${missOf(x).length ? `<button onclick="reuse('${x.id}', false, true)">Refă cu pașii lipsă accentuați</button>` : ''}
      ${weakOf(x) ? `<button onclick="redoClip('${x.id}')">↻ Refă (${weakOf(x)})</button>` : ''}
      ${x.montaj ? '' : `<button class="ghost" onclick="reuse('${x.id}', false)">Refă / modifică</button>`}
      <button class="ghost danger" onclick="delClips(['${x.id}'])">🗑 Șterge</button>
    </div>
    <div class="row wrap posts">
      <button class="sm ghost" onclick="postSheet('${x.id}', 'replace')" ${clipSrc(x) ? '' : 'disabled'}>🙂 Repară fața</button>
      <button class="sm ghost" onclick="postSheet('${x.id}', 'upscale')" ${clipSrc(x) ? '' : 'disabled'}>⬆ Mărește</button>
      <button class="sm ghost" onclick="postSheet('${x.id}', 'lipsync')" ${clipSrc(x) ? '' : 'disabled'}>🗣 Voce</button>
      ${clipSrc(x) ? '' : '<span class="muted">prelucrările merg pe clipurile făcute din 1.6</span>'}
    </div>
    <div class="info"><b>${esc(x.label || (x.text || 'Clip fără nume').slice(0, 58))}</b> · ${esc(c ? c.name : 'Fără personaj')} · ${x.draft ? 'schiță' : 'final'} · ${esc(m.nume)} ${x.res} · ${x.sec} s${x.audio ? ' · cu sunet' : ''} · ${usdC(x.cost)}${x.costReal ? '' : ' (estimat)'}
    ${s && s.avg != null ? `<div class="${s.avg >= ID_OK ? 'ok' : 'warn'}">Fața: ${s.avg}% în medie, cel mai slab cadru ${s.min}% (${s.seen} din ${s.n} cadre)${x.startScore != null ? ' · poza de start ' + x.startScore + '%' : ''}</div>` : s ? '<div class="muted">Fața nu se vede în cadrele verificate.</div>' : ''}
    ${x.lipText ? `<div class="muted">Spune: „${esc(x.lipText)}”</div>` : ''}
    ${bodyLine(x)}${x.end ? `<div class="muted">Cadru final ancorat${x.endScore && x.endScore.face != null ? ` (fața ${x.endScore.face}%${x.endScore.body != null ? ', corpul ' + x.endScore.body + '%' : ''})` : ''}.</div>` : ''}
    ${stepsHTML(x)}
    <div class="muted">${when(x.at)}</div>
    <details><summary>Ce ai cerut</summary><p>${esc(x.text)}</p><p class="mono">${esc(x.prompt)}</p>${x.nota ? `<p class="muted">${esc(x.nota)}</p>` : ''}</details></div>
`);
}
// 1.8.1: redenumire + atribuire directă din vizualizatorul clipului.
async function assignViewedClip(id){
  const x = clips.find(q => q.id === id); if(!x) return;
  const name = ($('#clipLabel')?.value || '').trim();
  const previousCharId = x.charId;
  const charId = $('#clipAssignChar')?.value || '';
  const place = $('#clipAssignPlace')?.value || 'casa';
  const role = $('#clipAssignRole')?.value || 'activ';
  if(!name) return toast('Dă-i un nume clipului.');
  if(!charId) return toast('Alege personajul căruia îi atribui clipul.');
  const c = charById(charId); if(!c) return toast('Personajul nu mai există.');
  if(isYoung(c)) return toast(`Personajul pare sub ${AGE_MIN} de ani: nu se poate folosi pentru clipuri.`, 5000);
  if(!x.vid || !await DB.get(x.vid).catch(() => null)) return toast('Fișierul video lipsește.');
  const set = csGet(c.id, place, true), old = set.clips[role];
  if(old && old !== x.id && !confirm(`Rolul „${csRoleName(role)}” are deja un clip. Îl înlocuiești?`)) return;
  x.label = name; x.charId = c.id; await saveClips();
  if(!set.frame){ const frameKey = previousCharId === c.id ? x.start : c.photo; const frame = frameKey && await DB.get(frameKey).catch(() => null); if(frame) set.frame = await putBlob('img', frame); }
  await csTouch(set);
  closeSheet();
  await csAssign(set, role, x);
  if(!c.srcId) toast('Clip atribuit în Animas. Pentru preluare în Taifas, importă personajul din Taifas și folosește acel profil.', 6500);
  renderGallery();
}
// 1.5: corpul în clip, cu ce s-a măsurat și ce s-a sărit
function bodyLine(x){
  const b = x.body; if(!b) return '';
  if(b.avg == null) return b.why ? `<div class="muted">Corpul: nemăsurabil — ${esc(b.why)}.</div>` : '';
  return `<div class="${b.avg >= BODY_OK ? 'ok' : 'warn'}">Corpul: proporții ${b.avg}% față de poza de start, cel mai slab cadru ${b.min}% (măsurat pe ${b.seen} din ${b.n} cadre${b.skip ? `; ${b.skip} sărite, poziția nu se putea compara` : ''})${b.worst && b.worst.pct >= 5 ? ` · cea mai mare abatere: ${esc(b.worst.r)} ${b.worst.pct}% (la ${String(b.worst.t).replace('.', ',')} s)` : ''}${b.v === 2 ? '' : ' <span class="muted">· măsurat cu metoda veche (1.4), mai puțin sigură</span>'}</div>`;
}
const weakOf = x => [x.score && x.score.avg != null && x.score.avg < ID_OK ? 'fața' : '', x.body && x.body.avg != null && x.body.avg < BODY_OK && x.body.v === 2 ? 'corpul' : ''].filter(Boolean).join(' și ');
// refacere cu același plan și același model; cadrul final se face din nou (alt rezultat)
async function redoClip(id){ await reuse(id, false); C.end = null; C.endFor = null; toast('Scena e în Creează, cu același prompt; cadrul final se reface la trimitere. Apasă „Clip final”.', 6000); }
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
  C.charId = x.charId; C.text = x.text || ''; C.startRaw = await DB.get(x.start); C.start = C.startRaw; C.crop = null; C.box = null; C.body = null; C.bbox = null; C.view = null; C.boxFor = null; C.shift = 0; C.startSrc = 'clip:' + x.id; C.score = x.startScore;
  S.aspect = x.aspect || S.aspect; C.prompt = x.draft ? '' : x.prompt; C.edited = false; C.promptKey = x.draft ? '' : promptKey(x.mk); C.nota = x.nota || '';
  C.steps = x.steps || []; C.fits = true; C.secSuggest = null; C.missing = null;
  C.endPose = x.endPose || ''; C.end = null; C.endFor = null; C.endScore = null;   /* 1.5: cadrul final se face din nou */
  if(fix){ C.missing = missOf(x); C.prompt = ''; C.edited = false; C.steps = []; if(x.mk !== SCHITA.model){ S.mk = x.mk; S.res = x.res; S.sec = x.sec; } }   // 1.1: același model, plan refăcut
  go('creeaza');
  if(final){ toast('Scena e în Creează. Verifică modelul și apasă „Clip final”.', 5000); }
}
// 1.4: șterge unul sau mai multe clipuri din telefon (clipul, miniatura, poza de start dacă nu mai e folosită); spune cât spațiu s-a eliberat
async function delClips(ids, what){
  ids = ids.filter(id => clips.some(c => c.id === id)); if(!ids.length) return;
  if(!window.__noConfirm && !confirm(`Ștergi ${what || (ids.length === 1 ? 'clipul' : ids.length + ' clipuri')} din telefon? Nu se poate anula.`)) return;
  const gone = clips.filter(c => ids.includes(c.id)); clips = clips.filter(c => !ids.includes(c.id)); await saveClips();
  let bytes = 0;
  for(const x of gone){
    const keys = [x.vid, x.th]; if(x.start && !clips.some(c => c.start === x.start) && !jobs.some(j => j.start === x.start)) keys.push(x.start); if(x.end && !clips.some(c => c.end === x.end) && !jobs.some(j => j.end === x.end)) keys.push(x.end);
    for(const k of keys){ if(!k) continue; try{ const b = await DB.get(k); if(b && b.size) bytes += b.size; await DB.del(k); }catch(e){} const u = urlCache.get(k); if(u){ URL.revokeObjectURL(u); urlCache.delete(k); } }
  }
  if(G.sel) ids.forEach(id => G.sel.delete(id));
  closeSheet(); renderGallery(); renderLast();
  toast(`Șters${gone.length === 1 ? '' : 'e'}: ${gone.length} ${gone.length === 1 ? 'clip' : 'clipuri'} · ${(bytes / 1048576).toFixed(1).replace('.', ',')} MB eliberați`);
}

/* ═════════ Personaje ═════════ */
function renderChars(){
  const el = $('#pList');
  el.innerHTML = chars.length ? chars.map(c => `<div class="pc" onclick="editChar('${c.id}')"><img data-k="${c.photo}" alt=""><div><b>${esc(c.name)}</b><span class="muted">${c.src === 'taifas' ? 'din Taifas' : 'creat în Animas'} · fișa ${1 + !!c.face + !!c.full + !!c.side}/4</span>${isYoung(c) ? `<span class="warn">blocat: pare sub ${AGE_MIN} de ani</span>` : ''}</div></div>`).join('') : '<div class="empty">Niciun personaj. Importă-le din Taifas sau creează unul nou.</div>';
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
  ed = c ? {...c, photoB:null, faceB:null, fullB:null, sideB:null} : {id:null, name:'', desc:'', photo:null, face:null, full:null, side:null, photoB:null, faceB:null, fullB:null, sideB:null, ok:false};
  sheet(`<h2>${c ? 'Personaj' : 'Personaj nou'}</h2>
    <label>Nume<input id="eName" value="${esc(ed.name)}" maxlength="40"></label>
    <div class="row"><div class="slot"><img id="ePhoto" data-k="${ed.photo || ''}" alt=""><label class="btn sm">Poza de profil<input type="file" accept="image/*" hidden onchange="edFile(this, 'photo')"></label></div>
      <div class="slot"><img id="eFace" data-k="${ed.face || ''}" alt=""><label class="btn sm ghost">Față de aproape<input type="file" accept="image/*" hidden onchange="edFile(this, 'face')"></label></div></div>
    <div class="row"><div class="slot"><img id="eFull" data-k="${ed.full || ''}" alt=""><label class="btn sm ghost">Tot corpul<input type="file" accept="image/*" hidden onchange="edFile(this, 'full')"></label></div>
      <div class="slot"><img id="eSide" data-k="${ed.side || ''}" alt=""><label class="btn sm ghost">Din profil<input type="file" accept="image/*" hidden onchange="edFile(this, 'side')"></label></div></div>
    <p class="muted">Fișa completă (1.6): fața de aproape și profilul ajută verificarea feței; poza cu tot corpul e reperul pentru proporții la pozele generate și la cadrele finale.</p>
    <label>Descriere fizică (engleză, pentru modele)<textarea id="eDesc" rows="4">${esc(ed.desc || '')}</textarea></label>
    <button class="ghost sm" id="eDescBtn" onclick="edDescribe()">Claude scrie descrierea din poză</button>
    ${c ? '' : `<label class="chk"><input type="checkbox" id="eOk"> Personajul e creat de mine (AI) sau am acordul persoanei din poză.</label>`}
    <div class="row wrap"><button onclick="edSave()">Salvează</button>${c ? `<button class="ghost danger" onclick="delChar('${c.id}')">Șterge</button>` : ''}</div>`);
  hydrate($('#sheet'));
}
async function edFile(inp, which){
  const f = inp.files && inp.files[0]; inp.value = ''; if(!f) return;
  const b = await toJpeg(f, 1600, .93); ed[which + 'B'] = b;
  $({photo:'#ePhoto', face:'#eFace', full:'#eFull', side:'#eSide'}[which]).src = URL.createObjectURL(b);
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
  for(const b of [ed.photoB, ed.faceB, ed.fullB, ed.sideB].filter(Boolean)){
    try{ const f = await faceOf(b, {age:true}); if(f && f.age != null && f.age < AGE_MIN) return toast(`Persoana din poză pare să aibă ${f.age} ani: Animas nu creează personaje care par sub ${AGE_MIN} ani.`, 7000); }catch(e){}
  }
  let c = ed.id ? charById(ed.id) : null;
  if(!c){ c = {id:uid(), src:'nou', at:Date.now()}; chars.push(c); }
  c.name = name; c.desc = $('#eDesc').value.trim();
  if(ed.photoB){ if(c.photo) DB.del(c.photo).catch(() => {}); c.photo = await putBlob('img', ed.photoB); c.full = null; delete c.emb; }
  if(ed.faceB){ if(c.face) DB.del(c.face).catch(() => {}); c.face = await putBlob('img', ed.faceB); delete c.emb; }
  if(ed.fullB){ if(c.full) DB.del(c.full).catch(() => {}); c.full = await putBlob('img', ed.fullB); }
  if(ed.sideB){ if(c.side) DB.del(c.side).catch(() => {}); c.side = await putBlob('img', ed.sideB); delete c.emb; }
  delete c.age;
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
  let n = 0, young = 0;
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
      delete c.emb; delete c.age;
      const ag = await charAge(c).catch(() => null);
      if(ag && ag.young){ for(const kk of [c.photo, c.face, c.full]) if(kk) DB.del(kk).catch(() => {}); chars = chars.filter(x => x !== c); young++; continue; }
      n++;
    }
    const k = $('#tfKeys');
    if(k && k.checked){ const ts = tfList.ts; if(ts.rwKey) S.rwKey = ts.rwKey; if(ts.key && ts.vault !== 'on') S.clKey = ts.key; await saveS(); }
    await saveChars(); closeSheet(); renderChars(); toast(`Importate: ${n} personaje.` + (young ? ` ${young} n-au fost importate: par sub ${AGE_MIN} de ani.` : ''), young ? 7000 : 3200);
    if(!C.charId && chars[0]) C.charId = chars[0].id;
  }catch(e){ toast('Importul s-a oprit: ' + e.message, 7000); }
  finally{ try{ tfDb && tfDb.close(); }catch(e){} tfDb = null; }
}

/* ═════════ Setări ═════════ */
function renderSettings(){
  renderUpd(); checkUpdate(true).catch(() => { UPD.server = null; renderUpd(); });
  $('#sCl').value = S.clKey || ''; $('#sRw').value = S.rwKey || '';
  $('#sUseCl').checked = S.useClaude === 'on'; $('#sFace').checked = S.checkFace === 'on'; $('#sSteps').checked = S.checkSteps !== 'off'; $('#sEnd').checked = S.endFrame !== 'off'; $('#sFix').checked = S.autoFix === 'on'; $('#sBest2').checked = S.best2 === 'on';
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
