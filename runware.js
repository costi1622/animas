/* Animas — Runware: poze (FLUX.2 klein 9B) și clipuri (modelele video), cerere asincronă + întrebare până e gata.
   Prețurile din MODELE sunt cele publicate de Runware (verificate 19.11.2026); costul real vine în răspuns (includeCost). */
'use strict';
const RW_URL = 'https://api.runware.ai/v1';
const RW_KLEIN = 'runware:400@2';

/* res: rezoluție → [$/s fără sunet, $/s cu sunet] (null = preț nepublicat de Runware; afișăm „de la” prețul cunoscut)
   size: cum se cere mărimea când dăm primul cadru ('none' = urmează poza, 'resolution' = câmpul resolution)
   audio: 'always' (nu se poate opri), 'switch' (se poate alege), 'off' (fără sunet)
   aspects: formatele pe care le acceptă modelul */
const MODELE = {
  kling4f: {id:'klingai:kling-video@4.0-flash', nume:'Kling 4.0 Flash', rol:'final, ieftin',
    res:{'720p':[.094, .094]}, dur:range(3, 20), def:5, audio:'always', size:'none', aspects:['9:16', '16:9', '1:1']},
  kling4: {id:'klingai:kling-video@4.0', nume:'Kling 4.0', rol:'final, cel mai fidel',
    res:{'720p':[.157, .157], '1080p':null}, dur:range(3, 30), def:5, audio:'always', size:'resolution', aspects:['9:16', '16:9', '1:1']},
  veo31: {id:'google:3@2', nume:'Veo 3.1', rol:'final, cinematic',
    res:{'720p':[.20, .40], '1080p':[.20, .40], '4K':[.40, .60]}, dur:[4, 6, 7, 8], def:8, audio:'switch', size:'resolution', aspects:['9:16', '16:9']},
  veo31f: {id:'google:3@3', nume:'Veo 3.1 Fast', rol:'final, rapid',
    res:{'720p':[.10, .15], '1080p':[.10, .15], '4K':[.30, .35]}, dur:[4, 6, 7, 8], def:8, audio:'switch', size:'resolution', aspects:['9:16', '16:9']},
  seed25: {id:'bytedance:seedance@2.5', nume:'Seedance 2.5', rol:'clipuri lungi',
    res:{'480p':[.1025, .1025], '720p':[.23, .23], '1080p':[.614, .614], '4K':[.921, .921]}, dur:range(4, 30), def:5, audio:'switch', size:'resolution', aspects:['9:16', '16:9', '1:1']},
  pvideo2: {id:'prunaai:p-video@2', nume:'P-Video-2', rol:'schiță',
    res:{'720p':[.025, .025]}, draftUsd:.015, dur:range(4, 8), def:5, audio:'off', size:'resolution', aspects:['9:16', '16:9', '1:1']}
};
function range(a, b){ const o = []; for(let i = a; i <= b; i++) o.push(i); return o; }
const SCHITA = {model:'pvideo2', res:'720p', draft:true};

// costul estimat: {usd, min} — min=true când prețul exact nu e publicat (afișăm „de la”)
function costClip(mk, res, sec, audio, draft){
  const m = MODELE[mk]; if(!m) return {usd:0, min:false};
  if(draft && m.draftUsd) return {usd:m.draftUsd * sec, min:false};
  const p = m.res[res];
  if(p) return {usd:p[audio && m.audio !== 'off' ? 1 : 0] * sec, min:false};
  const known = Object.values(m.res).filter(Boolean).map(x => x[0]);
  return {usd:Math.max(...known) * sec, min:true};
}

