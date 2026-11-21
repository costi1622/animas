/* Animas 1.9.0 — 🎞 Montaj AI · continuityEngine: cât de bine se leagă finalul unui clip de începutul altuia, ordinea cea mai bună
   pentru tot montajul și punctele de tăiere.
   Pentru fiecare pereche A→B se caută perechea de cadre (din ultimele ~1,5 s ale lui A și primele ~1,5 s ale lui B) care se potrivesc
   cel mai bine; acolo se taie. Scorul perechii: asemănarea imaginii, postura, brațele, capul, distanța față de cameră, mișcarea
   (direcția de la finalul lui A față de începutul lui B), continuitatea în timp (B nu reia de la capăt aceeași acțiune) + părerea lui
   Claude, dacă există. Două cadre asemănătoare NU garantează continuitatea: mișcarea și timpul pot coborî scorul.
   Ordinea: programare dinamică exactă pe submulțimi (Held-Karp), O(2ⁿ·n²): la 10 clipuri ~100.000 de pași, nu 10! = 3,6 milioane.
   Scorurile sunt estimări interne, nu probabilități. */
'use strict';
const CE_W = {vis:.3, pose:.15, arms:.1, head:.1, dist:.1, motion:.15, time:.1};
const clamp01 = x => Math.max(0, Math.min(1, x));
function ceVis(a, b){
  let d = 0; for(let i = 0; i < a.gray.length; i++) d += Math.abs(a.gray[i] - b.gray[i]); d /= a.gray.length;
  let h = 0; for(let i = 0; i < 48; i++) h += Math.min(a.hist[i], b.hist[i]); h /= 3;
  return .65 * clamp01(1 - d / .2) + .35 * clamp01((h - .5) / .5);
}
const ARMS = ['cotS', 'cotD', 'incheieturaS', 'incheieturaD'];
function cePose(a, b){
  const A = a && a.pose, B = b && b.pose; if(!A || !B) return {};
  const common = Object.keys(A.P).filter(n => B.P[n]); const out = {};
  if(common.length >= 4){ const d = common.reduce((s, n) => s + Math.hypot(A.P[n].x - B.P[n].x, A.P[n].y - B.P[n].y), 0) / common.length; out.pose = clamp01(1 - d / .12); }
  const ca = ARMS.filter(n => A.P[n] && B.P[n]);
  if(ca.length){ const d = ca.reduce((s, n) => s + Math.hypot(A.P[n].x - B.P[n].x, A.P[n].y - B.P[n].y), 0) / ca.length; out.arms = clamp01(1 - d / .1); }
  else if(ARMS.some(n => A.P[n]) !== ARMS.some(n => B.P[n])) out.arms = .3;   // brațele apar / dispar brusc
  if(A.turn != null && B.turn != null) out.head = clamp01(1 - Math.abs(A.turn - B.turn) / .5);
  else if(A.ears !== B.ears) out.head = .5;
  if(A.scale && B.scale) out.dist = clamp01(1 - Math.abs(Math.log(A.scale / B.scale)) / .45);
  return out;
}
// mișcarea globală între două cadre (camera / persoana): deplasarea care potrivește cel mai bine miniaturile 36×64 (±4 px)
function ceShift(a, b){
  let best = {dx:0, dy:0, e:Infinity};
  for(let dy = -4; dy <= 4; dy++) for(let dx = -4; dx <= 4; dx++){
    let e = 0, n = 0;
    for(let y = 4; y < 60; y += 2) for(let x = 4; x < 32; x += 2){ const yy = y + dy, xx = x + dx; e += Math.abs(a.gray[y * 36 + x] - b.gray[yy * 36 + xx]); n++; }
    e /= n; if(e < best.e - 1e-6 || (Math.abs(e - best.e) < 1e-6 && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))) best = {dx, dy, e};
  }
  return best;
}
// viteza la un capăt: din două cadre vecine (în timp) → {x, y} pe secundă; postura are prioritate, altfel imaginea
function ceVel(f1, f2){
  const dt = Math.max(.05, Math.abs(f2.t - f1.t)), sgn = f2.t >= f1.t ? 1 : -1;
  if(f1.pose && f2.pose && f1.pose.c && f2.pose.c) return {x:(f2.pose.c.x - f1.pose.c.x) * sgn / dt, y:(f2.pose.c.y - f1.pose.c.y) * sgn / dt, src:'pose'};
  const s = ceShift(f1, f2); return {x:-s.dx / 36 * sgn / dt, y:-s.dy / 64 * sgn / dt, src:'img'};
}
function ceMotion(A, ia, B, ib){
  const ta = A.frames[ia], tb = B.frames[ib];
  const pa = A.frames.find(f => f.t < ta.t - .1 && f.t >= ta.t - .6), nb = B.frames.find(f => f.t > tb.t + .1 && f.t <= tb.t + .6);
  if(!pa || !nb) return null;
  const va = ceVel(pa, ta), vb = ceVel(tb, nb), ma = Math.hypot(va.x, va.y), mb = Math.hypot(vb.x, vb.y);
  if(ma < .02 && mb < .02) return .8;   // amândouă aproape nemișcate: neutru
  if(ma < .02 || mb < .02) return clamp01(.75 - Math.abs(ma - mb) * 2);
  const cos = (va.x * vb.x + va.y * vb.y) / (ma * mb), ratio = Math.min(ma, mb) / Math.max(ma, mb);
  return clamp01(.15 + .55 * (cos + 1) / 2 + .3 * ratio);
}
// cadrul A[ia] (final) cu B[ib] (început): imagine + postură
function ceFrame(a, b){ const v = ceVis(a, b), p = cePose(a, b), ps = [p.pose, p.arms, p.head, p.dist].filter(x => x != null); return {v, p, s:ps.length ? .55 * v + .45 * ps.reduce((x, y) => x + y, 0) / ps.length : v}; }
/* perechea A→B: cel mai bun punct de tăiere + componentele scorului */
function cePair(A, B){
  let best = null;
  for(let i = 0; i < A.tail.length; i++) for(let j = 0; j < B.head.length; j++){
    const ia = A.tail[i], ib = B.head[j], f = ceFrame(A.frames[ia], B.frames[ib]), s = f.s - .025 * (i + j);   // tăiem cât mai puțin
    if(!best || s > best.s) best = {s, ia, ib, f};
  }
  const fa = A.frames[best.ia], fb = B.frames[best.ib], C = {vis:best.f.v, ...best.f.p};
  const m = ceMotion(A, best.ia, B, best.ib); if(m != null) C.motion = m;
  // timpul: dacă începutul lui B seamănă mai mult cu începutul lui A decât cu finalul lui A, B reia aceeași acțiune de la capăt
  const sa = ceFrame(A.frames[A.head[0]], B.frames[B.head[0]]).s, se = ceFrame(A.frames[A.tail[0]], B.frames[B.head[0]]).s;
  C.time = clamp01(1 - Math.max(0, sa - se - .05) * 2.5);
  let sw = 0, sum = 0; for(const [k, w] of Object.entries(CE_W)) if(C[k] != null){ sw += w; sum += w * C[k]; }
  const local = sw ? sum / sw : 0;
  return {local, comp:C, endTrim:+Math.max(0, A.D - .05 - fa.t).toFixed(2), startTrim:+Math.max(0, fb.t - .02).toFixed(2), ta:fa.t, tb:fb.t, restart:C.time < .6};
}
function ceMatrix(an){
  const n = an.length, M = [];
  for(let i = 0; i < n; i++){ M.push([]); for(let j = 0; j < n; j++) M[i].push(i === j ? null : cePair(an[i], an[j])); }
  return M;
}
// scorul final al perechii: local + Claude (dacă a răspuns pentru ea)
function ceScore(M, cl, i, j){
  const p = M[i][j]; if(!p) return 0;
  const c = cl && cl.pair && cl.pair[i] && cl.pair[i][j];
  return c != null ? .55 * p.local + .45 * c : p.local;
}
/* ordinea cea mai bună: maximizează suma scorurilor tranzițiilor + începutul / finalul natural (Claude), exact (Held-Karp) */
function ceOrder(M, cl){
  const n = M.length; if(n < 2) return [...Array(n).keys()];
  const open = i => cl && cl.open ? .25 * (cl.open[i] || 0) : 0, close = i => cl && cl.close ? .15 * (cl.close[i] || 0) : 0;
  const S = 1 << n, dp = new Float64Array(S * n).fill(-Infinity), par = new Int8Array(S * n).fill(-1);
  for(let i = 0; i < n; i++) dp[(1 << i) * n + i] = open(i);
  for(let m = 1; m < S; m++) for(let i = 0; i < n; i++){
    const cur = dp[m * n + i]; if(cur === -Infinity || !(m & (1 << i))) continue;
    for(let j = 0; j < n; j++){ if(m & (1 << j)) continue; const nm = m | (1 << j), v = cur + ceScore(M, cl, i, j); if(v > dp[nm * n + j]){ dp[nm * n + j] = v; par[nm * n + j] = i; } }
  }
  let bi = 0, bv = -Infinity, full = S - 1; for(let i = 0; i < n; i++){ const v = dp[full * n + i] + close(i); if(v > bv){ bv = v; bi = i; } }
  const ord = []; let m = full, i = bi; while(i >= 0){ ord.push(i); const p = par[m * n + i]; m &= ~(1 << i); i = p; }
  return ord.reverse();
}
const ceLevel = s => s >= .9 ? {k:'vb', t:'compatibilitate foarte bună'} : s >= .75 ? {k:'b', t:'compatibilitate bună'} : s >= .5 ? {k:'inc', t:'compatibilitate incertă'} : {k:'man', t:'necesită verificare manuală'};
/* pentru o ordine dată (propusă sau schimbată de tine): tranzițiile, tăieturile, scorurile, motivele, avertismentele */
function cePlan(an, M, cl, order){
  const n = order.length, trims = an.map(() => ({start:0, end:0, why:[]})), trans = [], warn = [];
  for(let k = 0; k + 1 < n; k++){
    const i = order[k], j = order[k + 1], p = M[i][j], s = ceScore(M, cl, i, j), c = cl && cl.pair && cl.pair[i] && cl.pair[i][j];
    trims[i].end = Math.max(trims[i].end, p.endTrim); trims[j].start = Math.max(trims[j].start, p.startTrim);
    const why = [];
    const C = p.comp, names = {vis:'imaginea', pose:'postura', arms:'brațele', head:'capul', dist:'distanța', motion:'mișcarea', time:'momentul acțiunii'};
    const good = Object.keys(names).filter(k2 => C[k2] != null && C[k2] >= .8).map(k2 => names[k2]), bad = Object.keys(names).filter(k2 => C[k2] != null && C[k2] < .5).map(k2 => names[k2]);
    if(good.length) why.push('se potrivesc: ' + good.join(', ')); if(bad.length) why.push('diferă: ' + bad.join(', '));
    const cr = cl && cl.why && cl.why[i] && cl.why[i][j]; if(cr) why.push('Claude: ' + cr);
    // tăietură directă, cu excepția săriturilor de imagine măsurate (atunci fondu, chiar dacă Claude zice altfel); altfel cum zice Claude
    let type = cl && cl.type && cl.type[i] && cl.type[i][j];
    if(s < .5 && C.vis < .4) type = 'fade'; else if(type !== 'cut' && type !== 'fade') type = 'cut';
    trans.push({from:i, to:j, score:+s.toFixed(3), local:+p.local.toFixed(3), claude:c != null ? +c.toFixed(3) : null, type, d:type === 'fade' ? .4 : 0, why:why.join('; '), comp:C, restart:p.restart, level:ceLevel(s)});
    if(s < .5) warn.push(`${an[i].name} → ${an[j].name}: ${Math.round(s * 100)}%, necesită verificare manuală.`);
    if(p.restart) warn.push(`${an[j].name} pare să reia de la început aceeași acțiune ca ${an[i].name} (momente incompatibile).`);
  }
  // tăieturile propuse de Claude (validate), unde sunt mai mari decât cele măsurate
  if(cl && cl.trim) cl.trim.forEach((t, i) => { if(!t) return; if(t.start > trims[i].start){ trims[i].start = t.start; if(t.why) trims[i].why.push(t.why); } if(t.end > trims[i].end){ trims[i].end = t.end; if(t.why) trims[i].why.push(t.why); } });
  // limite: fiecare capăt ≤ 40% din clip, rămân ≥ 0,5 s
  an.forEach((a, i) => { const t = trims[i]; t.start = Math.min(t.start, a.D * .4); t.end = Math.min(t.end, a.D * .4); if(a.D - t.start - t.end < .5){ t.start = 0; t.end = 0; } t.start = +t.start.toFixed(2); t.end = +t.end.toFixed(2); });
  if(cl && cl.incompat) for(const x of cl.incompat) warn.push(`${an[x.a].name} și ${an[x.b].name}: ${x.why || 'nu se leagă natural'} (Claude).`);
  if(cl && cl.warnings) warn.push(...cl.warnings.map(w => 'Claude: ' + w));
  const overall = trans.length ? trans.reduce((a, t) => a + t.score, 0) / trans.length : 0;
  return {order:[...order], trans, trims, warn:[...new Set(warn)], overall:+overall.toFixed(3), level:ceLevel(overall)};
}
/* ── Claude: cadrele (început / mijloc / final) + metadatele + măsurătorile → JSON strict, validat aici ── */
const CE_SYS = `You help assemble several short video clips (generated from the same scene or character) into ONE coherent continuous video.
For each clip you get: id, duration, resolution, fps, audio, the phone's measurements (pose, head, distance, position) at its start and end, and three frames (first, middle, last).
Judge visual and action continuity: body posture, arm/hand positions, head/face orientation, facial expression, clothing, camera position and distance, direction of movement, the visible action and its stage (beginning / middle / end).
Decide: the best order; for EVERY ordered pair (A then B) how naturally the END of A continues into the START of B (0–1); whether frames should be trimmed at a clip's start or end (seconds, only if clearly needed, e.g. a pose that does not connect); pairs that cannot connect naturally.
Do not guess beyond what the frames show; if the information is insufficient, say so with "enough": false.
Write every "reason"/"why"/warning in Romanian, short. Answer with ONLY this JSON:
{"clips":[{"id":"c1","action":"...","stage":"start|middle|end|complete","opening":0.0,"closing":0.0}],
 "pairs":[{"from":"c1","to":"c2","score":0.0,"type":"cut|fade","reason":"..."}],
 "order":["c1","c2"],
 "trims":[{"id":"c1","start":0,"end":0,"reason":"..."}],
 "incompatible":[{"a":"c1","b":"c3","reason":"..."}],
 "confidence":0.0, "enough":true, "warnings":[]}`;
