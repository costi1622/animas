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

/* 1.1: fidelitatea față de ce ai scris. Claude face întâi PLANUL pe secunde (fiecare acțiune vizibilă, în ordinea ta, cu toate
   detaliile: mâna, stânga/dreapta, de câte ori, încotro privește, ce spune), apoi scrie promptul din plan: o linie pe pas, cu
   intervalul de timp, plus regula „doar acești pași, în ordinea asta, fiecare dus până la capăt”. Dacă pașii nu încap realist
   în durata aleasă, spune și propune durata potrivită. */
const SYS_PLAN = `You turn the user's request (written in Romanian) into a precise, timed action plan for an image-to-video model, then write the video prompt from that plan. The person in the start photo must do EXACTLY what the user asked: every requested action, in the requested order, each clearly visible and completed. Nothing missing, nothing added.

STEP 1 — THE PLAN
- Split the request into atomic, visible actions (one body action each), in the user's order. Never merge two requested actions into one step and never drop one.
- Keep every detail the user gave: which hand, left/right (from the viewer's side unless the user says otherwise), direction, distance, how many times, speed, intensity, where the person looks, facial expression, exact spoken words.
- Turn feelings or vague wishes into concrete visible motion (e.g. "e fericită" → "smiles broadly, eyes narrowing with the smile").
- Do not invent actions. Natural micro-motion (breathing, blinking, hair and fabric moving) is allowed but is never a step.
- The first step starts from the exact pose in the start photo; if it needs a transition (e.g. she is sitting and must walk), add that transition as its own step.
- Give each step a time window inside [0, D] seconds with realistic durations: a glance 0.5–1 s, a head turn ~1 s, a smile ~1 s, hand to hair ~1.5 s, standing up ~2 s, a few walking steps 2–3 s, speech ~1 s per 3 words. Leave ~0.5 s at the end to settle. Windows follow each other in order; they may overlap only when the user asked for simultaneous actions ("while", "în timp ce").
- If the steps cannot fit realistically in D seconds, set "fits": false and "secSuggest" to the smallest allowed duration that fits (allowed durations are listed below), and still plan them as well as possible inside D.

STEP 2 — THE VIDEO PROMPT (English)
Line 1: "Single continuous shot starting exactly from the first frame: <who and where, in a few words>. Same person, same face, same hair, same body, same clothes, same place throughout."
Then one line per step: "[a–b s] <the action, with body part, direction, speed and end position>."
Then "Camera: <static, or the movement the user asked for>."
MODEL_LINES
Last line: "Perform only these actions, in this exact order, each one clearly visible and fully completed. No cuts, no scene change, no extra people, no extra gestures. Photorealistic real footage, natural human motion, correct anatomy."

Only adults. If the request involves a minor or someone who looks like a child, refuse: leave "video" empty and "steps" empty, and explain in "nota".
Answer ONLY with JSON:
{"steps":[{"t0":0,"t1":1.5,"ro":"step in Romanian, short","en":"step in English"}],"fits":true,"secSuggest":null,"video":"…","nota":"one short line in Romanian: what you understood and anything you could not include"}`;
const MODEL_LINES = {
  kling4f:'Then "Audio: <ambient sound of the place; any spoken words in quotes, in the language the user wrote them>; no subtitles, no background music." (Kling always generates sound; add music only if the user asked.)',
  kling4:'Then "Audio: <ambient sound of the place; any spoken words in quotes, in the language the user wrote them>; no subtitles, no background music." (Kling always generates sound; add music only if the user asked.)',
  veo31:'If sound is on: then "Audio: <ambient sound; spoken words in quotes, in the language the user wrote them>; no music unless asked."',
  veo31f:'If sound is on: then "Audio: <ambient sound; spoken words in quotes, in the language the user wrote them>; no music unless asked."',
  seed25:'If sound is on: then "Audio: <ambient sound; spoken words in quotes>."',
  pvideo2:'No audio line.'
};
// planul + promptul video din textul tău și poza de start; missing = pașii pe care o încercare anterioară nu i-a arătat
async function clVideoPrompt({text, start, mk, sec, audio, persona, missing}, signal){
  const m = MODELE[mk] || {dur:[sec]};
  const sys = SYS_PLAN.replace('MODEL_LINES', MODEL_LINES[mk] || '')
    + `\n\nModel: ${(MODELE[mk] || {}).nume || mk}. D = ${sec} seconds. Allowed durations: ${m.dur.join(', ')} seconds.` + (audio ? ' Sound is on.' : ' Sound is off: no audio line, no speech.');
  const content = [await imgBlock(start), {type:'text', text:(persona ? 'Person (description): ' + persona + '\n' : '') + 'What should happen (Romanian): ' + text
    + (missing && missing.length ? '\n\nA previous clip with this request did NOT show these steps clearly: ' + missing.join('; ') + '. Give them enough time and make them unmistakable, without dropping the other steps.' : '')}];
  const {text:t, usd} = await claudeCall(sys, content, {signal, max:2000});
  const j = jsonOut(t);
  const steps = (Array.isArray(j.steps) ? j.steps : []).map(x => ({t0:Math.max(0, +x.t0 || 0), t1:Math.min(sec, +x.t1 || sec), ro:String(x.ro || '').trim(), en:String(x.en || '').trim()})).filter(x => x.ro || x.en);
  const sug = +j.secSuggest;
  return {video:String(j.video || '').trim(), nota:String(j.nota || '').trim(), steps, fits:j.fits !== false, secSuggest:m.dur.includes(sug) ? sug : null, usd};
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
