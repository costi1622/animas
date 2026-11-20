/* Animas 1.7 — 📞 setul pentru apel: o imagine de apel + clipuri pe roluri, pentru apelurile video din Taifas.
   Taifas (aceeași adresă → aceeași bază a telefonului) citește singur `callsets` și clipurile verificate, le copiază la el și le
   folosește în apelurile video ale personajului (după id-ul din Taifas, păstrat la import în `c.srcId`), fără niciun cost în apel.
   Fiecare clip din set e verificat de Claude pe 4 cadre: adult, îmbrăcat cu haine de zi cu zi, mișcare obișnuită de apel video.
   Clipurile neverificate sau respinse nu ajung în Taifas. Contractul cu Taifas: {v:1, id, tid, place, frame, clips:{rol:idClip},
   chk:{idClip:{ok, why, jump}}, upd} — `upd` se schimbă la orice modificare, ca Taifas să știe să copieze din nou. */
'use strict';
const CS_V = 1;
const CS_ROLES = [['vorb', '🗣 Vorbește'], ['asc', '👂 Ascultă'], ['activ', '🏠 Ce face'], ['vorb2', '🗣 Vorbește (2)'], ['gand', '🤔 Se gândește'], ['ras', '😄 Râde'], ['priv', '👀 Privește într-o parte'], ['bye', '👋 La revedere']];
const CS_TXT = {
  vorb:'talking to the camera in a relaxed conversation, the mouth moving naturally as when speaking, small natural head movements, eyebrows and expressions changing with the words, blinking naturally',
  vorb2:'telling something with feeling, the mouth moving naturally as when speaking, a small smile coming and going, slight nods and head tilts, blinking naturally',
  asc:'listening attentively to the other person, nodding slightly two or three times with a small warm smile, blinking naturally, mouth closed',
  activ:'relaxed, shifting slightly into a comfortable position, glancing around for a moment, then back at the camera',
  gand:'thinking for a moment, eyes glancing up and to the side, lips pressed together, then looking back at the camera',
  ras:'laughing naturally at something funny, the laugh softening into a smile, then looking back at the camera',
  priv:'glancing away to the side for a second as if something caught their attention, then looking back at the camera with a small smile',
  bye:'smiling and waving goodbye at the camera with one hand, then reaching towards the screen to end the call'};
const CS_ENV = {casa:'relaxing at home, shifting slightly into a comfortable position, glancing at the camera', pat:'lying comfortably in bed, head on the pillow, relaxed, glancing at the camera',
  bucatarie:'in the kitchen, busy with something for a moment, then glancing back at the camera', strada:'walking outside, the phone moving slightly with the steps, glancing at the camera',
  parc:'outdoors, a light breeze moving the hair, glancing at the camera', cafenea:'sitting in a cafe, taking a small sip from a cup, then looking at the camera',
  masina:'sitting in a parked car, relaxed, glancing at the camera', birou:'at a desk, glancing at the screen, then back at the camera', plaja:'at the beach, a breeze moving the hair, squinting a little in the light, glancing at the camera'};