async function ceClaude(an, signal){
  const C2 = [{type:'text', text:`${an.length} clips.`}];
  for(let k = 0; k < an.length; k++){
    const a = an[k], m = a.meta, f0 = a.frames[a.rep[0]], f4 = a.frames[a.rep[4]];
    C2.push({type:'text', text:`Clip c${k + 1}: ${(+m.dur || a.D).toFixed(2)} s, ${m.w}x${m.h}, ${m.fps ? m.fps + ' fps' : 'fps unknown'}, ${m.audio ? 'with audio' : m.audio === false ? 'no audio' : 'audio unknown'}.\nStart (measured): ${vaDescribe(f0.pose)}\nEnd (measured): ${vaDescribe(f4.pose)}\nFrames: first (t=${f0.t}s), middle, last (t=${f4.t}s):`});
    for(const r of [0, 2, 4]) C2.push(await imgBlock(a.frames[a.rep[r]].blob, 384));
  }
  C2.push({type:'text', text:'Return the JSON now.'});
  const {text, usd} = await claudeCall(CE_SYS, C2, {max:2500, signal});
  return {raw:jsonOut(text), usd};
}
// validarea strictă a răspunsului: doar id-uri existente, numere finite în limite, tăieturi posibile; restul ignorat (cu avertisment)
function ceValidate(raw, an){
  const n = an.length, id = s => { const m = /^c(\d+)$/.exec(String(s || '').trim()); const k = m ? +m[1] - 1 : -1; return k >= 0 && k < n ? k : -1; };
  const num = (x, lo, hi) => typeof x === 'number' && isFinite(x) && x >= lo && x <= hi ? x : null;
  const out = {pair:an.map(() => Array(n).fill(null)), type:an.map(() => Array(n).fill(null)), why:an.map(() => Array(n).fill(null)), open:Array(n).fill(0), close:Array(n).fill(0),
    trim:Array(n).fill(null), incompat:[], warnings:[], dropped:0, confidence:null, enough:true, order:null, actions:Array(n).fill('')};
  if(!raw || typeof raw !== 'object'){ out.enough = false; out.warnings.push('răspunsul nu e JSON valid'); return out; }
  for(const c of Array.isArray(raw.clips) ? raw.clips : []){ const k = id(c && c.id); if(k < 0){ out.dropped++; continue; }
    const o = num(c.opening, 0, 1), z = num(c.closing, 0, 1); if(o != null) out.open[k] = o; if(z != null) out.close[k] = z;
    out.actions[k] = String(c.action || '').slice(0, 120) + (c.stage ? ' (' + String(c.stage).slice(0, 12) + ')' : ''); }
  for(const p of Array.isArray(raw.pairs) ? raw.pairs : []){ const a = id(p && p.from), b = id(p && p.to), s = num(p && p.score, 0, 1);
    if(a < 0 || b < 0 || a === b || s == null){ out.dropped++; continue; }
    out.pair[a][b] = s; out.type[a][b] = p.type === 'fade' ? 'fade' : p.type === 'cut' ? 'cut' : null; out.why[a][b] = String(p.reason || '').slice(0, 160); }
  for(const t of Array.isArray(raw.trims) ? raw.trims : []){ const k = id(t && t.id); if(k < 0){ out.dropped++; continue; }
    const D = an[k].D, s = num(t.start, 0, D * .4) || 0, e = num(t.end, 0, D * .4) || 0;
    if((t.start != null && num(t.start, 0, D * .4) == null) || (t.end != null && num(t.end, 0, D * .4) == null) || D - s - e < .5){ out.dropped++; continue; }
    if(s || e) out.trim[k] = {start:+s.toFixed(2), end:+e.toFixed(2), why:String(t.reason || '').slice(0, 140)}; }
  for(const x of Array.isArray(raw.incompatible) ? raw.incompatible : []){ const a = id(x && x.a), b = id(x && x.b); if(a < 0 || b < 0 || a === b){ out.dropped++; continue; } out.incompat.push({a, b, why:String(x.reason || '').slice(0, 140)}); }
  if(Array.isArray(raw.order)){ const o = raw.order.map(id); if(o.length === n && new Set(o).size === n && o.every(k => k >= 0)) out.order = o; else out.dropped++; }
  out.confidence = num(raw.confidence, 0, 1); out.enough = raw.enough !== false;
  out.warnings = (Array.isArray(raw.warnings) ? raw.warnings : []).map(w => String(w).slice(0, 160)).filter(Boolean).slice(0, 6);
  const have = out.pair.flat().filter(x => x != null).length;
  if(have < n * (n - 1) / 2){ out.warnings.push(`Claude a evaluat doar ${have} din ${n * (n - 1)} perechi; restul se judecă doar după măsurători.`); }
  if(out.dropped) out.warnings.push(`${out.dropped} valori din răspuns nu erau valide și au fost ignorate.`);
  if(!out.enough) out.warnings.push('Claude spune că informația nu ajunge pentru o ordine sigură: verifică ordinea manual.');
  // ordinea propusă de Claude: un mic bonus perechilor consecutive din ea
  if(out.order) for(let k = 0; k + 1 < n; k++){ const a = out.order[k], b = out.order[k + 1]; out.pair[a][b] = Math.min(1, (out.pair[a][b] != null ? out.pair[a][b] : .6) + .05); }
  return out;
}
