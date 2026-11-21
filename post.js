/* Animas 1.9.1 — postprocesare video. TTS: Gemini 3.8 Flash TTS (Runware),
   cu voce si stil selectabile; lip-sync: sync lipsync-2. */
'use strict';
const POST = {
  replace:{id:'prunaai:p-video@replace', usd:{'720p':.03, '1080p':.06}},
  upscale:{id:'prunaai:p-video@upscale', usd:{'720p':[.01, .02, .0035], '1080p':[.02, .04, .007], '2k':[.04, .08, .014], '4k':[.08, .16, .028]}, cap:{'720p':2400, '1080p':1200, '2k':600, '4k':300}},
  lipsync:{id:'sync:lipsync-2@1', usd:.044},
  tts:{id:'google:gemini@3.8-flash-tts'}
};
const clipSrc = x => x && (x.rw && (x.rw.uuid || x.rw.url)) || null;
function costReplace(x, res){ return POST.replace.usd[res] * Math.ceil(x.sec || 5); }
function costUpscale(x, res, fps, turbo){ const r = POST.upscale.usd[res]; return (turbo ? r[2] : fps > 30 ? r[1] : r[0]) * Math.ceil(x.sec || 5); }
function upscaleFits(x, res, fps){ return Math.ceil(x.sec || 5) * Math.min(30, fps) <= POST.upscale.cap[res]; }
function costLipsync(x){ return POST.lipsync.usd * Math.ceil(x.sec || 5); } // minim estimat: TTS se taxeaza separat

