/* Animas 1.6 — povești lungi din mai multe clipuri și alegerea automată a modelului.
   Povestea: Claude o împarte în scene de 4–10 s; fiecare scenă pornește din ultimul cadru al celei dinainte (verificat: dacă fața
   s-a îndepărtat de personaj, cadrul se reface cu fața lui înainte de scena următoare), cu planul, cadrul final ancorat și
   verificările obișnuite. Scenele rulează una după alta, ca lucrări obișnuite (se reiau după repornire). La final: redare
   continuă și „Salvează povestea” (un singur fișier, înregistrat în telefon, în timp real). */
'use strict';

/* ───────── alegerea automată a modelului (reguli, fără cost) ───────── */
const SPEECH_RX = /["„“”]|\b(spune|zice|întreab[ăa]|strig[ăa]|șoptește|soptește|răspunde|cânt[ăa])\b/i;
function fitDur(mk, sec){ const d = MODELE[mk].dur; return d.find(x => x >= sec) || d[d.length - 1]; }
function suggestModel({sec, steps, speech, aspect}){
  let mk, why;
  if(speech && aspect !== '1:1' && sec <= 8){ mk = 'veo31f'; why = 'are replică: Veo face vocea și mișcarea buzelor odată cu clipul'; }
  else if(speech){ mk = 'kling4'; why = 'are replică, iar durata sau formatul nu merg pe Veo'; }
  else if(sec > 10 || steps >= 4){ mk = 'seed25'; why = sec > 10 ? 'clip lung: Seedance ține ordinea pașilor pe durată mare' : 'multe acțiuni: Seedance ține cel mai bine ordinea pașilor'; }
  else if(S.endFrame !== 'off'){ mk = 'kling4'; why = 'cel mai fidel pentru față și corp, cu cadru final ancorat'; }
  else { mk = 'kling4f'; why = 'acțiune simplă: ieftin și bun'; }
  if(!MODELE[mk].aspects.includes(aspect)) { mk = 'kling4'; why += ' (formatul ales)'; }
  const d = fitDur(mk, sec), res = MODELE[mk].res['720p'] ? '720p' : Object.keys(MODELE[mk].res)[0];
  const m = MODELE[mk], au = m.audio === 'always' || (m.audio === 'switch' && !!speech);
  return {mk, sec:d, res, why, cost:costClip(mk, res, d, au, false)};
}
function stepsGuess(text){ return String(text || '').split(/,|;|\bși\b|\bapoi\b|\bdupă care\b/i).map(x => x.trim()).filter(x => x.length > 3).length; }
function recFor(){
  const speech = !!(C.plan && C.plan.speech) || SPEECH_RX.test(C.text || '');
  const steps = C.steps && C.steps.length ? C.steps.length : stepsGuess(C.text);
  return suggestModel({sec:+S.sec, steps, speech, aspect:S.aspect});
}
function renderRec(){
  const el = $('#oRec'); if(!el) return;
  if(!(C.text || '').trim()){ el.innerHTML = ''; return; }
  const r = recFor();
  el.innerHTML = r.mk === S.mk ? `<span class="ok">✓ Modelul ales e cel recomandat</span> <span class="muted">(${esc(r.why)})</span>`
    : `<span class="muted">Recomandat: <b>${esc(MODELE[r.mk].nume)}</b>, ${r.sec} s · ${usdC(r.cost.usd)} — ${esc(r.why)}</span> <button class="sm" onclick="useRec()">Folosește</button>`;
}
function useRec(){ const r = recFor(); S.mk = r.mk; S.sec = r.sec; if(MODELE[r.mk].res[S.res] === undefined) S.res = r.res; renderOpts(); renderRec(); renderPrompt(); toast(`${MODELE[r.mk].nume}, ${r.sec} s. Promptul se rescrie pentru el la trimitere.`); }

/* ───────── poveștile ───────── */
let stories = [];
const saveStories = () => DB.set('stories', stories);
const storyById = id => stories.find(s => s.id === id);
const ST = {plan:null};   // scenele propuse, înainte de pornire
const STORY_RUN = {};

function setMode(m){ if(!['clip', 'poveste', 'apel'].includes(m)) m = 'clip'; S.mode = m; saveS(); $$('.modebtn').forEach(b => b.classList.toggle('on', b.dataset.m === m)); $('#clipPane').hidden = m !== 'clip'; $('#storyPane').hidden = m !== 'poveste'; $('#callPane').hidden = m !== 'apel';
  if(m === 'poveste') renderStoryPlan();
  if(m === 'apel'){ if(S.aspect !== '9:16'){ S.aspect = '9:16'; renderOpts(); applyAspect(); } renderCallSet(); }   // 1.7: setul pentru apel e vertical
  csTick(m === 'apel'); }
async function storySplit(){
  if(!C.start) return toast('Alege întâi poza de start (de aici pornește prima scenă).');
  const text = $('#stText').value.trim(); if(!text) return toast('Scrie povestea.');
  if(!S.clKey) return toast('Povestea are nevoie de Claude (cheia Anthropic, în Setări).');
  const b = $('#btnStSplit'); b.disabled = true; b.textContent = 'Claude împarte…';
  try{
    const c = charById(C.charId), r = await clStory({text, total:+$('#stTotal').value, persona:c && c.desc, start:C.start});
    if(!r.scenes.length) throw new Error(r.nota || 'Claude n-a putut împărți povestea.');
    ST.plan = {title:r.title, text, nota:r.nota, scenes:r.scenes.map(sc => { const g = suggestModel({sec:sc.sec, steps:stepsGuess(sc.ro), speech:SPEECH_RX.test(sc.ro), aspect:S.aspect}); return {...sc, mk:g.mk, sec:g.sec, res:g.res, cost:g.cost.usd}; })};
    renderStoryPlan();
  }catch(e){ toast(e.message, 6000); }
  finally{ b.disabled = false; b.textContent = 'Împarte în scene'; }
}
function renderStoryPlan(){
  const el = $('#stPlan'); if(!el) return;
  const P = ST.plan; if(!P){ el.innerHTML = ''; return; }
  const tot = P.scenes.reduce((a, x) => a + x.cost, 0), dur = P.scenes.reduce((a, x) => a + x.sec, 0), n2 = S.best2 === 'on' ? 2 : 1;
  el.innerHTML = `<label>${esc(P.title)} · ${P.scenes.length} scene · ${dur} s</label><ol class="steps">` + P.scenes.map((x, i) => `<li>${esc(x.ro)} <span class="sec">${x.sec} s · ${esc(MODELE[x.mk].nume)} · ${usdC(x.cost)}</span></li>`).join('') + '</ol>'
    + (P.nota ? `<div class="muted">${esc(P.nota)}</div>` : '')
    + `<div class="muted">Cost estimat: <b>${usdC(tot * n2)}</b>${n2 > 1 ? ' (cel mai bun din 2 pe fiecare scenă)' : ''} + cadre finale și verificări (~1–3 cenți pe scenă). Modelul fiecărei scene e ales automat.</div>`
    + `<div class="row wrap"><button onclick="storyStart(true)">▶ Generează doar prima scenă · ${usdC(P.scenes[0].cost * n2)}</button><button class="sm ghost" onclick="storyStart(false)">▶ Toată povestea · ${usdC(tot * n2)}</button><button class="sm ghost" onclick="ST.plan = null; renderStoryPlan()">Renunță</button></div>`
    + `<div class="muted">Modul scenă cu scenă se oprește automat după fiecare clip finalizat. Continuarea se aprobă separat în Galerie. Costurile de cadre/verificări pot fi suplimentare.</div>`;
}
async function storyStart(stepByStep = false){
  const P = ST.plan; if(!P || !C.start) return;
  const planned=(stepByStep?P.scenes.slice(0,1):P.scenes).reduce((sum,x)=>sum+(+x.cost||0),0)*(S.best2==='on'?2:1);
  if(!approveEstimatedCost(stepByStep?'Prima scenă':'Poveste completă',planned,'Cadrele finale și verificările pot avea costuri suplimentare.'))return;
  if(isYoung(charById(C.charId))) return toast(`Personajul pare sub ${AGE_MIN} de ani: nu se folosește pentru clipuri.`, 5000);
  const st = {id:uid(), at:Date.now(), title:P.title, text:P.text, charId:C.charId, start:await putBlob('img', C.start), aspect:S.aspect, audio:!!S.audio, best2:S.best2 === 'on',
    segs:P.scenes.map(x => ({ro:x.ro, sec:x.sec, mk:x.mk, res:x.res, clip:null, job:null})), state:'lucru',
    stepByStep:!!stepByStep, stepAllowance:stepByStep ? 1 : null};
  stories.unshift(st); await saveStories(); ST.plan = null; renderStoryPlan();
  toast('Povestea a pornit: scenele se fac una după alta. Poți închide aplicația; la redeschidere continuă.', 6000);
  storyNext(st.id);
}
// ultimul cadru al unui clip (de aici pornește scena următoare)
async function lastFrame(vb){
  if(!(vb instanceof Blob) || !vb.size) throw new Error('Clipul anterior lipsește; continuarea a fost oprită fără costuri.');
  const u = URL.createObjectURL(vb), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const waitVideo = (event, ms) => new Promise((resolve, reject) => {
    let timer;
    const done = (error) => { clearTimeout(timer); v.removeEventListener(event, ok); v.removeEventListener('error', bad); error ? reject(error) : resolve(); };
    const ok = () => done();
    const bad = () => done(new Error('Videoclipul anterior nu poate fi decodat.'));
    v.addEventListener(event, ok, {once:true}); v.addEventListener('error', bad, {once:true});
    timer = setTimeout(() => done(new Error('Timeout la citirea videoclipului anterior.')), ms);
  });
  try{
    const ready = waitVideo('loadedmetadata', 20000); v.src = u; await ready;
    if(!Number.isFinite(v.duration) || v.duration <= 0 || !v.videoWidth || !v.videoHeight)
      throw new Error('Durata sau dimensiunile clipului anterior sunt invalide.');
    const canvas = document.createElement('canvas'); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    if(!ctx) throw new Error('Nu se poate extrage cadrul video.');
    const offsets = [.12, .35, .75, 1.25].filter(x => x < v.duration);
    for(const offset of offsets.length ? offsets : [Math.min(.05, v.duration / 2)]){
      const target = Math.max(0, v.duration - offset);
      const seek = waitVideo('seeked', 8000); v.currentTime = target; await seek;
      ctx.drawImage(v, 0, 0);
      const sample = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let bright = 0, count = 0;
      const step = Math.max(4, Math.floor(sample.length / 4000 / 4) * 4);
      for(let k=0;k<sample.length;k+=step){ bright += sample[k]+sample[k+1]+sample[k+2]; count++; }
      if(count && bright/(count*3) > 9) return await cvBlob(canvas, .95);
    }
    throw new Error('Ultimele cadre sunt negre; verifică finalul clipului înainte de continuare.');
  }finally{ URL.revokeObjectURL(u); try{ v.pause(); v.removeAttribute('src'); v.load(); }catch(e){} }
}
// scorul feței la legătura dintre scene (ultimul cadru al scenei dinainte)
async function linkScore(c, b){ return idScore(c, b); }
// fața s-a îndepărtat în ultimul cadru: același cadru, refăcut cu fața personajului (klein 9B)
async function reanchor(start, c){
  let fc = c.face ? await DB.get(c.face).catch(() => null) : null; if(!fc) fc = await DB.get(c.photo).catch(() => null); if(!fc) return null;
  const im = await loadImg(URL.createObjectURL(start)), sc = Math.min(1, 1280 / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.max(256, Math.round(im.naturalWidth * sc / 16) * 16), h = Math.max(256, Math.round(im.naturalHeight * sc / 16) * 16);
  const t = kleinTask('Image 1 is a frame of a video. Recreate image 1 exactly: the same pose, body, clothes, place, light, camera and framing, but give the person the face of image 2 (same person, same facial features, hair and distinctive marks). Photorealistic, no text.', [await dataUri(start, 1280), await dataUri(fc, 768)], w, h);
  await rwSend(t); const x = await rwWait(t.taskUUID, 'image'); if(+x.cost > 0) addCost('runware', +x.cost);
  return x.imageBase64Data ? await (await fetch('data:image/jpeg;base64,' + x.imageBase64Data)).blob() : await fetchBlob(x.imageURL, 'image/jpeg');
}
function storyPause(sid, why){ const st = storyById(sid); if(!st || st.state === 'gata') return; st.state = 'pauză'; st.err = String(why || '').slice(0, 200); saveStories(); toast('Povestea s-a oprit la o scenă: ' + st.err + ' Apasă „Reia” pe lucrare sau „Continuă” în galerie.', 8000); }
async function storyNext(sid){
  const st = storyById(sid); if(!st || st.state === 'gata' || st.state === 'oprit' || STORY_RUN[sid]) return;
  // o scenă e gata când clipul ei (cel ales, dacă sunt 2) există; cea în lucru are o lucrare
  for(const g of st.segs){ if(!g.clip){ const cl = clips.filter(x => x.storyId === sid && x.seg === st.segs.indexOf(g) && !x.alt); if(cl.length && !jobs.some(j => j.storyId === sid && j.seg === st.segs.indexOf(g))) g.clip = cl[0].id; } }
  const i = st.segs.findIndex(g => !g.clip);
  if(i < 0){ st.state = 'gata'; await saveStories(); toast(`Povestea „${st.title}” e gata: ${st.segs.length} scene.`, 6000); if(!$('#v-galerie').hidden) renderGallery(); return; }
  if(jobs.some(j => j.storyId === sid && j.seg === i)) return;   // scena e deja în lucru
  if(st.stepByStep && !(st.stepAllowance > 0)){
    st.state = 'așteaptă'; await saveStories();
    if(!$('#v-galerie').hidden) renderGallery();
    toast('Scena este gata. Verifică rezultatul în Galerie și aprobă următoarea scenă.', 6000);
    return;
  }
  STORY_RUN[sid] = true; st.state = 'lucru'; st.err = ''; await saveStories();
  try{
    const g = st.segs[i], c = charById(st.charId);
    const prev = i > 0 ? clips.find(x => x.id === st.segs[i - 1].clip) : null;
    if(i > 0 && !prev) throw new Error('Scena anterioară nu mai există; continuarea a fost oprită.');
    let start = i === 0 ? await DB.get(st.start) : await lastFrame(await DB.get(prev.vid));
    if(!(start instanceof Blob) || !start.size) throw new Error('Cadrul de pornire lipsește; continuarea a fost oprită.');
    if(i > 0 && c){ const f = await linkScore(c, start).catch(() => null); if(f != null && f < ID_OK){ const r = await reanchor(start, c).catch(() => null); if(r) start = r; } }
    let view = null; try{ view = bodyView(await bodyOf(start)); }catch(e){}
    const r = await planFor({text:g.ro, start, mk:g.mk, sec:g.sec, audio:st.audio, c, framing:view && view.en});
    if(!r.video) throw new Error(r.nota || 'Claude a refuzat scena.');
    let end = null, endScore = null;
    if(anchorOn(g.mk) && r.plan && r.plan.endPose){ try{ const e = await makeEndFor({start, endPose:r.plan.endPose, c}); if(e){ end = e.b; endScore = {face:e.face, body:e.body}; } }catch(e){} }
    const m = MODELE[g.mk], au = m.audio === 'always' || (m.audio === 'switch' && st.audio), est = costClip(g.mk, g.res, g.sec, au, false);
    const startKey = await putBlob('img', start), endKey = end ? await putBlob('img', end) : null;
    const n2 = st.best2 ? 2 : 1, gid = n2 > 1 ? uid() : null;
    for(let k = 0; k < n2; k++){
      const job = {id:uid(), at:Date.now(), charId:st.charId, group:gid, gi:k, storyId:sid, seg:i, text:g.ro, prompt:r.video, nota:r.nota, steps:r.steps || [], start:startKey, startScore:null,
        end:endKey, endPose:(r.plan && r.plan.endPose) || '', endScore, mk:g.mk, res:g.res, sec:g.sec, audio:au, draft:false, aspect:st.aspect, est:est.usd, estMin:est.min, state:'trimit'};
      jobs.unshift(job); await saveJobs(); runJob(job);
    }
    if(st.stepByStep) st.stepAllowance = Math.max(0, (st.stepAllowance || 0) - 1);
    await saveStories();
    renderJobs();
  }catch(e){ storyPause(sid, e.message || e); }
  finally{ delete STORY_RUN[sid]; }
}
function storyStop(sid){ const st = storyById(sid); if(!st) return; st.state = 'oprit'; saveStories(); closeSheet(); renderGallery(); toast('Povestea e oprită; scenele făcute rămân. „Continuă” o pornește iar.'); }
function storyResume(sid){
  const st = storyById(sid); if(!st || st.state === 'gata') return;
  if(st.stepByStep){
    if(jobs.some(j => j.storyId === sid)) return toast('Există deja o scenă în lucru.');
    st.stepAllowance = 1;
  }
  if(continuityNeedsApproval(st)) return toast('Verifică și acceptă tranziția înainte de următoarea scenă.',6000);
  const next=st.segs.find(x=>!x.clip);
  if(next){const m=MODELE[next.mk],estimated=costClip(next.mk,next.res,next.sec,m.audio==='always'||(m.audio==='switch'&&st.audio),false).usd*(st.best2?2:1);
    if(!approveEstimatedCost(st.stepByStep?'Scena următoare':'Reluarea poveștii',estimated,'Estimare pentru scena imediat următoare; în modul automat pot urma și alte scene.'))return;}
  st.state = 'lucru'; saveStories(); closeSheet(); storyNext(sid);
  toast(st.stepByStep ? 'Se generează doar scena următoare.' : 'Povestea continuă.');
}
const storyClips = st => st.segs.map(g => g.clip && clips.find(x => x.id === g.clip)).filter(Boolean);
// 1.12.2: verificare locală, fără API, a saltului vizual la îmbinarea dintre două clipuri.
// Scorul măsoară diferența de pixeli, NU identitatea facială și nu este un procent de asemănare.
async function continuityFrame(blob, atEnd){
  if(!(blob instanceof Blob) || !blob.size) throw new Error('Clip lipsă');
  const url = URL.createObjectURL(blob), v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto';
  const wait = (event, timeout=12000) => new Promise((resolve,reject)=>{
    let t; const clean=()=>{clearTimeout(t);v.removeEventListener(event,ok);v.removeEventListener('error',bad);};
    const ok=()=>{clean();resolve();},bad=()=>{clean();reject(new Error('Nu se poate decoda cadrul video'));};
    v.addEventListener(event,ok,{once:true});v.addEventListener('error',bad,{once:true});
    t=setTimeout(()=>{clean();reject(new Error('Timeout decodare video'));},timeout);
  });
  try{
    const meta=wait('loadedmetadata');v.src=url;await meta;
    if(!Number.isFinite(v.duration)||v.duration<=0||!v.videoWidth) throw new Error('Metadate video invalide');
    const seek=wait('seeked');v.currentTime=atEnd?Math.max(0,v.duration-.15):Math.min(.12,v.duration/2);await seek;
    const cv=document.createElement('canvas');cv.width=64;cv.height=64;
    const ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,64,64);
    return ctx.getImageData(0,0,64,64).data;
  }finally{URL.revokeObjectURL(url);try{v.pause();v.removeAttribute('src');v.load();}catch(e){}}
}
async function continuityCheck(st){
  if(!st.stepByStep) return;
  const cs=storyClips(st), i=cs.length-1;
  if(i<1) return;
  st.continuity=st.continuity||{};
  const key=cs[i-1].id+'|'+cs[i].id;
  if(st.continuity[key]) return;
  try{
    const [a,b]=await Promise.all([DB.get(cs[i-1].vid),DB.get(cs[i].vid)]);
    const [x,y]=await Promise.all([continuityFrame(a,true),continuityFrame(b,false)]);
    let sum=0;for(let k=0;k<x.length;k+=4)sum+=(Math.abs(x[k]-y[k])+Math.abs(x[k+1]-y[k+1])+Math.abs(x[k+2]-y[k+2]))/3;
    const delta=Math.round(sum/(x.length/4)/255*100);
    st.continuity[key]={delta, warning:delta>=18, accepted:false};
  }catch(e){st.continuity[key]={delta:null,warning:true,accepted:false,error:e.message};}
  await saveStories();
}
function continuityApprove(sid){
  const st=storyById(sid);if(!st)return;
  const cs=storyClips(st), key=cs.length>1?cs[cs.length-2].id+'|'+cs[cs.length-1].id:null;
  if(key&&st.continuity&&st.continuity[key]){st.continuity[key].accepted=true;saveStories();}
  openStory(sid);
}
function continuityStatus(st){
  const cs=storyClips(st);if(!st.stepByStep||cs.length<2)return '';
  const key=cs[cs.length-2].id+'|'+cs[cs.length-1].id;
  const r=st.continuity&&st.continuity[key];
  if(!r)return '<div class="muted">Verificarea continuității este în curs…</div>';
  return `<div class="muted"><b>Continuity Lock:</b> ${r.error?'Comparația nu a reușit: '+esc(r.error):'Diferență vizuală între cadre: '+r.delta+'% (metrică de pixeli, nu identitate).'} ${r.warning?'⚠ Posibil salt vizibil. Compară manual cele două clipuri.':'Diferență redusă; verifică totuși vizual.'}</div>`
    +(r.accepted?'<div class="ok">✓ Tranziție acceptată manual</div>':`<button class="sm ghost" onclick="continuityApprove('${st.id}')">✓ Am verificat și accept tranziția</button>`);
}
// 1.13: instrumente locale de inspecție, exclusiv din clipurile deja salvate.
// 1.13.1: două playere pregătite înainte de redare; evităm schimbarea src pe același player.
// 1.13.2: două playere + cadru de rezervă și jurnal local pentru diagnostic.
let transitionSession = null;
function stopTransitionPreview(){
  const t=transitionSession; transitionSession=null;
  if(!t)return;
  t.stopped=true;
  for(const v of t.players){
    try{v.pause();v.ontimeupdate=null;v.onended=null;v.removeAttribute('src');v.load();}catch(_){}
  }
  for(const u of t.urls)URL.revokeObjectURL(u);
}
async function storyPreviewTransition(sid){
  const st=storyById(sid);if(!st)return;
  const cs=storyClips(st);if(cs.length<2)return toast('Ai nevoie de două scene finalizate.');
  stopTransitionPreview();
  const slot=$('#transitionPreview');if(!slot)return;
  slot.textContent='Pregătesc local ambele clipuri…';
  let urls=[];
  try{
    const pair=cs.slice(-2),blobs=await Promise.all(pair.map(c=>DB.get(c.vid)));
    if(blobs.some(b=>!(b instanceof Blob)||!b.size))throw Error('Lipsește un videoclip salvat.');
    urls=blobs.map(b=>URL.createObjectURL(b));
    const old=$('#stPlayer');if(old)old.pause();
    slot.innerHTML=`<b>Previzualizare gratuită: ultimele 2 s → primele 2 s</b>
      <div class="muted" id="transitionInfo">Pregătesc ambele clipuri local, fără Runware.</div>
      <div class="transition-stack" style="position:relative;overflow:hidden;background:#000;border-radius:12px;aspect-ratio:9/16;max-height:65vh">
        <video id="transitionA" playsinline muted preload="auto" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:1"></video>
        <video id="transitionB" playsinline muted preload="auto" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0"></video>
        <canvas id="transitionHold" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:0;pointer-events:none"></canvas>
      </div>
      <div class="row wrap"><button class="sm ghost" id="transitionReplay" disabled onclick="storyPreviewTransition('${sid}')">↻ Repetă tranziția</button></div>
      <details><summary>Diagnostic redare (local, fără API)</summary><pre id="transitionLog" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:200px;overflow:auto"></pre></details>`;
    const players=[$('#transitionA'),$('#transitionB')];
    const hold=$('#transitionHold'),info=$('#transitionInfo'),replay=$('#transitionReplay');
    const session={urls,players,stopped:false,events:[]};transitionSession=session;
    const log=(msg)=>{
      if(session.stopped)return;
      const line=`${new Date().toLocaleTimeString()} ${msg}`;
      session.events.push(line);
      if(session.events.length>70)session.events.shift();
      const el=$('#transitionLog');if(el)el.textContent=session.events.join('\n');
    };
    const wait=(v,event,timeout=12000)=>new Promise((resolve,reject)=>{
      let timer;
      const clean=()=>{clearTimeout(timer);v.removeEventListener(event,ok);v.removeEventListener('error',bad);};
      const ok=()=>{clean();resolve();},bad=()=>{clean();reject(Error('Nu se poate decoda clipul.'));};
      v.addEventListener(event,ok,{once:true});v.addEventListener('error',bad,{once:true});
      timer=setTimeout(()=>{clean();reject(Error('Timeout la pregătirea clipului.'));},timeout);
    });
    players.forEach((v,i)=>['loadedmetadata','loadeddata','canplay','playing','waiting','stalled','error'].forEach(ev=>
      v.addEventListener(ev,()=>log(`Scena ${i+1}: ${ev} (${v.currentTime.toFixed(2)}s, readyState=${v.readyState})`))
    ));
    await Promise.all(players.map(async(v,i)=>{const ready=wait(v,'loadedmetadata');v.src=urls[i];await ready;}));
    if(session.stopped)return;
    const startA=Math.max(0,players[0].duration-2),endA=Math.max(startA,players[0].duration-.05);
    const endB=Math.min(2,players[1].duration);
    await Promise.all(players.map(async(v,i)=>{
      const target=i===0?startA:0;
      if(target>.02){const seek=wait(v,'seeked');v.currentTime=target;await seek;}
      else if(v.readyState<2)await wait(v,'loadeddata');
    }));
    if(session.stopped)return;
    if(replay)replay.disabled=false;
    if(info)info.textContent='Clipurile sunt pregătite. La schimbare păstrăm ultimul cadru până pornește următorul.';
    const a=players[0],b=players[1];
    let switched=false;
    const captureHold=()=>{
      try{
        if(!a.videoWidth||!a.videoHeight)return false;
        hold.width=a.videoWidth;hold.height=a.videoHeight;
        hold.getContext('2d').drawImage(a,0,0,hold.width,hold.height);
        hold.style.opacity='1';return true;
      }catch(e){log('Captura cadrului nu a reușit: '+e.message);return false;}
    };
    const switchToB=async()=>{
      if(switched||session.stopped)return;switched=true;
      log('Încep schimbarea; păstrez cadrul A până la primul cadru B.');
      captureHold();
      a.pause();
      // B rămâne invizibil până ce redarea a pornit efectiv.
      try{
        if(b.readyState<2)await wait(b,'loadeddata',10000);
        if(session.stopped)return;
        const playing=wait(b,'playing',10000);
        const started=b.play();
        await Promise.all([playing,started]);
        if(session.stopped)return;
        // Lăsăm compositorului un cadru pentru a afișa efectiv imaginea B.
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(session.stopped)return;
        b.style.opacity='1';a.style.opacity='0';hold.style.opacity='0';
        log('Scena B vizibilă, readyState='+b.readyState);
      }catch(e){
        log('Scena B nu a pornit: '+e.message);
        if(info)info.textContent='Scena următoare nu a pornit. Cadrul precedent rămâne afișat; apasă Repetă tranziția.';
        // Nu eliminăm cadrul de rezervă în caz de eroare.
      }
    };
    a.ontimeupdate=()=>{if(a.currentTime>=endA)void switchToB();};
    a.onended=()=>void switchToB();
    b.ontimeupdate=()=>{if(b.currentTime>=endB){b.pause();b.ontimeupdate=null;if(info)info.textContent='Previzualizare încheiată. Poți repeta gratuit.';log('Previzualizare încheiată');}};
    await a.play();
    log('Redarea scenei A a început');
  }catch(e){
    stopTransitionPreview();
    urls.forEach(u=>{try{URL.revokeObjectURL(u)}catch(_){}});
    if(slot)slot.textContent='Previzualizarea nu a reușit: '+e.message;
  }
}
async function storyCompareFrames(sid){
  const st=storyById(sid);if(!st)return;
  const cs=storyClips(st);if(cs.length<2)return toast('Ai nevoie de două scene finalizate.');
  const slot=$('#transitionFrames');if(!slot)return;
  slot.textContent='Extrag cadrele local…';
  try{
    const pair=cs.slice(-2),blobs=await Promise.all(pair.map(c=>DB.get(c.vid)));
    const frames=await Promise.all([continuityFrame(blobs[0],true),continuityFrame(blobs[1],false)]);
    const labels=['Final scenă precedentă','Început scenă următoare'];
    slot.innerHTML='<div class="row wrap" style="align-items:flex-start">'+frames.map((pixels,i)=>{
      const cv=document.createElement('canvas');cv.width=64;cv.height=64;
      cv.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels),64,64),0,0);
      return '<div style="flex:1;min-width:120px"><b>'+labels[i]+'</b><img style="display:block;width:100%;image-rendering:auto;border-radius:8px" alt="'+labels[i]+'" src="'+cv.toDataURL('image/png')+'"></div>';
    }).join('')+'</div><div class="muted">Cadre reduse la 64×64 pentru comparația locală; nu sunt imagini HD.</div>';
  }catch(e){slot.textContent='Comparația nu a reușit: '+e.message;}
}
function continuityNeedsApproval(st){
  if(!st.stepByStep)return false;
  const cs=storyClips(st);if(cs.length<2)return false;
  const key=cs[cs.length-2].id+'|'+cs[cs.length-1].id;
  return !st.continuity||!st.continuity[key]||!st.continuity[key].accepted;
}


