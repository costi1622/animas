/* Animas 1.6 — după clip: reparatul feței (P-Video-Replace), mărirea și fluidizarea (P-Video-Upscale), vocea multilingvă
   (Gemini 3.8 Flash TTS) cu sincronizarea buzelor (sync lipsync-2). Toate pornesc de la clipul deja făcut la Runware (codul lui),
   deci clipurile vechi (dinainte de 1.6, fără cod) nu se pot prelucra. Prețuri Runware verificate 20.11.2026. */
'use strict';
const POST = {
  replace:{id:'prunaai:p-video@replace', usd:{'720p':.03, '1080p':.06}},
  upscale:{id:'prunaai:p-video@upscale', usd:{'720p':[.01, .02, .0035], '1080p':[.02, .04, .007], '2k':[.04, .08, .014], '4k':[.08, .16, .028]}, cap:{'720p':2400, '1080p':1200, '2k':600, '4k':300}},
  lipsync:{id:'sync:lipsync-2@1', usd:.044},
  tts:{id:'google:gemini@3.8-flash-tts', usdChar:.00022} // estimare orientativă; Gemini facturează pe tokeni
};
const clipSrc = x => x && (x.rw && (x.rw.uuid || x.rw.url)) || null;
function costReplace(x, res){ return POST.replace.usd[res] * Math.ceil(x.sec || 5); }
function costUpscale(x, res, fps, turbo){ const r = POST.upscale.usd[res]; return (turbo ? r[2] : fps > 30 ? r[1] : r[0]) * Math.ceil(x.sec || 5); }
function upscaleFits(x, res, fps){ return Math.ceil(x.sec || 5) * Math.min(30, fps) <= POST.upscale.cap[res]; }
function costLipsync(x, chars){ return POST.lipsync.usd * Math.ceil(x.sec || 5) + POST.tts.usdChar * chars; }