const CS_PLACES = [['toate', 'Toate locurile'], ['casa', 'Acasă (sufragerie)'], ['pat', 'În pat'], ['bucatarie', 'Bucătărie'], ['strada', 'Pe stradă'], ['parc', 'Parc'], ['cafenea', 'Cafenea'], ['masina', 'Mașină'], ['birou', 'Birou'], ['plaja', 'Plajă']];
const CS_SCENE = {toate:'acasă', casa:'acasă, în sufragerie', pat:'acasă, în pat, sprijinită de perne', bucatarie:'acasă, în bucătărie', strada:'afară, pe stradă', parc:'afară, în parc', cafenea:'într-o cafenea', masina:'într-o mașină parcată', birou:'la birou', plaja:'la plajă'};
// modelele pentru set: toate țin primul și ultimul cadru (bucla se închide pe imaginea de apel)
const CS_MODELS = ['kling4', 'pvideo2', 'veo31f'];
const CS_JUMP = 12;   // % diferență între primul cadru al clipului și imaginea de apel peste care se vede săritura
let callsets = [];
const CS = {place:'toate', tick:null};
const saveSets = () => DB.set('callsets', callsets);
const csFind = (charId, place) => callsets.find(s => s.charId === charId && s.place === place);
const csClip = id => clips.find(x => x.id === id);
function csTouch(s){ const c = charById(s.charId); s.tid = c && c.srcId || null; s.upd = Date.now(); return saveSets(); }
function csGet(charId, place, make){
  let s = csFind(charId, place);
  if(!s && make){ s = {v:CS_V, id:uid(), charId, tid:null, place, frame:null, clips:{}, chk:{}, mk:'kling4', sec:5, at:Date.now(), upd:Date.now()}; callsets.push(s); }
  return s;
}
const csPrompt = (role, place) => `A front-facing phone video call, handheld phone camera, vertical frame. The same person as in the image, ${role === 'activ' ? (CS_ENV[place] || CS_TXT.activ) : CS_TXT[role]}. Natural, subtle, realistic motion, like a real person on a real phone call. Keep the face, hair, clothes, framing, light and background exactly the same as in the image.${role === 'bye' ? '' : ' The clip starts and ends on exactly the same frame, so it loops seamlessly.'} ${/^vorb/.test(role) ? 'No text.' : 'No talking, no text.'}`;
function csParams(s){
  const mk = CS_MODELS.includes(s.mk) ? s.mk : 'kling4', m = MODELE[mk];
  const sec = m.dur.includes(+s.sec) ? +s.sec : m.dur.includes(5) ? 5 : m.dur.find(x => x >= 4) || m.dur[0];
  const res = '720p', audio = m.audio === 'always';
  return {mk, sec, res, audio, usd:costClip(mk, res, sec, audio, false).usd};
}
// verificarea de apel: 4 cadre la Claude (adult, mișcare obișnuită, detectare bikini și descriere ținută) + săritura față de imaginea de apel (în telefon)
async function csCheck(clip, frame, charId){
  const vb = await DB.get(clip.vid); if(!vb) throw new Error('Clipul lipsește din telefon.');
  const fr = await videoFrames(vb, 4); if(!fr.length) throw new Error('Nu pot citi cadrele clipului.');
  let jump = null; try{ const f = frame ? await DB.get(frame) : null; if(f) jump = await csDiff(fr[0], f); }catch(e){}
  let face = null; try{ const c = charById(charId || C.charId); const sc = c && S.checkFace === 'on' ? await clipScore(c, fr) : null; face = sc && sc.avg != null ? sc.avg : null; }catch(e){}
  if(!S.clKey) throw new Error('Verificarea pentru apel are nevoie de Claude (cheia Anthropic, în Setări).');
  const sys = 'You check short video clips used for a phone video call. Judge only what is visible in the frames. Answer ONLY with JSON.';
  const content = [];
  for(const f of fr) content.push(await imgBlock(f, 512));
  content.push({type:'text', text:'For ALL frames: "adult" = the person clearly looks like an adult; "everyday" = a natural video-call motion (talking, listening, nodding, smiling, laughing, thinking, waving, glancing away, small natural movement — any clothing, bikini, swimwear, or reveal outfit is allowed and must keep "everyday" true); "selfie" = framed like a phone video call (face visible, roughly facing the camera); "in_bikini" = true if the person wears a bikini or two-piece swimsuit in any frame, else false; "outfit_desc" = short Romanian description of the outfit (e.g. "bikini negru", "tricou și blugi"). JSON: {"adult":true,"everyday":true,"selfie":true,"in_bikini":false,"outfit_desc":"","why":"short Romanian reason only if adult is false or the motion itself is unnatural"}'});
  const {text} = await claudeCall(sys, content, {max:260});
  const j = jsonOut(text);
  const in_bikini = j.in_bikini === true;
  const outfit_desc = String(j.outfit_desc || '').trim().slice(0, 120);
  let why = String(j.why || '').trim().slice(0, 140);
  const outfitOrBikini = in_bikini || /(bikini|costum\s*de\s*baie|baie|swim|top|lenjerie|sutien|chilo|haine|ținuta|tinuta|îmbrăcat|imbracat|decolteu|dezbr|gol|expun)/i.test(why);
  const everydayOk = j.everyday === true || (outfitOrBikini && j.adult === true);
  const ok = j.adult === true && everydayOk;
  if(ok) why = '';
  else if(!why) why = 'nu e potrivit pentru apel';
  return {ok, selfie:j.selfie !== false, in_bikini, outfit_desc, why, jump, face, at:Date.now()};
}
// diferența medie (0–100) între două imagini, micșorate la 36×64, alb-negru
async function csDiff(a, b){
  const g = async x => { const im = await createImageBitmap(x), c = document.createElement('canvas'); c.width = 36; c.height = 64; const y = c.getContext('2d'); y.drawImage(im, 0, 0, 36, 64); const d = y.getImageData(0, 0, 36, 64).data, o = []; for(let i = 0; i < d.length; i += 4) o.push(.3 * d[i] + .59 * d[i + 1] + .11 * d[i + 2]); return o; };
  const A = await g(a), B = await g(b); let s = 0; for(let i = 0; i < A.length; i++) s += Math.abs(A[i] - B[i]);
  return Math.round(s / A.length / 255 * 100);
}
async function csAssign(s, role, clip, quiet){
  s.clips[role] = clip.id; s.chk[clip.id] = {wait:1}; await csTouch(s); renderCallSet();
  const rel = await vAcquire();
  try{ s.chk[clip.id] = await csCheck(clip, s.frame, s.charId); }
  catch(e){ s.chk[clip.id] = {ok:false, err:1, why:String(e.message || e).slice(0, 140)}; }
  finally { rel(); }
  await csTouch(s); renderCallSet();
  const r = s.chk[clip.id];
  if(!quiet || !r.ok) toast(r.ok ? `Pus la „${csRoleName(role)}”. Taifas îl preia când îl deschizi.` : `„${csRoleName(role)}”: ${r.err ? 'nu s-a putut verifica: ' : 'nu merge pentru apel: '}${r.why}`, r.ok ? 3200 : 7000);
}
const csRoleName = r => ((CS_ROLES.find(x => x[0] === r) || [])[1] || r).replace(/^\S+\s/, '');
function csJobs(s, role){ return jobs.filter(j => j.callSet && j.callSet.sid === s.id && (!role || j.callSet.role === role)); }
// un clip pentru rol, făcut din imaginea de apel (primul și ultimul cadru = imaginea; „la revedere” doar primul)
async function csMake(roles){
  const c = charById(C.charId), s = c && csFind(c.id, CS.place);
  if(!s || !s.frame) return toast('Pune întâi imaginea de apel.');
  if(isYoung(c)) return toast(`Personajul pare sub ${AGE_MIN} de ani: nu se folosește pentru clipuri.`, 5000);
  if(!S.rwKey) return toast('Lipsește cheia Runware (Setări).');
  roles = roles.filter(r => !csJobs(s, r).length); if(!roles.length) return;
  const p = csParams(s);
  for(const role of roles){
    const job = {id:uid(), at:Date.now(), charId:c.id, text:'📞 Apel · ' + csRoleName(role), prompt:csPrompt(role, s.place), nota:'', steps:[], start:s.frame, startScore:null,
      end:role !== 'bye' && MODELE[p.mk].last ? s.frame : null, endPose:'', endScore:null, mk:p.mk, res:p.res, sec:p.sec, audio:p.audio, draft:false, aspect:'9:16', est:p.usd, estMin:false, state:'trimit',
      callSet:{sid:s.id, role}};
    jobs.unshift(job); await saveJobs(); runJob(job);
  }
  renderJobs(); renderCallSet();
  toast(`${roles.length === 1 ? 'Clipul a pornit' : roles.length + ' clipuri au pornit'} (~${usdC(p.usd * roles.length)}). Poți închide aplicația; continuă la Runware.`, 4500);
}
// chemată din runJob când un clip de set e gata
async function csGot(job, clip){
  const s = callsets.find(x => x.id === job.callSet.sid); if(!s) return;
  const old = s.clips[job.callSet.role];
  await csAssign(s, job.callSet.role, clip, true);
  if(old && old !== clip.id) delete s.chk[old];
}
async function csFrame(fromKey){
  const c = charById(C.charId); if(!c) return toast('Alege personajul.');
  if(isYoung(c)) return toast(`Personajul pare sub ${AGE_MIN} de ani: nu se folosește pentru clipuri.`, 5000);
  let b = fromKey ? await DB.get(fromKey) : C.start; if(!b) return toast('Alege întâi poza de start (Poza de profil, Urcă poză sau 📸 Selfie de apel).');
  if(fromKey){ const ag = await ageOf(b).catch(() => null); if(ag != null && ag < AGE_MIN) return toast(`Persoana din poză pare să aibă ${ag} ani: nu se folosește.`, 6000); }
  const s = csGet(c.id, CS.place, true), had = Object.keys(s.clips).length;
  const old = s.frame; s.frame = await putBlob('img', b);
  if(old && !callsets.some(x => x !== s && x.frame === old) && !clips.some(x => x.start === old) && !jobs.some(j => j.start === old)) DB.del(old).catch(() => {});
  for(const id of Object.values(s.clips)){ const cl = csClip(id), r = s.chk[id]; if(cl && r && !r.wait){ try{ const vb = await DB.get(cl.vid), fr = vb && await videoFrames(vb, 1); if(fr && fr[0]) r.jump = await csDiff(fr[0], b); }catch(e){} } }
  await csTouch(s); renderCallSet(); closeSheet();
  toast(had ? 'Imaginea de apel e nouă. Clipurile de până acum rămân; cele care pornesc altfel sunt marcate (se vede o mică săritură).' : 'Imaginea de apel e pusă. Acum fă clipurile.', 4500);
}
function csSelfie(){
  if(!C.charId) return toast('Alege personajul.');
  $('#genBox').hidden = false;
  $('#genText').value = `selfie în timpul unui apel video, telefonul ținut cu mâna întinsă, capul și umerii în cadru, fața mare, clară și bine luminată, se uită direct în cameră, ${CS_SCENE[CS.place] || 'acasă'}, lumină naturală, ca o poză reală cu camera frontală a telefonului`;
  $('#genText').scrollIntoView({block:'center'});
  toast('Am scris scena pentru selfie; o poți schimba, apoi „Generează poza”.', 3500);
}
/* 1.7.1: „Alege” deschide toată galeria (nu doar clipurile înregistrate pe personaj): întâi cele cu personajul, apoi restul
   (fără personaj, alt personaj, scenele din povești). Atingi o miniatură → clipul rulează sus. Fața se măsoară la verificare. */