/* ───────── galerie: cardurile poveștilor și redarea continuă ───────── */
function storyCards(){
  if(!stories.length) return '';
  return '<h3>Povești</h3><div class="cards">' + stories.map(st => {
    const cs = storyClips(st), dur = cs.reduce((a, x) => a + (x.sec || 0), 0), cost = clips.filter(x => x.storyId === st.id).reduce((a, x) => a + (x.cost || 0), 0);
    return `<div class="card" onclick="openStory('${st.id}')"><div class="th aspect-${String(st.aspect || '9:16').replace(':', 'x')}"><img data-k="${(cs[0] && (cs[0].th || cs[0].start)) || st.start}" alt=""><span class="play">▶</span><span class="tag t3">${cs.length}/${st.segs.length} scene</span></div>
      <div class="meta"><b>${esc(st.title)}</b><span>${dur} s · ${usdC(cost)}</span><span class="${st.state === 'gata' ? 'ok' : st.state === 'pauză' ? 'warn' : 'muted'}">${{lucru:'se face…', gata:'gata', pauză:'oprită la o scenă', oprit:'oprită', 'așteaptă':'așteaptă aprobarea'}[st.state] || st.state}</span></div></div>`;
  }).join('') + '</div><h3>Clipuri</h3>';
}
let storyUrls = [];
async function openStory(sid){
  const st = storyById(sid); if(!st) return;
  const cs = storyClips(st);
  await continuityCheck(st);
  stopTransitionPreview();
  storyUrls.forEach(u => URL.revokeObjectURL(u)); storyUrls = [];
  for(const x of cs){ const b = await DB.get(x.vid); if(b) storyUrls.push(URL.createObjectURL(b)); }
  sheet(`<h2>${esc(st.title)}</h2>${storyUrls.length ? '<video id="stPlayer" controls autoplay playsinline class="player"></video>' : '<div class="empty">Nicio scenă gata încă.</div>'}
    <div class="row wrap acts">
      ${storyUrls.length ? `<button onclick="exportStory('${st.id}')">⬇ Salvează povestea</button>` : ''}
      ${st.state === 'gata' ? '' : st.state === 'lucru' ? `<button class="ghost" onclick="storyStop('${st.id}')">■ Oprește</button>` : `<button onclick="storyResume('${st.id}')">${st.stepByStep ? '▶ Scena următoare · ' + usdC((() => { const g = st.segs.find(x => !x.clip); return g ? costClip(g.mk, g.res, g.sec, MODELE[g.mk].audio === 'always' || (MODELE[g.mk].audio === 'switch' && st.audio), false).usd * (st.best2 ? 2 : 1) : 0; })()) : '▶ Continuă'}</button>`}
      <button class="ghost danger" onclick="storyDelete('${st.id}')">🗑 Șterge povestea</button>
    </div>
    ${continuityStatus(st)}
    ${cs.length>=2 ? `<div class="row wrap"><button class="sm ghost" onclick="storyPreviewTransition('${st.id}')">▶ Previzualizează tranziția (gratuit)</button><button class="sm ghost" onclick="storyCompareFrames('${st.id}')">▣ Compară cadrele (gratuit)</button></div><div id="transitionPreview"></div><div id="transitionFrames"></div>` : ''}
    ${st.stepByStep ? `<div class="muted">Mod scenă cu scenă · ${cs.length}/${st.segs.length} finalizate. ${st.state === 'așteaptă' ? 'Verifică scena înainte să aprobi următoarea.' : ''}</div>` : ''}
    ${st.err ? `<div class="errtxt">${esc(st.err)}</div>` : ''}
    <ol class="steps">${st.segs.map((g, i) => { const x = g.clip && clips.find(c => c.id === g.clip); return `<li>${esc(g.ro)} <span class="sec">${g.sec} s · ${esc(MODELE[g.mk].nume)}</span> ${x ? `<a href="#" onclick="event.preventDefault(); openClip('${x.id}')">${x.score && x.score.avg != null ? 'fața ' + x.score.avg + '%' : 'scena'}${x.body && x.body.avg != null ? ' · corpul ' + x.body.avg + '%' : ''}</a>` : '<span class="muted">nefăcută</span>'}</li>`; }).join('')}</ol>`);
  const v = $('#stPlayer');
  if(v){ let k = 0; v.src = storyUrls[0]; v.onended = () => { k++; if(k < storyUrls.length){ v.src = storyUrls[k]; v.play().catch(() => {}); } }; }
}
async function storyDelete(sid){
  const st = storyById(sid); if(!st) return;
  if(!confirm(`Ștergi povestea „${st.title}” și toate scenele ei din telefon? Nu se poate anula.`)) return;
  st.state = 'oprit';
  jobs = jobs.filter(j => j.storyId !== sid); await saveJobs();
  const ids = clips.filter(x => x.storyId === sid).map(x => x.id);
  stories = stories.filter(s => s !== st); await saveStories();
  window.__noConfirm = true; try{ await delClips(ids, 'povestea'); }finally{ window.__noConfirm = false; }
  if(!clips.some(x => x.start === st.start)) DB.del(st.start).catch(() => {});
  closeSheet(); renderGallery(); renderJobs();
}
/* un singur fișier: scenele redate una după alta pe o pânză, cu sunetul lor, înregistrate în telefon (durează cât povestea) */
async function exportStory(sid){
  const st = storyById(sid), cs = storyClips(st); if(!cs.length) return;
  const vs = [];
  for(const x of cs){ const b = await DB.get(x.vid); if(b) vs.push(URL.createObjectURL(b)); }
  const v = document.createElement('video'); v.playsInline = true; v.crossOrigin = 'anonymous'; v.src = vs[0];
  await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('scena nu se poate citi')); });
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; const g = cv.getContext('2d');
  const stream = cv.captureStream(30);
  let ac = null; try{ ac = new AudioContext(); const srcN = ac.createMediaElementSource(v), dst = ac.createMediaStreamDestination(); srcN.connect(dst); dst.stream.getAudioTracks().forEach(t => stream.addTrack(t)); }catch(e){}
  const types = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'], mime = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, mime ? {mimeType:mime, videoBitsPerSecond:8e6} : {}), parts = [];
  rec.ondataavailable = e => { if(e.data && e.data.size) parts.push(e.data); };
  const done = new Promise(res => rec.onstop = res);
  let alive = true; const draw = () => { if(!alive) return; if(v.videoWidth) g.drawImage(v, 0, 0, cv.width, cv.height); requestAnimationFrame(draw); };
  toast(`Înregistrez povestea (${cs.reduce((a, x) => a + (x.sec || 0), 0)} s). Lasă ecranul deschis.`, 8000);
  rec.start(500); draw();
  for(let k = 0; k < vs.length; k++){
    if(k){ v.src = vs[k]; await new Promise(res => v.onloadeddata = res); }
    await v.play().catch(() => {});
    await new Promise(res => { v.onended = res; });
  }
  alive = false; rec.stop(); await done; try{ ac && ac.close(); }catch(e){}
  vs.forEach(u => URL.revokeObjectURL(u));
  const ext = /mp4/.test(rec.mimeType || mime) ? 'mp4' : 'webm', blob = new Blob(parts, {type:(rec.mimeType || mime || 'video/webm').split(';')[0]});
  const name = `animas-poveste-${st.title.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40)}.${ext}`, f = new File([blob], name, {type:blob.type});
  window.__lastExport = {size:blob.size, type:blob.type, name};
  try{ if(navigator.canShare && navigator.canShare({files:[f]})){ await navigator.share({files:[f], title:st.title}); return; } }catch(e){ if(e.name === 'AbortError') return; }
  const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
}
