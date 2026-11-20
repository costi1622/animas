/* Animas 1.2 — construirea promptului video, în aplicație (nu în textul liber al lui Claude).
   Claude dă PLANUL structurat (scena, ce se vede în poza de start, pașii pe secunde cu fazele lor, camera, sunetul);
   aici se asamblează promptul după strategia fiecărui model și se garantează limita Runware (2.000 de caractere pentru
   positivePrompt), scoțând întâi ce e opțional, niciodată un pas. Funcții pure: se testează și fără browser. */
'use strict';
const PROMPT_MAX = 2000;

/* Strategia fiecărui model:
   budget  = lungimea țintă (sub limită), ca să rămână loc pentru pașii lungi
   ref     = cum se numește poza de start în prompt
   time    = 'stamps' (linii [a–b s]) sau 'then' (frază cu „then”, pentru modelele mici)
   audio   = 'always' (Kling: mereu sunet; spunem ce să fie și ce să nu fie), 'switch', 'off'
   motion  = cum descriem mișcarea naturală pentru modelul ăsta */
const STRAT = {
  kling4f:{budget:1700, ref:'<<<image_1>>>', time:'stamps', audio:'always',
    lead:'Begin exactly from <<<image_1>>>: one continuous shot, no cuts.',
    motion:'Natural human motion: weight shifts between the feet, shoulders and torso follow the arms, hands move with ease and settle naturally, hair and clothes react to movement and gravity.'},
  kling4:{budget:1800, ref:'the first frame', time:'stamps', audio:'always',
    lead:'Begin exactly from the first frame: one continuous shot, no cuts.',
    motion:'Natural human motion: weight shifts between the feet, shoulders and torso follow the arms, hands move with ease and settle naturally, hair and clothes react to movement and gravity.'},
  veo31:{budget:1500, ref:'the first frame', time:'stamps', audio:'switch',
    lead:'Cinematic, photorealistic single continuous shot that starts exactly from the first frame.',
    motion:'Fluid, unhurried human movement with realistic biomechanics: arms, shoulders and torso move together, transitions are smooth, gestures and expressions are spontaneous, fabric and hair respond to motion.'},
  veo31f:{budget:1400, ref:'the first frame', time:'stamps', audio:'switch',
    lead:'Cinematic, photorealistic single continuous shot that starts exactly from the first frame.',
    motion:'Fluid human movement with realistic biomechanics: arms, shoulders and torso move together, smooth transitions, spontaneous expressions, fabric and hair respond to motion.'},
  seed25:{budget:1800, ref:'the first frame', time:'stamps', audio:'switch',
    lead:'Single continuous shot starting from the first frame. The actions happen one after another, in this order:',
    motion:'Smooth, continuous, physically plausible movement; the whole body takes part in each action; no jerks, no freezing between actions.'},
  pvideo2:{budget:1200, ref:'the first frame', time:'then', audio:'off',
    lead:'Continuous shot from the first frame.',
    motion:'Smooth natural motion.'}
};
const KEEP_FULL = 'Keep the person exactly as in the first frame: the same face, hair, body build, height, shoulder width, proportions and silhouette, the same clothes and fit, the same place and light. Do not redraw, reshape, slim, enlarge or idealise the body; proportions stay constant in every frame, including while moving.';
const KEEP_SHORT = 'Keep the same face, body build, proportions, clothes and place as the first frame in every frame; do not reshape the body.';
const RULE_FULL = 'Perform only these actions, in this order, each one clearly visible and fully completed; no extra gestures, no extra people, no cuts. Photorealistic real footage.';
const RULE_SHORT = 'Only these actions, in this order, each completed; no cuts.';
const fmtT = v => String(Math.round(v * 10) / 10);

// un pas: acțiunea + fazele ei (apucă → mută → lasă), legate într-o singură propoziție
function stepText(s, withPhases = true){
  const main = String(s.en || s.ro || '').trim().replace(/\.+$/, '');
  const ph = withPhases && Array.isArray(s.phases) ? s.phases.map(x => String(x).trim().replace(/\.+$/, '')).filter(Boolean) : [];
  return ph.length ? main + ': ' + ph.join(', then ') : main;
}
/* asamblează promptul pentru modelul mk din plan; nivelurile de compactare scot pe rând ce e opțional:
   0 tot · 1 mișcarea scurtată · 2 identitatea scurtată · 3 fără ce se vede în poză · 4 regula scurtă · 5 fazele pașilor comprimate · 6 fără camera */
function buildPrompt(mk, plan, {audio = false, sec} = {}, level = 0){
  const st = STRAT[mk] || STRAT.kling4f, P = plan || {}, steps = Array.isArray(P.steps) ? P.steps : [];
  const L = [st.lead];
  if(P.scene) L.push(String(P.scene).trim());
  if(level < 3 && P.visible) L.push('Visible in the first frame: ' + String(P.visible).trim().replace(/\.+$/, '') + '.');
  L.push(level < 2 ? KEEP_FULL : KEEP_SHORT);
  const ph = level < 5;
  if(st.time === 'stamps') for(const s of steps) L.push(`[${fmtT(s.t0)}–${fmtT(s.t1)} s] ${stepText(s, ph)}.`);
  else L.push(steps.map((s, i) => (i ? (i === steps.length - 1 ? 'finally ' : 'then ') : 'First ') + stepText(s, ph)).join(', ') + '.');
  if(level < 6 && P.camera) L.push('Camera: ' + String(P.camera).trim().replace(/\.+$/, '') + '.');
  if(level < 1) L.push(st.motion); else if(level < 4) L.push(st.motion.split(':')[0].split(';')[0].replace(/\.+$/, '') + '.');
  if(st.audio === 'always') L.push('Audio: ' + (P.sound ? String(P.sound).trim().replace(/\.+$/, '') : 'natural ambient sound of the place') + (P.speech ? `; she says ${P.speech}` : '') + '; no background music, no subtitles.');
  else if(st.audio === 'switch' && audio) L.push('Audio: ' + (P.sound ? String(P.sound).trim().replace(/\.+$/, '') : 'natural ambient sound') + (P.speech ? `; she says ${P.speech}` : '') + '.');
  L.push(level < 4 ? RULE_FULL : RULE_SHORT);
  return L.filter(Boolean).join('\n');
}
/* promptul final: cel mai complet nivel care încape în bugetul modelului (și sigur sub 2.000).
   Întoarce {text, level, over}: over=true doar dacă nici forma cea mai compactă nu încape (pașii singuri sunt prea lungi) */
function fitPrompt(mk, plan, opts){
  const st = STRAT[mk] || STRAT.kling4f, cap = Math.min(PROMPT_MAX, st.budget);
  let t = '';
  for(let lv = 0; lv <= 6; lv++){ t = buildPrompt(mk, plan, opts, lv); if(t.length <= cap) return {text:t, level:lv, over:false}; }
  for(let lv = 0; lv <= 6; lv++){ t = buildPrompt(mk, plan, opts, lv); if(t.length <= PROMPT_MAX) return {text:t, level:lv, over:false}; }
  return {text:t, level:6, over:true};
}
// pașii (textul englez al fiecăruia) se regăsesc în prompt? — verificarea că nicio cerință n-a fost pierdută la compactare
function stepsKept(text, steps){ return (steps || []).every(s => text.includes(String(s.en || s.ro || '').trim().replace(/\.+$/, ''))); }
if(typeof module !== 'undefined') module.exports = {PROMPT_MAX, STRAT, buildPrompt, fitPrompt, stepsKept};
