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
    res:{'720p':[.025, .025]}, draftUsd:.015, dur:range(1, 20), def:5, audio:'off', size:'resolution', aspects:['9:16', '16:9', '1:1']}
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
// întreabă până e gata. onStatus({st, raw, det}) după fiecare răspuns (ce spune Runware, pentru card și „Detalii”).
// 1.0.1: erorile din lista „errors” se citesc și când lista „data” nu e goală; la clipuri, după 4 minute, la fiecare 2 minute
// se cer și detaliile sarcinii (getTaskDetails): dacă acolo e deja rezultatul sau eroarea, se folosește de acolo.
async function rwWait(taskUUID, kind, {signal, onTick, onStatus, maxMs = 20 * 60e3} = {}){
  const t0 = Date.now(); let net = 0, lastDet = 0;
  for(let i = 0; ; i++){
    await sleep(i ? (kind === 'video' ? 5000 : 1500) : (kind === 'video' ? 8000 : 2000));
    if(signal && signal.aborted) throw new DOMException('Oprit', 'AbortError');
    if(onTick) onTick(Math.round((Date.now() - t0) / 1000));
    let d;
    try{ d = await rwPost([{taskType:'getResponse', taskUUID}], signal); net = 0; }
    catch(e){ if(e.name === 'AbortError') throw e; if(!e.net && !e.busy && !e.notFound) e.taskFailed = true; if((e.net || e.busy) && ++net < 60){ if(onStatus) onStatus({st:'rețea: ' + e.message.slice(0, 80)}); continue; } throw e; }
    const mine = x => x && (!x.taskUUID || x.taskUUID === taskUUID);
    const E = (d.errors || []).filter(mine);
    if(E.length) throw rwFail(E[0].message || E[0].code || 'eroare');
    const L = (d.data || []).filter(mine);
    if(onStatus) onStatus({st:L.map(x => x.status || (x.videoURL || x.imageURL ? 'gata' : '?')).join(', ') || 'fără răspuns', raw:JSON.stringify(d).slice(0, 600)});
    const bad = L.find(x => x.status === 'error');
    if(bad) throw rwFail(bad.message || bad.error || (kind === 'video' ? 'clipul n-a ieșit' : 'poza n-a ieșit'));
    const ok = L.find(x => x.videoURL || x.imageURL || x.imageBase64Data);
    if(ok) return ok;
    if(kind === 'video' && Date.now() - t0 > 4 * 60e3 && Date.now() - lastDet > 2 * 60e3){
      lastDet = Date.now();
      const det = await rwDetails(taskUUID, signal).catch(e => ({state:'necunoscut', msg:e.message}));
      if(onStatus) onStatus({det});
      if(det.state === 'eroare') throw rwFail(det.msg);
      if(det.state === 'gata' && det.item) return det.item;
    }
    if(Date.now() - t0 > maxMs) throw new Error('Runware: durează prea mult. Clipul rămâne în „În lucru”; încearcă din nou mai târziu.');
  }
}
// 1.0.2: sarcina a eșuat la Runware (nu se plătește): mesaj în română pentru creditul insuficient; „Reia” o trimite din nou
function rwFail(msg){
  msg = String(msg || 'eroare'); let t = 'Runware: ' + msg.slice(0, 220);
  if(/insufficient|balance|credit/i.test(msg)){
    const r = msg.match(/([\d.]+)\s*credits? (?:are )?(?:currently )?reserved/i), n = msg.match(/needs\s*([\d.]+)\s*credits?/i);
    t = 'Credit insuficient în contul Runware' + (n ? `: cererea rezervă ${n[1].replace('.', ',')} $` : '') + (r ? `, iar ${r[1].replace('.', ',')} $ sunt deja rezervați pentru alte cereri în lucru` : '')
      + '. Rezervarea e mai mare decât costul clipului și se eliberează la final. Încarcă credit sau așteaptă să se termine celelalte cereri, apoi apasă „Reia”.';
  }
  const e = new Error(t); e.taskFailed = true; e.credit = /insufficient|balance/i.test(msg); return e;
}
// detaliile unei sarcini trimise (cererea originală + răspunsul): {state:'gata'|'eroare'|'lucru'|'necunoscut', msg, item, req}
async function rwDetails(taskUUID, signal){
  let d;
  try{ d = await rwPost([{taskType:'getTaskDetails', taskUUID}], signal); }
  catch(e){ if(e.notFound) return {state:'necunoscut', msg:'Runware nu are această sarcină.'}; throw e; }
  const x = (d.data || []).find(y => y && y.taskUUID === taskUUID) || (d.data || [])[0];
  if(!x) return {state:'necunoscut', msg:'Runware n-a întors detalii.'};
  const req = Array.isArray(x.request) ? x.request[0] : x.request, r = x.response || {};
  if(r.errors && r.errors.length){ const e0 = r.errors[0]; return {state:'eroare', msg:String(e0.message || e0.code || 'eroare').slice(0, 220), req}; }
  const item = (r.data || []).find(y => y && (y.videoURL || y.imageURL));
  if(item) return {state:'gata', msg:'gata', item, req};
  return {state:'lucru', msg:'încă în lucru la Runware', req};
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
// 1.2: limita Runware pentru positivePrompt (2.000 de caractere): verificată înainte de trimitere, fără tăieri pe ascuns
// (1.0–1.1 tăia la 2.500, peste limită, și putea pierde ultimul pas sau regula de final)
function checkLen(prompt){
  const t = String(prompt || '').trim();
  if(!t) throw new Error('Promptul e gol.');
  if(t.length > PROMPT_MAX) throw new Error(`Promptul are ${t.length} caractere; Runware primește cel mult ${PROMPT_MAX}. Scurtează-l (sau lasă-l pe Claude să-l refacă).`);
  return t;
}
// sarcina video din poza de start
async function videoTask({mk, res, sec, audio, draft, prompt, start}){
  const m = MODELE[mk];
  const t = {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:m.id, positivePrompt:checkLen(prompt),
    duration:sec, numberResults:1, outputType:'URL', outputFormat:'MP4',
    inputs:{frameImages:[{image:await dataUri(start, 1280, .92), frame:'first'}]}};
  if(m.size === 'resolution') t.resolution = res;
  if(mk === 'pvideo2'){ t.fps = 24; t.outputQuality = 90; t.settings = {audio:false, draft:!!draft, promptUpsampling:false}; }
  else t.outputQuality = 95;
  if(mk === 'veo31' || mk === 'veo31f') t.providerSettings = {google:{generateAudio:!!audio}};
  if(mk === 'seed25') t.settings = {audio:!!audio};
  return t;
}
