/* Animas — Claude: rescrie ce vrei tu (în română) în promptul pe care îl înțelege modelul video și se uită la poza de start.
   Prețul Claude Sonnet 5.5: $2 / 1M tokeni la intrare, $10 / 1M la ieșire (verificat 19.11.2026). */
'use strict';
const CL_PRICE = {'claude-sonnet-5-5':[2, 10]};
const clKey = () => String(S.clKey || '').trim();
function clCost(model, u){ const p = CL_PRICE[model] || CL_PRICE['claude-sonnet-5-5']; return ((u.input_tokens || 0) * p[0] + (u.output_tokens || 0) * p[1]) / 1e6; }

async function claudeCall(system, content, {max = 1200, signal} = {}){
  if(!clKey()) throw new Error('Lipsește cheia Anthropic (Setări).');
  const model = S.clModel || 'claude-sonnet-5-5';
  let r, d = null;
  try{
    r = await fetch('https://api.anthropic.com/v1/messages', {method:'POST', signal,
      headers:{'content-type':'application/json', 'x-api-key':clKey(), 'anthropic-version':'2023-06-01', 'anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({model, max_tokens:max, system, messages:[{role:'user', content}]})});
  }catch(e){ if(e.name === 'AbortError') throw e; throw new Error('Claude nu răspunde (rețea).'); }
  try{ d = await r.json(); }catch(e){}
  if(!r.ok || !d || d.type === 'error') throw new Error('Claude: ' + String((d && d.error && d.error.message) || ('HTTP ' + r.status)).slice(0, 220));
  const text = (d.content || []).filter(x => x.type === 'text').map(x => x.text).join('').trim();
  const usd = clCost(model, d.usage || {});
  addCost('claude', usd);
  return {text, usd};
}
function jsonOut(t){
  const m = String(t).match(/\{[\s\S]*\}/); if(!m) throw new Error('Claude n-a întors formatul așteptat.');
  return JSON.parse(m[0]);
}
const imgBlock = async (b, px = 1024) => ({type:'image', source:{type:'base64', media_type:'image/jpeg', data:await b64(await toJpeg(b, px, .88))}});

/* 1.2: Claude nu mai scrie promptul liber. Dă PLANUL structurat (scena, ce se vede în poza de start, pașii pe secunde cu
   fazele fiecăruia, camera, sunetul); promptul îl asamblează aplicația (prompt.js), pe strategia fiecărui model și sub
   limita de 2.000 de caractere. Așa nicio cerință nu se pierde la tăiere și fiecare model primește forma care îi convine. */
const SYS_PLAN = `You turn the user's request (written in Romanian) into a precise, timed action plan for an image-to-video model. The app builds the final video prompt from your JSON, so write each field as plain English the video model will read. The person in the start photo must do EXACTLY what the user asked: every requested action, in order, each clearly visible and completed. Nothing missing, nothing added.

THE STEPS
- Split the request into visible actions, in the user's order. Never merge two requested actions and never drop one.
- Keep every detail: which hand, left/right (viewer's side unless the user says otherwise), direction, distance, how many times, speed, intensity, gaze, expression, exact spoken words.
- Turn feelings into visible motion ("e fericită" → "smiles broadly, eyes narrowing with the smile").
- An action with an object or a garment is described through its physical phases in "phases" (2–5 short clauses): reach, grip (which hand, where), the movement itself, release, return to rest. Example "își pune geaca": ["takes the jacket from the chair with her right hand", "slides her left arm into the left sleeve", "swings the jacket behind her back and finds the right sleeve", "pulls it onto her shoulders and straightens the collar"]. A simple action (a glance, a smile) has no phases.
- Movement must look human: say what the shoulders, torso and weight do when the arms move; transitions are smooth; the body never freezes between steps and never jerks.
- Do not invent actions. Breathing, blinking, hair and fabric movement are allowed but are not steps.
- The first step starts from the exact pose in the start photo; add a transition step if needed (sitting → standing before walking).
- Time windows inside [0, D] with realistic durations: glance 0.5–1 s, head turn ~1 s, smile ~1 s, hand to hair ~1.5 s, standing up ~2 s, a few steps 2–3 s, putting on a jacket 3–4 s, speech ~1 s per 3 words. Leave ~0.5 s to settle at the end. Windows follow each other; overlap only for simultaneous actions ("în timp ce").
- At most one step per ~1.5 s of clip. If the steps cannot fit realistically in D seconds, set "fits": false and "secSuggest" to the smallest allowed duration that fits (listed below), and still plan them as well as possible inside D.
- Keep each "en" under 160 characters and each phase under 90 characters.

THE BODY
- "visible": in at most 45 words, what the first frame actually shows about the person: build (e.g. slim, athletic, curvy), height impression, shoulder width, hair length, color and style, distinctive features (moles, freckles, tattoos, glasses, jewelry, makeup), the clothes and how they fit, pose. Describe only what is visible; never guess what clothes hide.
- Nothing in the plan may change the body: no reshaping, no growing or shrinking any part. Clothes stay on the person; only an outer layer (jacket, coat, scarf, hat, gloves) may be taken off or put on. If the user asks to undress beyond an outer layer, leave that part out and say so in "nota".

THE REST
- "scene": one short sentence: who and where (e.g. "A young woman in a sunny kitchen").
- "camera": static, or the camera move the user asked for; handheld phone feel only if asked.
- "endPose": one English sentence (max 40 words) describing ONLY the person's pose, position, gaze and expression in the very last frame, after the last step (e.g. "standing by the window, facing the camera, right hand resting on the sill, soft smile"). Same clothes, same place; no camera words.
- "sound": ambient sound of the place. "speech": the exact words she says, in quotes, in the user's language, or "".
- Only adults. If the request involves a minor or someone who looks like a child, refuse: leave "steps" empty and explain in "nota".
Answer ONLY with JSON:
{"scene":"…","visible":"…","endPose":"…","steps":[{"t0":0,"t1":1.5,"ro":"pasul pe scurt, în română","en":"the step in English","phases":[]}],"camera":"…","sound":"…","speech":"","fits":true,"secSuggest":null,"nota":"one short line in Romanian: what you understood and anything you left out"}`;
// cât încape într-un clip, pe model (planul are nevoie de timp; modelele mici duc mai puțini pași)
const MODEL_PLAN = {
  kling4f:'Kling 4.0 Flash (720p): follows a timeline well; at most 1 step per 1.5 s.',
  kling4:'Kling 4.0: follows a timeline and keyframes well; at most 1 step per 1.5 s.',
  veo31:'Veo 3.1 (4–8 s): cinematic, best with 2–4 steps; prefer fewer, fuller actions.',
  veo31f:'Veo 3.1 Fast (4–8 s): best with 2–4 steps; prefer fewer, fuller actions.',
  seed25:'Seedance 2.5: strong at long sequences of actions in order; at most 1 step per 1.5 s.',
  pvideo2:'P-Video-2 (draft preview of the same clip, 1–20 s): plan the same steps as for the final clip; keep phases short.'
};
// planul + promptul video (asamblat în prompt.js) din textul tău și poza de start; missing = pașii pe care o încercare anterioară nu i-a arătat
async function clVideoPrompt({text, start, mk, sec, audio, persona, missing, framing, anchorEnd}, signal){
  const m = MODELE[mk] || {dur:[sec]};
  const sys = SYS_PLAN + `\n\nModel: ${(MODELE[mk] || {}).nume || mk}. ${MODEL_PLAN[mk] || ''} D = ${sec} seconds. Allowed durations: ${m.dur.join(', ')} seconds.` + (audio ? ' Sound is on.' : ' Sound is off: "sound" and "speech" empty.');
  const content = [await imgBlock(start), {type:'text', text:(persona ? 'Person (description): ' + persona + '\n' : '') + (framing ? 'Framing of the first frame (measured on the phone): ' + framing + '\n' : '') + 'What should happen (Romanian): ' + text
    + (missing && missing.length ? '\n\nA previous clip with this request did NOT show these steps clearly: ' + missing.join('; ') + '. Give them enough time and make them unmistakable, without dropping the other steps.' : '')}];
  const {text:t, usd} = await claudeCall(sys, content, {signal, max:2000});
  const j = jsonOut(t);
  const steps = (Array.isArray(j.steps) ? j.steps : []).map(x => ({t0:Math.max(0, +x.t0 || 0), t1:Math.min(sec, +x.t1 || sec), ro:String(x.ro || '').trim(), en:String(x.en || '').trim(),
    phases:(Array.isArray(x.phases) ? x.phases : []).map(y => String(y).trim()).filter(Boolean).slice(0, 5)})).filter(x => x.ro || x.en);
  const plan = {scene:String(j.scene || '').trim(), visible:String(j.visible || '').trim(), framing:framing || '', endPose:String(j.endPose || '').trim().slice(0, 300), steps, camera:String(j.camera || '').trim(),
    sound:audio ? String(j.sound || '').trim() : '', speech:audio ? String(j.speech || '').trim() : ''};
  const sug = +j.secSuggest, nota = String(j.nota || '').trim();
  if(!steps.length) return {video:'', nota, steps, fits:true, secSuggest:null, usd, plan};
  const f = fitPrompt(mk, plan, {audio, sec, end:anchorEnd});
  if(f.over) throw new Error(`Pașii singuri au peste ${PROMPT_MAX} de caractere pentru model: scurtează textul sau împarte acțiunea în două clipuri.`);
  return {video:f.text, nota:nota + (f.level ? ` · prompt compactat (nivel ${f.level}), toți pașii păstrați` : ''), steps, fits:j.fits !== false, secSuggest:m.dur.includes(sug) ? sug : null, usd, plan, level:f.level};
}
/* 1.1: verificarea pașilor în clip: Claude vede 8 cadre (cu secunda fiecăruia) și spune pentru fiecare pas da / parțial / nu / nesigur */
async function clCheckSteps(steps, frames, signal){
  const sys = `You check whether a generated video followed a timed step plan. You get frames from the video, each labelled with its time in seconds. For each step, judge ONLY from what is visible in the frames: "da" (clearly done), "partial" (started or done weakly/wrongly: wrong hand, wrong direction, not completed), "nu" (not visible at all), "nesigur" (the frames are too sparse to see a fast action). Be strict about details the step states (hand, side, count, direction). Answer ONLY with JSON: {"steps":[{"i":1,"v":"da|partial|nu|nesigur","ro":"very short reason in Romanian"}]}`;
  const content = [];
  for(const f of frames){ content.push({type:'text', text:`Frame at ${(+f.t || 0).toFixed(1)} s:`}); content.push(await imgBlock(f, 640)); }
  content.push({type:'text', text:'Steps:\n' + steps.map((s, i) => `${i + 1}. [${s.t0}–${s.t1} s] ${s.en || s.ro}`).join('\n')});
  const {text:t, usd} = await claudeCall(sys, content, {signal, max:900});
  const j = jsonOut(t), V = ['da', 'partial', 'nu', 'nesigur'];
  const out = steps.map((s, i) => { const x = (j.steps || []).find(y => +y.i === i + 1) || {}; return {v:V.includes(x.v) ? x.v : 'nesigur', ro:String(x.ro || '').slice(0, 160)}; });
  return {steps:out, ok:out.filter(x => x.v === 'da').length, n:out.length, usd};
}
// promptul pentru poza de start (FLUX.2 klein 9B), cu reperele personajului
async function clImagePrompt({text, persona, aspect, hasFace}, signal){
  const sys = `You write prompts for FLUX.2 klein 9B (image editing with reference images) in a private app. The user writes in Romanian the scene for a photo of a character.
Reference image 1 is the character's full photo${hasFace ? '; reference image 2 is a close-up of the same face' : ''}.
Write ONE English prompt (60–140 words) for a candid, photorealistic phone photo of the SAME person (exact face, hair, body proportions from the references) in the described scene, ${aspect} frame, natural light, real skin texture, no text, no other people unless asked. The photo is the first frame of a video, so the pose should be a natural starting point for the action.
Only adults. If the request involves a minor or someone who looks like a child, refuse: put the reason in "nota" and leave "image" empty.
Answer ONLY with JSON: {"image":"…","nota":"one short line in Romanian"}`;
  const {text:t, usd} = await claudeCall(sys, [{type:'text', text:(persona ? 'Character: ' + persona + '\n' : '') + 'Scene (Romanian): ' + text}], {signal});
  const j = jsonOut(t); return {image:String(j.image || '').trim(), nota:String(j.nota || '').trim(), usd};
}
// descrierea fizică a unui personaj nou, din poza lui (o dată, la creare)
async function clDescribe(photo, signal){
  const sys = 'Describe the person in the photo for an image generator, in English, 40–80 words: apparent age range, face shape, eyes, nose, lips, skin tone, hair (color, length, style), body build and proportions. Neutral and factual, no clothes, no judgement. If the person looks under 21, answer only: MINOR.';
  const {text} = await claudeCall(sys, [await imgBlock(photo), {type:'text', text:'Describe this person.'}], {signal, max:300});
  if(/^\s*MINOR\b/i.test(text)) { const e = new Error('Persoana din poză pare sub 21 de ani: Animas nu creează personaje care par minore.'); e.minor = true; throw e; }
  return text;
}
