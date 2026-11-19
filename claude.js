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
const imgBlock = async b => ({type:'image', source:{type:'base64', media_type:'image/jpeg', data:await b64(await toJpeg(b, 1024, .88))}});

const MODEL_NOTE = {
  kling4f:'Kling 4.0 Flash: describe motion and camera, not the still. Every clip has sound: end with an "Audio:" line (ambient sounds, any speech in quotes). Add "no subtitles, no background music" unless music is asked for.',
  kling4:'Kling 4.0: describe motion and camera, not the still. Every clip has sound: end with an "Audio:" line (ambient sounds, any speech in quotes). Add "no subtitles, no background music" unless music is asked for.',
  veo31:'Veo 3.1: cinematic, describe motion, camera and light; if sound is on, describe the sound and any spoken line in quotes.',
  veo31f:'Veo 3.1 Fast: cinematic, describe motion, camera and light; if sound is on, describe the sound and any spoken line in quotes.',
  seed25:'Seedance 2.5: clear sequence of actions in time order; camera movement; if sound is on, describe it.',
  pvideo2:'P-Video-2: short, concrete motion description; no audio.'
};
const SYS_BASE = `You write prompts for an image-to-video model in a private app. The user writes in Romanian what the person in the start photo should do.
Rules:
- Keep the person exactly as in the start photo: same face, hair, body, clothes, place. Never describe a different person.
- Describe the motion in time order, natural and realistic: breathing, blinking, small weight shifts, hair and fabric moving, believable hands.
- Camera: say how it moves (static, slow push-in, handheld phone feel) and keep it consistent.
- Photorealistic, real footage look, natural skin texture, no beauty filter, no morphing, no extra people unless asked.
- Only adults. If the request involves a minor or someone who looks like a child, refuse: put the reason in "nota" and leave "video" empty.
- Write the video prompt in English, 60–160 words.
Answer ONLY with JSON: {"video":"…","nota":"one short line in Romanian: what you understood, or what you could not do"}`;

// promptul video din textul tău + poza de start
async function clVideoPrompt({text, start, mk, sec, audio, persona}, signal){
  const sys = SYS_BASE + '\nModel: ' + (MODEL_NOTE[mk] || '') + `\nDuration: ${sec} seconds — plan the action to fit exactly.` + (audio ? '' : '\nSound is off: do not describe sound.');
  const content = [await imgBlock(start), {type:'text', text:(persona ? 'Person (description): ' + persona + '\n' : '') + 'What should happen (Romanian): ' + text}];
  const {text:t, usd} = await claudeCall(sys, content, {signal});
  const j = jsonOut(t); return {video:String(j.video || '').trim(), nota:String(j.nota || '').trim(), usd};
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