function replaceTask(src, refs, res){
  return {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:POST.replace.id, resolution:res, outputType:'URL', outputFormat:'MP4',
    positivePrompt:'Replace the person in the source video with the same person from reference image 1 (the first frame of this very video, same clothes): keep the face, hair, distinctive features, body build and clothing exactly as in the references' + (refs.length > 1 ? '; reference image 2 is a close-up of the same face, for facial detail' : '') + '. Keep the motion, timing, camera, light and audio of the source.',
    inputs:{video:src, referenceImages:refs}, preserveAudio:true, sourceAudioSync:true};
}
function upscaleTask(src, res, fps, turbo){
  return {taskType:'upscale', taskUUID:crypto.randomUUID(), model:POST.upscale.id, resolution:res, fps, outputType:'URL', outputFormat:'MP4', inputs:{video:src}, ...(turbo ? {settings:{turbo:true}} : {})};
}
const POST_VOICES = [
  ['Gacrux','Feminină · matură'], ['Sulafat','Feminină · caldă'],
  ['Vindemiatrix','Feminină · blândă'], ['Achernar','Feminină · delicată'],
  ['Despina','Feminină · fluidă'], ['Callirrhoe','Feminină · relaxată'],
  ['Aoede','Feminină · luminoasă'], ['Kore','Feminină · fermă'],
  ['Zephyr','Feminină · expresivă'], ['Charon','Masculină · informativă'],
  ['Algieba','Masculină · fluidă'], ['Achird','Masculină · prietenoasă']
];
const POST_STYLES = {
  warm:'Speak in a warm, calm, affectionate, mature and natural conversational voice, with gentle pacing and subtle smiles. Do not overact.',
  neutral:'Speak clearly and naturally, at a conversational pace, without theatrical delivery.',
  playful:'Speak with a friendly, gently playful tone, natural rhythm and light expressiveness.',
  soothing:'Speak softly, reassuringly and unhurriedly, with natural pauses and clear diction.'
};
function ttsTask(text, voice, style){
  if(!String(text || '').trim()) throw new Error('Textul pentru voce este gol.');
  return {taskType:'audioInference', taskUUID:crypto.randomUUID(), model:POST.tts.id,
    outputType:'URL', outputFormat:'MP3',
    speech:{text:String(text).trim().slice(0, 4000), voice:POST_VOICES.some(v => v[0] === voice) ? voice : 'Gacrux'},
    settings:{style:POST_STYLES[style] || POST_STYLES.warm}};
}
function postVoice(c){ return c && POST_VOICES.some(v => v[0] === c.postVoice) ? c.postVoice : 'Gacrux'; }
function postStyle(c){ return c && POST_STYLES[c.postStyle] ? c.postStyle : 'warm'; }
function postSaveVoice(charId, voice, style){
  const c = charById(charId);
  if(!c) return;
  c.postVoice = POST_VOICES.some(v => v[0] === voice) ? voice : 'Gacrux';
  c.postStyle = POST_STYLES[style] ? style : 'warm';
  saveChars();
}
function postStartVoice(id){
  const x = clips.find(c => c.id === id);
  if(!x) return toast('Clipul nu mai există.');
  const t = ($('#plText').value || '').trim();
  if(!t) return toast('Scrie ce spune.');
  const voice = $('#plVoice').value, style = $('#plStyle').value;
  postSaveVoice(x.charId, voice, style);
  postJob('lipsync', x, {text:t, voice, style});
}
function lipsyncTask(src, audioUrl){
  return {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:POST.lipsync.id, outputType:'URL', outputFormat:'MP4',
    providerSettings:{sync:{syncMode:'bounce', temperature:.5}}, inputs:{video:src, audio:audioUrl}};
}
// pornește o prelucrare ca lucrare obișnuită (se vede în „În lucru”, se reia după repornire)
async function postJob(kind, x, opts){
  if(!S.rwKey) return toast('Lipsește cheia Runware (Setări).');
  const src = clipSrc(x); if(!src) return toast('Clipul e dinainte de 1.6 (fără codul de la Runware): nu se poate prelucra. Merge pe clipurile noi.', 6000);
  const est = kind === 'replace' ? costReplace(x, opts.res) : kind === 'upscale' ? costUpscale(x, opts.res, opts.fps, opts.turbo) : costLipsync(x);
  const job = {id:uid(), at:Date.now(), kind, src:x.id, charId:x.charId, mk:x.mk, res:opts.res || x.res, sec:x.sec, aspect:x.aspect, draft:x.draft, est, opts, state:'trimit', text:x.text, prompt:x.prompt};
  jobs.unshift(job); await saveJobs();
  if(!opts.quiet){ closeSheet(); go('creeaza'); } renderJobs();
  runJob(job);
  toast(opts.quiet ? `Fața a ieșit sub ${ID_OK}%: o repar automat (${usdC(est)}).` : {replace:'Repararea feței a pornit.', upscale:'Mărirea a pornit.', lipsync:'Dublajul a pornit.'}[kind] + ' ' + usdC(est), 5000);
}
// sarcina Runware a unei prelucrări (lipsync: întâi vocea, o singură dată — adresa ei se ține pe lucrare)
async function postTask(job){
  const x = clips.find(c => c.id === job.src); if(!x) throw new Error('Clipul de pornire a fost șters.');
  const src = clipSrc(x), c = charById(job.charId);
  if(job.kind === 'replace'){
    const refs = [await dataUri(await DB.get(x.start), 1280)];
    const fc = c && c.face ? await DB.get(c.face).catch(() => null) : null; if(fc) refs.push(await dataUri(fc, 768));
    return replaceTask(src, refs, job.opts.res);
  }
  if(job.kind === 'upscale') return upscaleTask(src, job.opts.res, job.opts.fps, job.opts.turbo);
  if(job.kind === 'lipsync'){
    if(!job.audioUrl){
      job.state = 'voce'; updJob(job);
      const t = ttsTask(job.opts.text, job.opts.voice || postVoice(c), job.opts.style || postStyle(c)); await rwSend(t);
      const a = await rwWait(t.taskUUID, 'image', {maxMs:5 * 60e3});
      if(!a || typeof a.audioURL !== 'string' || !/^https:\/\//i.test(a.audioURL)) throw new Error('Runware nu a returnat un audioURL HTTPS valid; lip-sync nu a fost pornit.');
      job.audioUrl = a.audioURL; job.ttsCost = +a.cost || 0; await saveJobs();
      if(job.ttsCost > 0) addCost('runware', job.ttsCost);
    }
    return lipsyncTask(src, job.audioUrl);
  }
  throw new Error('Prelucrare necunoscută.');
}

/* ───────── foile de alegere din clip ───────── */
function postSheet(id, kind){
  const x = clips.find(c => c.id === id); if(!x) return;
  if(!clipSrc(x)) return toast('Clipul e dinainte de 1.6 (fără codul de la Runware): nu se poate prelucra. Merge pe clipurile noi.', 6000);
  if(kind === 'replace'){
    sheet(`<h2>🙂 Repară fața</h2><p class="muted">P-Video-Replace pune în clip persoana din poza de start a clipului (aceleași haine) și portretul de aproape; mișcarea, camera și sunetul rămân. Fața și corpul se măsoară din nou.</p>
      <label>Rezoluție<select id="prRes"><option value="720p">720p · ${usdC(costReplace(x, '720p'))}</option><option value="1080p">1080p · ${usdC(costReplace(x, '1080p'))}</option></select></label>
      <button onclick="postJob('replace', clips.find(c => c.id === '${x.id}'), {res:$('#prRes').value})">Repară fața</button>`);
  } else if(kind === 'upscale'){
    sheet(`<h2>⬆ Mărește și fluidizează</h2><p class="muted">P-Video-Upscale: rezoluție mai mare, iar peste sursa de cadre pe secundă se inventează cadre intermediare (mișcare mai fluidă). Sunetul rămâne.</p>
      <div class="grid2"><label>Rezoluție<select id="puRes" onchange="upCost('${x.id}')"><option>1080p</option><option value="2k">2K</option><option value="4k">4K</option><option>720p</option></select></label>
      <label>Cadre pe secundă<select id="puFps" onchange="upCost('${x.id}')"><option>24</option><option selected>30</option><option>60</option></select></label></div>
      <label class="chk"><input type="checkbox" id="puTurbo" onchange="upCost('${x.id}')"> Rapid (turbo: mai ieftin, calitate puțin mai slabă)</label>
      <div id="puCost" class="muted"></div><button id="puGo" onclick="postJob('upscale', clips.find(c => c.id === '${x.id}'), {res:$('#puRes').value, fps:+$('#puFps').value, turbo:$('#puTurbo').checked})">Mărește</button>`);
    upCost(x.id);
  } else if(kind === 'lipsync'){
    const c = charById(x.charId);
    const voiceOptions = POST_VOICES.map(v => `<option value="${v[0]}"${v[0] === postVoice(c) ? ' selected' : ''}>${v[0]} — ${v[1]}</option>`).join('');
    const styleOptions = [['warm','Cald, matur, afectuos'],['neutral','Natural, neutru'],['playful','Jucăuș, prietenos'],['soothing','Liniștitor, delicat']]
      .map(v => `<option value="${v[0]}"${v[0] === postStyle(c) ? ' selected' : ''}>${v[1]}</option>`).join('');
    sheet(`<h2>🗣 Voce și buze</h2><p class="muted">Gemini 3.8 Flash TTS generează vocea în limba textului (română, engleză, spaniolă sau combinații). Apoi sync lipsync-2 sincronizează buzele. Pentru ${x.sec} s, încearcă un text scurt, aproximativ ${Math.round(x.sec * 13)} de caractere.</p>
      <label>Ce spune<textarea id="plText" rows="4" maxlength="4000" oninput="lsCost('${x.id}')"></textarea></label>
      <div class="grid2"><label>Voce<select id="plVoice">${voiceOptions}</select></label><label>Ton<select id="plStyle">${styleOptions}</select></label></div>
      <div id="plCost" class="muted"></div>
      <button onclick="postStartVoice('${x.id}')">Pune vocea</button>
      <p class="muted">Vocea și tonul alese se păstrează pentru personaj. Costul vocii se adaugă separat, conform răspunsului Runware. Audio mai lung decât clipul poate fi tăiat la sincronizare.</p>`);
    lsCost(x.id);
  }
}
function upCost(id){
  const x = clips.find(c => c.id === id), res = $('#puRes').value, fps = +$('#puFps').value, tb = $('#puTurbo').checked, ok = upscaleFits(x, res, fps);
  $('#puCost').innerHTML = ok ? `Cost: <b>${usdC(costUpscale(x, res, fps, tb))}</b> (${x.sec} s)` : `<span class="warn">Prea lung pentru ${res}: Runware primește cel mult ${POST.upscale.cap[res]} de cadre (${x.sec} s × ${Math.min(30, fps)}). Alege o rezoluție mai mică.</span>`;
  $('#puGo').disabled = !ok;
}
function lsCost(id){
  const x = clips.find(c => c.id === id); if(!x) return;
  const n = ($('#plText').value || '').length;
  $('#plCost').innerHTML = `Cost minim estimat: <b>${usdC(costLipsync(x))}</b> pentru lip-sync (${x.sec} s) + costul TTS calculat de Runware. Text: ${n} caractere. Costul total nu poate fi garantat înainte de generare.`;
}