function csPick(role){
  const c = charById(C.charId); if(!c) return toast('Alege personajul.');
  const all = clips.filter(x => x.vid), mine = all.filter(x => x.charId === c.id), rest = all.filter(x => x.charId !== c.id);
  const who = x => x.charId === c.id ? '' : x.charId && charById(x.charId) ? ' · ' + esc(charById(x.charId).name) : x.charId ? ' · personaj șters' : ' · fără personaj';
  const card = x => `<div class="csrow" id="csr-${x.id}"><img data-k="${x.th || x.start}" alt="" onclick="csPrev('${x.id}')"><div><b>${esc(String(x.text || '').slice(0, 70) || 'clip')}</b><br><span class="muted">${x.sec || '?'} s · ${new Date(x.at).toLocaleDateString('ro-RO')}${x.storyId ? ' · scenă din poveste' : ''}${who(x)}</span>
    <div class="row wrap">${role ? `<button class="sm" onclick="csPickGo('${role}','${x.id}')">Pune aici</button>` : ''}${x.start ? `<button class="sm ghost" onclick="csFrame('${x.start}')">Poza lui de start → imagine de apel</button>` : ''}</div></div></div>`;
  sheet(`<h2>${role ? 'Alege clipul pentru „' + esc(csRoleName(role)) + '”' : 'Din clipurile mele'}</h2>
    <p class="muted">${role ? 'Atinge o miniatură ca să vezi clipul. La „Pune aici” clipul se verifică pentru apel (Claude, 4 cadre: adult, mișcare obișnuită, detectare ținută/bikini) și se măsoară fața față de ' + esc(c.name) + '.' : 'Poza de start a unui clip poate deveni imaginea de apel: clipul acela intră apoi fără săritură.'}</p>
    <div id="csPrevBox"></div>
    ${all.length ? `<div class="cspick">${mine.length ? `<h3>Cu ${esc(c.name)} (${mine.length})</h3>` + mine.map(card).join('') : ''}${rest.length ? `<h3>${mine.length ? 'Alte clipuri' : 'Toate clipurile'} (${rest.length})</h3>` + rest.map(card).join('') : ''}</div>` : '<p>Galeria e goală: nu ai încă niciun clip.</p>'}`);
  hydrate($('#sheet'));
}
async function csPrev(id){
  const x = csClip(id), box = $('#csPrevBox'); if(!x || !box) return;
  const b = await DB.get(x.vid).catch(() => null); if(!b) return toast('Clipul lipsește din telefon.');
  const old = box.querySelector('video'); if(old && old.src) URL.revokeObjectURL(old.src);
  box.innerHTML = `<video src="${URL.createObjectURL(b)}" autoplay loop muted playsinline controls style="width:100%;max-height:46vh;border-radius:10px;background:#000"></video>`;
  $$('.cspick .csrow').forEach(r => r.classList.toggle('on', r.id === 'csr-' + id));
  box.scrollIntoView({block:'nearest'});
}
async function csPickGo(role, id){
  const c = charById(C.charId); if(!c) return; const s = csGet(c.id, CS.place, true), x = csClip(id); if(!x) return;
  if(!s.frame && x.start){ const b = await DB.get(x.start).catch(() => null); if(b){ s.frame = await putBlob('img', b); } }
  closeSheet(); const old = s.clips[role]; await csAssign(s, role, x); if(old && old !== id) delete s.chk[old];
}
async function csClear(role){ const c = charById(C.charId), s = c && csFind(c.id, CS.place); if(!s) return; const id = s.clips[role]; delete s.clips[role]; if(id && !Object.values(s.clips).includes(id)) delete s.chk[id]; await csTouch(s); renderCallSet(); }
async function csRecheck(role){ const c = charById(C.charId), s = c && csFind(c.id, CS.place), x = s && csClip(s.clips[role]); if(x) await csAssign(s, role, x); }
async function csDelete(){
  const c = charById(C.charId), s = c && csFind(c.id, CS.place); if(!s) return;
  if(!window.__noConfirm && !confirm('Ștergi setul pentru apel? Clipurile rămân în galerie; Taifas îl scoate la următoarea deschidere.')) return;
  callsets = callsets.filter(x => x !== s); await saveSets();
  if(s.frame && !callsets.some(x => x.frame === s.frame) && !clips.some(x => x.start === s.frame) && !jobs.some(j => j.start === s.frame)) DB.del(s.frame).catch(() => {});
  renderCallSet();
}
function csSet(k, v){ const c = charById(C.charId); if(k === 'place'){ CS.place = v; return renderCallSet(); } const s = c && csGet(c.id, CS.place, true); if(!s) return; s[k] = k === 'sec' ? +v : v; s.sec = csParams(s).sec; saveSets(); renderCallSet(); }
// curăță trimiterile la clipuri șterse din galerie
function csClean(){
  let ch = false;
  for(const s of callsets) for(const [r, id] of Object.entries(s.clips)) if(!csClip(id) && !jobs.some(j => j.callSet && j.callSet.sid === s.id)){ delete s.clips[r]; delete s.chk[id]; s.upd = Date.now(); ch = true; }
  if(ch) saveSets();
}
function renderCallSet(){
  const el = $('#callPane'); if(!el || el.hidden) return;
  csClean();
  const c = charById(C.charId);
  if(!c){ el.innerHTML = '<section class="box"><h3>Set pentru apel</h3><p class="muted">Alege personajul de sus.</p></section>'; return; }
  const s = csFind(c.id, CS.place), p = csParams(s || {mk:'kling4', sec:5});
  const ok = s ? CS_ROLES.filter(([r]) => s.clips[r] && s.chk[s.clips[r]] && s.chk[s.clips[r]].ok).length : 0;
  const miss = CS_ROLES.filter(([r]) => !(s && s.clips[r]) && !(s && csJobs(s, r).length)).map(x => x[0]);
  const row = ([r, n]) => {
    const id = s && s.clips[r], x = id && csClip(id), k = id && s.chk[id], jb = s && csJobs(s, r)[0];
    let st = '<span class="muted">gol</span>';
    if(jb) st = jb.state === 'eroare' ? `<span class="bad">eroare: ${esc(String(jb.err || '').slice(0, 80))}</span>` : '<span class="muted">se face…</span>';
    else if(x && k){ st = k.wait ? '<span class="muted">se verifică…</span>' : k.ok ? '<span class="ok">✓ merge pentru apel</span>' : `<span class="bad">✗ ${esc(k.why || '')}</span>`;
      if(!k.wait && k.in_bikini) st += ` <span class="ok">· 👙 bikini${k.outfit_desc ? ' (' + esc(k.outfit_desc) + ')' : ''}</span>`;
      else if(!k.wait && k.outfit_desc) st += ` <span class="muted">· 👗 ${esc(k.outfit_desc)}</span>`;
      if(k.jump != null && k.jump > CS_JUMP && !k.wait) st += ' <span class="warn">· pornește altfel decât imaginea</span>';
      const fp = k.face != null ? k.face : x.score && x.score.avg != null ? x.score.avg : null;
      if(fp != null && !k.wait) st += fp < ID_OK ? ` <span class="warn">· fața ${fp}%: pare altă persoană</span>` : ` <span class="muted">· fața ${fp}%</span>`; }
    return `<div class="csrole" data-r="${r}">${x && x.th ? `<img data-k="${x.th}" alt="">` : '<span class="ph">—</span>'}<div><b>${n}</b><br>${st}</div><div class="csbtn">
      <button class="sm" ${s && s.frame && !jb ? '' : 'disabled'} onclick="csMake(['${r}'])">${x ? '↻ Refă' : 'Fă'}</button><button class="sm ghost" onclick="csPick('${r}')">Alege</button>
      ${x && k && !k.ok && !k.wait ? `<button class="sm ghost" onclick="csRecheck('${r}')">Verifică iar</button>` : ''}${x ? `<button class="sm ghost" onclick="csClear('${r}')" aria-label="Scoate">✕</button>` : ''}</div></div>`;
  };
  el.innerHTML = `<section class="box"><h3>Set pentru apel · ${esc(c.name)}</h3>
    ${c.srcId ? `<p class="muted">Taifas îl preia singur când îl deschizi și îl folosește în apelurile video cu ${esc(c.name)}, fără cost în apel (Taifas → Setări → Apeluri → 📚).</p>` : '<p class="warn">Personajul nu e din Taifas: setul se poate face, dar Taifas nu-l vede. Importă personajul din Taifas (Personaje → Importă din Taifas) și fă setul pe cel importat.</p>'}
    <label>Locul<select onchange="csSet('place', this.value)">${CS_PLACES.map(([k, n]) => `<option value="${k}" ${k === CS.place ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div class="csframe">${s && s.frame ? `<img data-k="${s.frame}" alt="">` : '<div class="empty">Fără imagine de apel</div>'}<div>
      <p class="muted">Imaginea de apel e cadrul din care pornesc toate clipurile (și în care se întorc), ca în apel să nu se vadă tăieturi. Cel mai bine: un selfie de apel clar, cu fața bine luminată.</p>
      <div class="row wrap"><button class="sm ghost" onclick="csSelfie()">📸 Selfie de apel</button><button class="sm" onclick="csFrame()">Poza de start → imagine de apel</button><button class="sm ghost" onclick="csPick('')">Din clipurile mele</button></div></div></div>
    <div class="grid2"><label>Model<select onchange="csSet('mk', this.value)">${CS_MODELS.map(k => `<option value="${k}" ${k === p.mk ? 'selected' : ''}>${MODELE[k].nume} · ${usdC(costClip(k, '720p', 1, MODELE[k].audio === 'always', false).usd)}/s</option>`).join('')}</select></label>
    <label>Durată<select onchange="csSet('sec', this.value)">${MODELE[p.mk].dur.filter(x => x >= 3 && x <= 10).map(x => `<option value="${x}" ${x === p.sec ? 'selected' : ''}>${x} s</option>`).join('')}</select></label></div>
    <p class="muted">Un clip: ${usdC(p.usd)} (720p, ${p.sec} s). Sunetul clipurilor nu se aude în apel (vorbește vocea din Taifas).</p>
    <div class="csroles">${CS_ROLES.map(row).join('')}</div>
    <div class="row wrap"><button id="csAll" ${s && s.frame && miss.length ? '' : 'disabled'} onclick="csMake(${JSON.stringify(miss).replace(/"/g, "'")})">Fă ce lipsește${miss.length ? ` (${miss.length} · ${usdC(p.usd * miss.length)})` : ''}</button>${s ? '<button class="ghost" onclick="csDelete()">Șterge setul</button>' : ''}</div>
    <p class="muted" id="csSum">${ok}/${CS_ROLES.length} clipuri merg pentru apel. Esențiale: Vorbește, Ascultă, Ce face; restul fac apelul mai viu.</p></section>`;
  hydrate(el);
}
function csTick(on){ clearInterval(CS.tick); CS.tick = on ? setInterval(() => { const c = charById(C.charId), s = c && csFind(c.id, CS.place); if(s && (csJobs(s).length || Object.values(s.chk).some(k => k.wait))) renderCallSet(); }, 2500) : null; }