const rwKey = () => String(S.rwKey || '').trim();
function rwHeaders(){ return {'content-type':'application/json', authorization:'Bearer ' + rwKey()}; }
async function rwPost(body, signal){
  let r, d = null;
  try{ r = await fetch(RW_URL, {method:'POST', signal, headers:rwHeaders(), body:JSON.stringify(body)}); }
  catch(e){ if(e.name === 'AbortError') throw e; const er = new Error('Runware nu răspunde (rețea).'); er.net = true; throw er; }
  try{ d = await r.json(); }catch(e){}
  const errs = d && (d.errors || (d.error ? [d.error] : null));
  if(!r.ok || (errs && errs.length && !(d && Array.isArray(d.data) && d.data.length))){
    const e0 = errs && errs[0], m = String(typeof e0 === 'string' ? e0 : (e0 && (e0.message || e0.code)) || ('HTTP ' + r.status));
    const er = new Error('Runware: ' + m.slice(0, 220) + (/credit|balance|insufficient/i.test(m) ? ' (reîncarcă creditul în contul Runware)' : ''));
    er.status = r.status; er.notFound = /not ?found|taskNotFound|does not exist/i.test(m + ' ' + ((e0 && e0.code) || '')); er.busy = r.status === 429 || r.status >= 500 || /overload|high demand|rate.?limit|temporarily/i.test(m);
    throw er;
  }
  return d || {};
}
// trimite o sarcină asincronă (cu reîncercare dacă Runware e aglomerat); întoarce taskUUID
async function rwSend(task, signal){
  task.deliveryMethod = 'async'; task.includeCost = true;
  for(let t = 0; ; t++){
    try{ await rwPost([task], signal); return task.taskUUID; }
    catch(e){ if(!e.busy || t >= 3) throw e; await sleep([3000, 6000, 12000][t]); }
  }
}
// întreabă până e gata; onTick(secunde) pentru progres. Rezultatul: elementul din data
async function rwWait(taskUUID, kind, {signal, onTick, maxMs = 20 * 60e3} = {}){
  const t0 = Date.now(); let net = 0;
  for(let i = 0; ; i++){
    await sleep(i ? (kind === 'video' ? 5000 : 1500) : (kind === 'video' ? 8000 : 2000));
    if(signal && signal.aborted) throw new DOMException('Oprit', 'AbortError');
    if(onTick) onTick(Math.round((Date.now() - t0) / 1000));
    let d;
    try{ d = await rwPost([{taskType:'getResponse', taskUUID}], signal); net = 0; }
    catch(e){ if(e.name === 'AbortError') throw e; if((e.net || e.busy) && ++net < 60) continue; throw e; }
    const L = (d.data || []).filter(x => x && (!x.taskUUID || x.taskUUID === taskUUID));
    const bad = L.find(x => x.status === 'error');
    if(bad) throw new Error('Runware: ' + String(bad.message || bad.error || (kind === 'video' ? 'clipul n-a ieșit' : 'poza n-a ieșit')).slice(0, 220));
    const ok = L.find(x => x.videoURL || x.imageURL || x.imageBase64Data || x.status === 'success');
    if(ok && (ok.videoURL || ok.imageURL || ok.imageBase64Data)) return ok;
    if(Date.now() - t0 > maxMs) throw new Error('Runware: durează prea mult. Clipul rămâne în „În lucru”; încearcă din nou mai târziu.');
  }
}
async function fetchBlob(u, type){
  for(let k = 0; k < 5; k++){
    try{ const r = await fetch(u); if(r.ok){ const b = await r.blob(); if(b.size > 1000) return b.type ? b : new Blob([b], {type}); } }catch(e){}
    await sleep(2500);
  }
  throw new Error('Nu pot descărca rezultatul de la Runware.');
}
const dataUri = async (b, px = 1280, q = .92) => 'data:image/jpeg;base64,' + await b64(await toJpeg(b, px, q));

// poza de start generată: FLUX.2 klein 9B cu reperele personajului (fața + poza întreagă)
function kleinTask(prompt, refs, w, h){
  return {taskType:'imageInference', taskUUID:crypto.randomUUID(), model:RW_KLEIN, positivePrompt:String(prompt).slice(0, 10000),
    width:w, height:h, numberResults:1, outputType:'URL', outputFormat:'JPG', outputQuality:94, acceleration:'none',
    seed:Math.floor(Math.random() * 4294967295), ...(refs.length ? {inputs:{referenceImages:refs}} : {})};
}
// sarcina video din poza de start
async function videoTask({mk, res, sec, audio, draft, prompt, start}){
  const m = MODELE[mk];
  const t = {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:m.id, positivePrompt:String(prompt).slice(0, 2500),
    duration:sec, numberResults:1, outputType:'URL', outputFormat:'MP4',
    inputs:{frameImages:[{image:await dataUri(start, 1280, .92), frame:'first'}]}};
  if(m.size === 'resolution') t.resolution = res;
  if(mk === 'pvideo2'){ t.fps = 24; t.outputQuality = 90; t.settings = {audio:false, draft:!!draft, promptUpsampling:false}; }
  else t.outputQuality = 95;
  if(mk === 'veo31' || mk === 'veo31f') t.providerSettings = {google:{generateAudio:!!audio}};
  if(mk === 'seed25') t.settings = {audio:!!audio};
  return t;
}