function replaceTask(src, refs, res){
  return {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:POST.replace.id, resolution:res, outputType:'URL', outputFormat:'MP4',
    positivePrompt:'Replace the person in the source video with the same person from reference image 1 (the first frame of this very video, same clothes): keep the face, hair, distinctive features, body build and clothing exactly as in the references' + (refs.length > 1 ? '; reference image 2 is a close-up of the same face, for facial detail' : '') + '. Keep the motion, timing, camera, light and audio of the source.',
    inputs:{video:src, referenceImages:refs}, preserveAudio:true, sourceAudioSync:true};
}
function upscaleTask(src, res, fps, turbo){
  return {taskType:'upscale', taskUUID:crypto.randomUUID(), model:POST.upscale.id, resolution:res, fps, outputType:'URL', outputFormat:'MP4', inputs:{video:src}, ...(turbo ? {settings:{turbo:true}} : {})};
}
const TTS_VOICES = ['Gacrux','Sulafat','Vindemiatrix','Achernar','Despina','Callirrhoe','Aoede','Autonoe','Erinome','Kore','Laomedeia','Zephyr'];
const TTS_STYLES = {
  warm:'Warm, mature, affectionate, calm, natural conversational pace.',
  gentle:'Soft, soothing, gentle, unhurried and reassuring.',
  playful:'Warm, playful, friendly, lightly smiling, natural pace.',
  neutral:'Clear, natural, conversational delivery without exaggeration.'
};
function ttsTask(text, voice, style){
  return {taskType:'audioInference', taskUUID:crypto.randomUUID(), model:POST.tts.id,
    outputType:'URL', outputFormat:'MP3',
    speech:{text:String(text).slice(0, 4000), voice:TTS_VOICES.includes(voice) ? voice : 'Gacrux'},
    settings:{style:TTS_STYLES[style] || TTS_STYLES.warm}};
}
function lipsyncTask(src, audioUrl){
  return {taskType:'videoInference', taskUUID:crypto.randomUUID(), model:POST.lipsync.id, outputType:'URL', outputFormat:'MP4',
    providerSettings:{sync:{syncMode:'bounce', temperature:.5}}, inputs:{video:src, audio:audioUrl}};
}
// pornește o prelucrare ca lucrare obișnuită (se vede în „În lucru”, se reia după repornire)
async function postJob(kind, x, opts){
  if(!S.rwKey) return toast('Lipsește cheia Runware (Setări).');
  const src = clipSrc(x); if(!src) return toast('Clipul e dinainte de 1.6 (fără codul de la Runware): nu se poate prelucra. Merge pe clipurile noi.', 6000);
  const est = kind === 'replace' ? costReplace(x, opts.res) : kind === 'upscale' ? costUpscale(x, opts.res, opts.fps, opts.turbo) : costLipsync(x, (opts.text || '').length);
  const job = {id:uid(), at:Date.now(), kind, src:x.id, charId:x.charId, mk:x.mk, res:opts.res || x.res, sec:x.sec, aspect:x.aspect, draft:x.draft, est, opts, callSet:opts.callSet||null, state:'trimit', text:x.text, prompt:x.prompt};
  jobs.unshift(job); await saveJobs();
  if(!opts.quiet){ closeSheet(); go('creeaza'); } renderJobs();
  runJob(job);
  toast(opts.quiet ? (kind==='lipsync' ? `Generez vocea și sincronizarea buzelor (${usdC(est)} estimat).` : `Fața a ieșit sub ${ID_OK}%: o repar automat (${usdC(est)}).`) : {replace:'Repararea feței a pornit.', upscale:'Mărirea a pornit.', lipsync:'Dublajul a pornit.'}[kind] + ' ' + usdC(est), 5000);
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
    if(!job.audioUrl && job.opts.reuseAudioUrl){
      job.audioUrl = job.opts.reuseAudioUrl;
      job.ttsCost = 0;
      await saveJobs();
    }
    if(!job.audioUrl){
      job.state = 'voce'; updJob(job);
      const t = ttsTask(job.opts.text, job.opts.voice || (c && c.ttsVoice), job.opts.style || (c && c.ttsStyle));
      let a, sending = false;
      try{
        if(!job.ttsUUID){
          if(job.voiceStudio){ job.ttsUUID = t.taskUUID; await saveJobs(); }
          sending = true; await rwSend(t); sending = false;
        }
        a = await rwWait(job.ttsUUID || t.taskUUID, 'image', {maxMs:5 * 60e3});
      }catch(e){
        if(e.notFound || e.taskFailed || (sending && !e.net)) delete job.ttsUUID;
        throw e;
      }
      if(a && +a.cost > 0) addCost('runware', +a.cost);
      if(!a || !a.audioURL || !/^https:\/\//i.test(a.audioURL)) throw new Error('Runware nu a returnat un URL audio valid. Dublajul nu a fost pornit.');
      job.audioUrl = a.audioURL; job.ttsCost = +a.cost || 0; await saveJobs();
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
    const selectedVoice = (c && c.ttsVoice) || 'Gacrux';
    const selectedStyle = (c && c.ttsStyle) || 'warm';
    sheet(`<h2>🗣 Voce și buze</h2><p class="muted">Scrie replica în română, engleză sau spaniolă. Gemini 3.8 Flash TTS detectează limba automat, apoi sincronizăm buzele cu audio generat. Pentru ${x.sec} s, încearcă un text scurt.</p>
      <label>Ce spune<textarea id="plText" rows="4" maxlength="4000" oninput="lsCost('${x.id}')"></textarea></label>
      <div class="grid2"><label>Voce<select id="plVoice">${TTS_VOICES.map(v => `<option value="${v}" ${v===selectedVoice?'selected':''}>${v}</option>`).join('')}</select></label>
      <label>Stil<select id="plStyle">${Object.keys(TTS_STYLES).map(k => `<option value="${k}" ${k===selectedStyle?'selected':''}>${({warm:'Cald, matur, afectuos',gentle:'Blând, liniștitor',playful:'Jucăuș',neutral:'Neutru'})[k]}</option>`).join('')}</select></label></div>
      <div id="plCost" class="muted"></div><button onclick="const t=$('#plText').value.trim(); if(!t) return toast('Scrie ce spune.'); const c=charById('${x.charId}'); if(c){c.ttsVoice=$('#plVoice').value;c.ttsStyle=$('#plStyle').value;saveChars();} postJob('lipsync', clips.find(c => c.id === '${x.id}'), {text:t,voice:$('#plVoice').value,style:$('#plStyle').value})">Pune vocea</button>
      <p class="muted">Vocea și stilul se memorează pentru personaj. Costul vocal este orientativ; costul real vine de la Runware.</p>`);
    lsCost(x.id);
  }
}
function upCost(id){
  const x = clips.find(c => c.id === id), res = $('#puRes').value, fps = +$('#puFps').value, tb = $('#puTurbo').checked, ok = upscaleFits(x, res, fps);
  $('#puCost').innerHTML = ok ? `Cost: <b>${usdC(costUpscale(x, res, fps, tb))}</b> (${x.sec} s)` : `<span class="warn">Prea lung pentru ${res}: Runware primește cel mult ${POST.upscale.cap[res]} de cadre (${x.sec} s × ${Math.min(30, fps)}). Alege o rezoluție mai mică.</span>`;
  $('#puGo').disabled = !ok;
}
function lsCost(id){ const x = clips.find(c => c.id === id), n = ($('#plText').value || '').length; $('#plCost').innerHTML = `Cost estimat: <b>${usdC(costLipsync(x, n))}</b> (buze ${usdC(POST.lipsync.usd * Math.ceil(x.sec))} + voce ≈ ${usdC(POST.tts.usdChar * n)}; costul real apare după)`; }

/* 1.9.6: relansare lip-sync cu exact același audio și video sursă.
   Nu pretinde aliniere fonemică: modelul extern decide mișcarea gurii.
   Refolosim audio-ul deja generat pentru a evita costul și variația TTS. */
function lipRetrySheet(id){
  const voiced = clips.find(c => c.id === id);
  if(!voiced || voiced.kind !== 'lipsync' || !voiced.lipAudioUrl || !voiced.parent)
    return toast('Acest clip nu are audio reutilizabil. Funcția este disponibilă pentru clipurile noi din 1.9.6.', 6500);
  const original = clips.find(c => c.id === voiced.parent);
  if(!original || !clipSrc(original)) return toast('Videoclipul original nu mai este disponibil.', 6000);
  const estimated = POST.lipsync.usd * Math.ceil(original.sec || 5);
  sheet(`<h2>🎙 Re-sincronizează buzele</h2>
    <p class="muted">Folosește exact aceeași voce și videoclipul original. Nu regenerează vocea, nu suprascrie clipurile existente. O nouă încercare poate îmbunătăți sincronizarea, dar nu garantează potrivirea fiecărui cuvânt.</p>
    <p class="muted">Cost estimat suplimentar: <b>${usdC(estimated)}</b> (numai lip-sync). Compară apoi cele două versiuni în galerie.</p>
    <button id="lipRetryGo">Încearcă din nou · ${usdC(estimated)}</button>`);
  const button = document.getElementById('lipRetryGo');
  if(button) button.onclick=()=>postJob('lipsync', original, {
    text:voiced.lipText, reuseAudioUrl:voiced.lipAudioUrl,
    voice:voiced.lipVoice||'Gacrux', style:voiced.lipStyle||'warm',
    callSet:voiced.callStudio ? {...voiced.callStudio} : null
  });
}
