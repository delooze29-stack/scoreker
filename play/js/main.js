// Game screen: turns, controls, scoreboard, computer opponent.
import { buildTable, World, summarise, castFirst, SPECS } from "./physics.js";
import * as Rules from "./rules.js";
import { think, LEVELS, potOptions } from "./ai.js";
import { View } from "./render.js";

const $ = id => document.getElementById(id);
const D2R = Math.PI / 180;

const STYLES = {
  snooker: { env: "studio", crowd: false, cloth: 0x119a25, wood: 0x6a3416, railWidth: 0.12, railRough: .32, plate: 0x2a170c, plateRough: .5, plateMetal: .05, diamonds: false },
  uk:      { env: "pub", crowd: false, cloth: 0x1d6e3c, wood: 0x3a2213, railWidth: 0.09, railRough: .42, plate: 0x0d0d0d, plateRough: .35, plateMetal: .15, diamonds: false },
  nine:    { env: "arena", crowd: true, cloth: 0x1673b8, wood: 0x0b0a09, railWidth: 0.11, railRough: .3, plate: 0x0b0b0b, plateRough: .4, plateMetal: .1, diamonds: true },
  us:      { env: "arena", crowd: true, cloth: 0x1673b8, wood: 0x0b0a09, railWidth: 0.11, railRough: .3, plate: 0x0b0b0b, plateRough: .4, plateMetal: .1, diamonds: true },
};
const GAMES = [
  { id: "snooker", name: "Snooker", note: "12ft table, 15 reds", cloth: "#27a83a", wood: "#6a3416", balls: ["#b3121c", "#b3121c", "#f08cb4", "#111"] },
  { id: "uk", name: "UK 8-ball", note: "7ft pub table, reds & yellows", cloth: "#1d6e3c", wood: "#2c1a10", balls: ["#c8141c", "#f2c200", "#111", "#c8141c"] },
  { id: "us", name: "US 8-ball", note: "8ft table, spots & stripes", cloth: "#1673b8", wood: "#161412", balls: ["#f2b705", "#1d3fae", "#d0261d", "#111"] },
  { id: "nine", name: "9-ball", note: "Lowest ball first, pot the 9 to win", cloth: "#1673b8", wood: "#161412", balls: ["#f2b705", "#1d3fae", "#7a1f1a", "#f2b705"] },
];

const cfg = { game: "snooker", opp: "medium", bestOf: 1, guides: "full", sound: true, quality: "high" };
let T, S, W, view, mode = "menu", aim = 0, pitch = 0, spin = { x: 0, y: 0 }, viewMode = "aim";
let cpu = null, follow = null, place = null, lastEvent = 0, frameFirst = 0, match = null, between = 0;

// ---------------------------------------------------------------- sound (synthesised, no files)
// Each contact is a short shaped burst: balls give a hard "clack", cushions a dull thump,
// pockets a drop and rattle, the cue tip a soft "tock". Louder for harder contacts.
const Snd = {
  ctx: null, noise: null, recent: [],
  init() {
    if (!this.ctx) try {
      const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const n = this.noise = c.createBuffer(1, Math.floor(c.sampleRate * 0.4), c.sampleRate), d = n.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.master = c.createGain(); this.master.gain.value = 0.9;
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      this.master.connect(comp); comp.connect(c.destination);
    } catch (e) {}
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },
  burst(t, dur, vol, type, freq, q) { // filtered noise with a sharp attack
    const c = this.ctx, src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.0015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t, Math.random() * 0.3); src.stop(t + dur + 0.02);
  },
  tone(t, dur, vol, f0, f1) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = "sine";
    o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },
  hit(v, kind) {
    if (!cfg.sound || !this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    this.recent = this.recent.filter(x => t - x < 0.06);
    if (this.recent.length > 5) return; // a busy break shouldn't turn into noise
    const k = Math.min(1, Math.pow(Math.max(0, v) / 3.2, 0.7));
    if (kind === "ball") {
      if (v < 0.06) return; this.recent.push(t);
      this.burst(t, 0.035, 0.9 * k, "bandpass", 3400 + Math.random() * 500, 1.6);
      this.tone(t, 0.018, 0.25 * k, 2600 + Math.random() * 300);
    } else if (kind === "cush") {
      if (v < 0.08) return; this.recent.push(t);
      this.burst(t, 0.09, 0.55 * k, "lowpass", 700, 0.8);
      this.tone(t, 0.08, 0.35 * k, 150, 90);
    } else if (kind === "pot") {
      this.recent.push(t);
      this.tone(t, 0.16, 0.5, 120, 60);
      this.burst(t, 0.22, 0.35, "lowpass", 500, 0.7);
      this.burst(t + 0.09, 0.05, 0.18, "bandpass", 1800, 2); // rattle in the drop
    } else if (kind === "cue") {
      this.burst(t, 0.03, 0.55 * k + 0.1, "bandpass", 1500, 2.2);
      this.tone(t, 0.035, 0.22 * k + 0.05, 700, 500);
    }
  },
};

// ---------------------------------------------------------------- menu
function seg(id, items, key, onPick) {
  const el = $(id); el.innerHTML = "";
  items.forEach(([v, label]) => {
    const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.setAttribute("aria-pressed", cfg[key] === v);
    b.onclick = () => { cfg[key] = v; el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b)); onPick && onPick(); };
    el.appendChild(b);
  });
}
function buildMenu() {
  const gp = $("gamePick"); gp.innerHTML = "";
  GAMES.forEach(g => {
    const b = document.createElement("button"); b.type = "button"; b.className = "game"; b.setAttribute("aria-pressed", cfg.game === g.id);
    b.innerHTML = `<div class="sw" style="--w:${g.wood};background:${g.cloth}">${g.balls.map((c, i) => `<i style="background:${c};left:${12 + i * 13}px;top:${i % 2 ? 14 : 6}px"></i>`).join("")}</div><div><b>${g.name}</b><br><small>${g.note}</small></div>`;
    b.onclick = () => { cfg.game = g.id; gp.querySelectorAll(".game").forEach(x => x.setAttribute("aria-pressed", x === b)); };
    gp.appendChild(b);
  });
  seg("oppPick", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"], ["pro", "Pro"], ["friend", "Friend"]], "opp");
  seg("framePick", [[1, "1"], [3, "3"], [5, "5"]], "bestOf");
  seg("guidePick", [["full", "Full"], ["short", "Short"], ["off", "Off"]], "guides");
  seg("gfxPick", [["high", "High"], ["standard", "Standard"]], "quality", () => view && view.setQuality(cfg.quality));
}
$("startBtn").onclick = () => { Snd.init(); startMatch(); };
$("resumeBtn").onclick = () => { $("menu").hidden = true; };
$("menuBtn").onclick = () => { $("resumeBtn").hidden = !S || !!S.over; $("menu").hidden = false; };
$("toMenuBtn").onclick = () => { $("result").hidden = true; $("resumeBtn").hidden = true; $("menu").hidden = false; };
$("nextBtn").onclick = () => { $("result").hidden = true; if (match.done) startMatch(); else startFrame(); };
$("soundBtn").onclick = () => { cfg.sound = !cfg.sound; const b = $("soundBtn"); b.setAttribute("aria-pressed", cfg.sound); b.setAttribute("aria-label", cfg.sound ? "Sound on" : "Sound off"); b.querySelector(".wave").style.opacity = cfg.sound ? 1 : 0.15; Snd.init(); };

// ---------------------------------------------------------------- match / frame
function players() {
  if (cfg.opp === "friend") return [{ name: "Player 1", type: "human" }, { name: "Player 2", type: "human" }];
  return [{ name: "You", type: "human" }, { name: `CPU · ${LEVELS[cfg.opp].name}`, type: "cpu", level: cfg.opp }];
}
function startMatch() {
  match = { game: cfg.game, players: players(), frames: [0, 0], bestOf: cfg.bestOf, done: false, high: [0, 0] };
  frameFirst = Math.random() < 0.5 ? 0 : 1;
  T = buildTable(cfg.game);
  view.build(T, cfg.game, STYLES[cfg.game]);
  startFrame();
}
function startFrame() {
  S = Rules.createGame(match.game, match.players, { first: frameFirst, frames: match.frames, bestOf: match.bestOf });
  frameFirst = 1 - frameFirst;
  W = new World(T); W.setBalls(S.balls); view.resetBalls(S.balls);
  $("menu").hidden = true; $("result").hidden = true;
  toast(`${S.players[S.turn].name} to break.`);
  pitch = 0; viewMode = "aim"; spin = { x: 0, y: 0 }; setSpin(0, 0);
  hud(); nextTurn();
}
function endFrame() {
  const w = S.over.winner;
  match.frames[w]++;
  if (S.high) match.high = match.high.map((h, i) => Math.max(h, S.high[i]));
  const need = Math.ceil(match.bestOf / 2);
  match.done = match.frames[w] >= need;
  const names = S.players.map(p => p.name);
  $("resBrand").textContent = match.done ? (match.bestOf > 1 ? "MATCH OVER" : "FRAME OVER") : `FRAME ${match.frames[0] + match.frames[1]} OF ${match.bestOf}`;
  $("resTitle").textContent = match.done ? `${names[w]} ${names[w] === "You" ? "win" : "wins"}${match.bestOf > 1 ? ` ${match.frames[w]}–${match.frames[1 - w]}` : ""}` : `${names[w]} ${names[w] === "You" ? "take" : "takes"} the frame`;
  $("resText").textContent = S.over.text;
  const rows = [["", names[0], names[1]], ["Frames", match.frames[0], match.frames[1]]];
  if (S.game === "snooker") rows.push(["Points", S.scores[0], S.scores[1]], ["Highest break", S.high[0], S.high[1]]);
  $("resStats").innerHTML = rows.map(r => r.map(c => `<span>${c}</span>`).join("")).join("");
  $("nextBtn").textContent = match.done ? "Play again" : "Next frame";
  $("result").hidden = false;
  mode = "over";
}

// ---------------------------------------------------------------- turns
function cueBall() { return W.ball(0); }
function nextTurn() {
  hud();
  if (S.over) { endFrame(); return; }
  const p = S.players[S.turn];
  follow = null;
  if (p.type === "cpu") {
    mode = "think"; cpu = { gen: think(T, S, p.level), t: 0 };
    $("think").hidden = false; $("thinkTxt").textContent = `${p.name.replace("CPU · ", "CPU ")} is thinking…`;
    viewMode = userTop ? "top" : "aim"; pitch = 0.45;
    if (S.ballInHand) { const c = cueBall(); c.on = false; }
    view.cam.mode = ""; camSnap();
    return;
  }
  $("think").hidden = true;
  if (S.ballInHand) {
    mode = "place";
    const z = Rules.zoneOf(S), m = Rules.marks(S.game);
    let p0 = z.type === "D" ? { x: z.x - 0.06, y: z.y - 0.1 } : z.type === "baulk" ? { x: z.x - 0.12, y: T.W / 2 } : { x: T.L * 0.25, y: T.W / 2 };
    if (!Rules.validPlacement(S, p0.x, p0.y)) p0 = findFree(z);
    place = p0;
    const c = cueBall(); Object.assign(c, { x: p0.x, y: p0.y, on: true, pocket: -1 });
    view.showZone(z); viewMode = "top"; camSnap();
    $("placeBar").hidden = false;
    $("placeTxt").textContent = z.type === "D" ? "Ball in hand in the D" : z.type === "baulk" ? "Ball in hand behind the line" : "Ball in hand anywhere";
  } else startAim();
}
function findFree(z) {
  for (let i = 0; i < 400; i++) {
    const x = z.type === "D" ? z.x - Math.random() * z.r : z.type === "baulk" ? Math.random() * z.x : Math.random() * T.L;
    const y = z.type === "D" ? z.y + (Math.random() * 2 - 1) * z.r : Math.random() * T.W;
    if (Rules.validPlacement(S, x, y)) return { x, y };
  }
  return { x: T.R * 2, y: T.W / 2 };
}
function startAim() {
  mode = "aim"; pitch = humanPitch; hintsShown++;
  $("placeBar").hidden = true; view.showZone(null);
  if (viewMode === "top" && !userTop) viewMode = "aim";
  const c = cueBall();
  const opts = potOptions(T, S, 0.5);
  if (S.isBreak) { // aim at the pack: the apex in pool, the outside red of the back row in snooker
    const pack = S.balls.filter(b => b.on && b.id).map(b => W.ball(b.id)).filter(b => Rules.def(S.game, b.id).kind !== "colour");
    let t;
    if (S.game === "snooker") { const back = pack.sort((a, b) => b.x - a.x).slice(0, 5).sort((a, b) => Math.abs(b.y - c.y) - Math.abs(a.y - c.y)); t = back[back.length - 1]; const d = Math.hypot(t.x - c.x, t.y - c.y); aim = Math.atan2(t.y - c.y, t.x - c.x) + Math.sign(c.y - t.y || 1) * Math.asin(Math.min(.99, 1.8 * T.R / d)); }
    else { t = pack.sort((a, b) => a.x - b.x)[0]; aim = Math.atan2(t.y - c.y, t.x - c.x); }
  } else if (opts.length && cfg.guides !== "off") aim = opts[0].angle;
  else {
    const legal = Rules.legalFirst(S).map(id => W.ball(id)).sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y));
    if (legal[0]) aim = Math.atan2(legal[0].y - c.y, legal[0].x - c.x);
  }
  camSnap();
  hint(viewMode === "aim" ? "Drag left or right to aim, up or down to raise the view, pinch to zoom. Pull the cue on the right down, then let go to strike." : "Tap or drag to point the cue. Pull the cue on the right down, then let go to strike.");
}
let userTop = false, humanPitch = 0.18;
function camSnap() { viewState.snap = true; const b = $("viewBtn"); b.setAttribute("aria-pressed", viewMode === "top"); b.setAttribute("aria-label", viewMode === "top" ? "Behind the ball view" : "Overhead view"); }

// ---------------------------------------------------------------- shooting
// Near a cushion the cue has to pass over it: keep the cue as level as possible (at most ~15°)
// and, if that isn't enough, only the top of the cue ball can be hit.
const EMAX = 0.26;
function cueLimits(c, angle, sy) {
  const R = T.R, ux = Math.cos(angle), uy = Math.sin(angle), bx = -ux, by = -uy, sx0 = c.x - ux * R, sy0 = c.y - uy * R;
  const exitAt = m => {
    const a = bx > 0 ? (T.L + m - sx0) / bx : bx < 0 ? (-m - sx0) / bx : Infinity;
    const b = by > 0 ? (T.W + m - sy0) / by : by < 0 ? (-m - sy0) / by : Infinity;
    return Math.max(0.002, Math.min(a, b));
  };
  const dC = exitAt(0), dR = exitAt(T.cw), Hc = R * 1.4 + 0.007, Hr = (view.rh || R * 1.4) + 0.01;
  const hMin = Math.max(Hc - dC * Math.tan(EMAX), Hr - dR * Math.tan(EMAX));
  const minY = Math.min(0.85, (hMin - R) / (0.5 * R));
  const y = Math.max(sy, minY), tipH = R + y * 0.5 * R;
  const elev = Math.max(0.05, Math.atan2(Math.max(0, Hc - tipH), dC), Math.atan2(Math.max(0, Hr - tipH), dR));
  return { minY: minY > -0.99 ? minY : null, y, elev: Math.min(elev, 0.5) };
}

// Power comes from pulling the cue back: the further, the harder (with finer control at the soft end).
let lastPower = 0.4, pullP = 0;
const speedFor = p => T.spec.vmax * (0.025 + 0.975 * Math.pow(p, 1.45));
function shoot(p = lastPower) {
  if (mode !== "aim") return;
  Snd.init(); lastPower = p;
  const boost = S.isBreak && S.game !== "snooker" ? 1.12 : 1; // a full-blooded break
  const lim = cueLimits(cueBall(), aim, spin.y);
  startStroke({ angle: aim, speed: speedFor(p) * boost, sx: spin.x, sy: lim.y }, pullGap(p));
}
const pullGap = p => T.R * 1.4 + p * T.R * 10;
function startStroke(d, pulled) {
  closeSpin();
  mode = "stroke"; cpu = cpu || {}; cpu.stroke = { d, t: pulled ? 0.5 : 0, from: pulled || T.R * 7.4, fast: !!pulled };
  hint("");
}
// the pull strip
const pullEl = $("pull"), pcue = $("pcue"), pfill = $("pfill"), pval = $("pval");
let pulling = null;
function showPull(p) {
  const h = pullEl.querySelector(".ptrack").clientHeight * 0.8;
  pcue.style.transform = `translate(-50%, ${p * h}px)`; pfill.style.height = `calc(${p * 100}% - 6px)`;
  pval.textContent = p > 0.005 ? `${Math.round(p * 100)}%` : "PULL";
  pullEl.classList.toggle("on", p > 0.005);
  pullEl.setAttribute("aria-valuenow", Math.round(p * 100));
}
pullEl.addEventListener("pointerdown", e => {
  e.stopPropagation(); if (mode !== "aim") return;
  Snd.init(); pulling = { y: e.clientY }; pullP = 0;
  try { pullEl.setPointerCapture(e.pointerId); } catch (_) {}
});
pullEl.addEventListener("pointermove", e => {
  if (!pulling || mode !== "aim") return;
  const h = pullEl.querySelector(".ptrack").clientHeight * 0.8;
  pullP = Math.max(0, Math.min(1, (e.clientY - pulling.y) / h)); showPull(pullP);
});
const release = () => {
  if (!pulling) return; pulling = null;
  const p = pullP; pullP = 0; showPull(0);
  if (p > 0.02 && mode === "aim") shoot(p);
};
pullEl.addEventListener("pointerup", release); pullEl.addEventListener("pointercancel", () => { pulling = null; pullP = 0; showPull(0); });
function strike(d) {
  d = { ...d, sy: cueLimits(cueBall(), d.angle, d.sy).y };
  W.strike(0, d.angle, d.speed, d.sx, d.sy);
  Snd.hit(d.speed, "cue");
  lastEvent = 0; mode = "run";
  const c = cueBall();
  const bk = (0.34 + pitch * 1.1) * zoom.aim;
  follow = { eye: { x: c.x - Math.cos(d.angle) * bk, y: c.y - Math.sin(d.angle) * bk }, track: { x: c.x, y: c.y }, angle: d.angle };
}
function endShot() {
  const sum = summarise(W.events);
  S.balls = W.balls.map(b => ({ id: b.id, x: b.x, y: b.y, on: b.on }));
  const res = Rules.resolve(S, sum);
  S = res.state;
  W.setBalls(S.balls); view.resetBalls(S.balls);
  toast(res.info.text, !!res.info.foul);
  hud();
  mode = "between"; between = 1.0;
  cpu = null;
}

// ---------------------------------------------------------------- input
const stage = $("stage");
let drag = null, pinch = null;
const touches = new Map();
// zoom per camera: below 1 is closer, above 1 further away (pinch, or the mouse wheel)
const zoom = { aim: 1, top: 1, tv: 1 };
const zoomKey = () => viewState.mode === "top" ? "top" : viewState.mode === "tv" ? "tv" : "aim";
const zoomLimits = { aim: [0.55, 2.6], top: [0.45, 1], tv: [0.55, 1.6] };
function setZoom(k, z) { const [a, b] = zoomLimits[k]; zoom[k] = Math.max(a, Math.min(b, z)); }
stage.addEventListener("pointerdown", e => {
  if (e.target.closest("button") || e.target.closest("#pull") || e.target.closest(".spinbig") || e.target.closest(".ctl")) return;
  Snd.init();
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  if (touches.size === 2) { // second finger: pinch to zoom, and leave the aim where it was
    const [a, b] = [...touches.values()], k = zoomKey();
    if (drag) { aim = drag.aim; pitch = drag.pitch; }
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zoom[k], k }; drag = null; return;
  }
  if (touches.size > 2) return;
  drag = { x: e.clientX, y: e.clientY, aim, pitch, axis: null };
  if (mode === "place") movePlace(e);
  else if (mode === "aim" && viewMode === "top") pointAim(e);
});
stage.addEventListener("wheel", e => { e.preventDefault(); const k = zoomKey(); setZoom(k, zoom[k] * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
stage.addEventListener("pointermove", e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    if (touches.size < 2) return;
    const [a, b] = [...touches.values()], d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
    setZoom(pinch.k, pinch.z * pinch.d / d); // fingers apart = closer, together = further away
    return;
  }
  if (!drag) return;
  if (mode === "place") { movePlace(e); return; }
  if (mode !== "aim") return;
  if (viewMode === "top") { pointAim(e); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.axis && Math.hypot(dx, dy) > 6) drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  // about 0.07° per pixel: a long, slow drag for fine adjustments
  if (drag.axis === "x") aim = drag.aim - dx * 0.0012 * (1 - pitch * 0.3) * Math.min(1.4, Math.max(0.6, zoom.aim));
  if (drag.axis === "y") humanPitch = pitch = Math.max(0, Math.min(1, drag.pitch - dy * 0.004));
});
const up = e => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; if (!touches.size) drag = null; };
stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
function movePlace(e) {
  const p = view.pick(e.clientX, e.clientY); if (!p) return;
  const z = Rules.zoneOf(S);
  let { x, y } = p;
  if (z.type === "D") { if (x > z.x) x = z.x; const d = Math.hypot(x - z.x, y - z.y); if (d > z.r) { x = z.x + (x - z.x) * z.r / d; y = z.y + (y - z.y) * z.r / d; } }
  if (z.type === "baulk") x = Math.min(x, z.x);
  x = Math.max(T.R, Math.min(T.L - T.R, x)); y = Math.max(T.R, Math.min(T.W - T.R, y));
  if (Rules.validPlacement(S, x, y)) { place = { x, y }; Object.assign(cueBall(), { x, y }); }
}
function pointAim(e) {
  const p = view.pick(e.clientX, e.clientY), c = cueBall(); if (!p) return;
  if (Math.hypot(p.x - c.x, p.y - c.y) > T.R * 1.5) aim = Math.atan2(p.y - c.y, p.x - c.x);
}
$("placeDone").onclick = () => {
  if (mode !== "place" || !place) return;
  Rules.placeCue(S, place.x, place.y);
  W.setBalls(S.balls); view.resetBalls(S.balls);
  startAim();
};
$("viewBtn").onclick = () => {
  if (mode === "place") return;
  viewMode = viewMode === "top" ? "aim" : "top"; userTop = viewMode === "top"; camSnap();
  hint(mode === "aim" ? (viewMode === "aim" ? "Drag ← → to aim · ↑ ↓ to raise the view" : "Tap or drag to point the cue") : "");
};
[["aL", 1], ["aR", -1]].forEach(([id, dir]) => {
  const el = $(id); let t1, t2, n = 0; const stop = () => { clearTimeout(t1); clearInterval(t2); };
  const nudge = () => { if (mode !== "aim") return; n++; aim += dir * (n < 12 ? 0.1 : n < 30 ? 0.3 : 1) * D2R; };
  el.addEventListener("pointerdown", e => { e.preventDefault(); n = 0; nudge(); t1 = setTimeout(() => t2 = setInterval(nudge, 55), 380); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, stop));
});
window.addEventListener("keydown", e => {
  if (mode !== "aim") return;
  if (e.key === "ArrowLeft") { aim += (e.shiftKey ? 1 : 0.1) * D2R; e.preventDefault(); }
  if (e.key === "ArrowRight") { aim -= (e.shiftKey ? 1 : 0.1) * D2R; e.preventDefault(); }
  if (e.key === " ") { shoot(lastPower); e.preventDefault(); }
  if (e.key === "ArrowUp") { lastPower = Math.min(1, lastPower + 0.05); toast(`Power ${Math.round(lastPower * 100)}% (Space to strike)`); e.preventDefault(); }
  if (e.key === "ArrowDown") { lastPower = Math.max(0.02, lastPower - 0.05); toast(`Power ${Math.round(lastPower * 100)}% (Space to strike)`); e.preventDefault(); }
});

// spin: tap the small cue ball to open a big one, set the tip position, then close it
const pad = $("spinPad"), dot = $("spinDot"), big = $("spinBig"), bigPad = $("spinBigPad"), bigDot = $("spinBigDot");
function spinLabel(x, y) {
  const v = y > 0.15 ? "Top" : y < -0.15 ? "Screw" : "", h = x > 0.15 ? "right" : x < -0.15 ? "left" : "";
  return !v && !h ? "Centre" : v && h ? `${v} + ${h}` : v || (h === "right" ? "Right side" : "Left side");
}
function setSpin(x, y) {
  limShown = null;
  const l = Math.hypot(x, y), m = 0.85; if (l > m) { x *= m / l; y *= m / l; }
  if (Math.hypot(x, y) < 0.06) { x = 0; y = 0; }
  spin = { x, y };
  for (const d of [dot, bigDot]) { d.setAttribute("cx", (x * 47).toFixed(1)); d.setAttribute("cy", (-y * 47).toFixed(1)); }
  $("spinTxt").textContent = spinLabel(x, y);
  const amt = Math.round(Math.hypot(x, y) / 0.85 * 100);
  $("spinBigTxt").textContent = spinLabel(x, y) + (amt ? ` · ${amt}%` : "");
}
let limShown = null;
function showCushionLimit(lim) {
  const forced = lim && lim.minY !== null && lim.minY > spin.y + 0.02;
  const key = forced ? lim.minY.toFixed(2) : "";
  if (key === limShown) return; limShown = key;
  const y = forced ? lim.y : spin.y;
  for (const d of [dot, bigDot]) d.setAttribute("cy", (-y * 47).toFixed(1));
  $("spinTxt").textContent = forced ? "Top only (cushion)" : spinLabel(spin.x, spin.y);
  const band = $("spinBand");
  if (band) { band.style.display = lim && lim.minY !== null ? "" : "none"; if (lim && lim.minY !== null) band.setAttribute("y", (-lim.minY * 47).toFixed(1)); }
}
function openSpin() { if (mode !== "aim") return; big.hidden = false; }
function closeSpin() { big.hidden = true; }
pad.addEventListener("pointerdown", e => { e.stopPropagation(); openSpin(); });
let bigDrag = false;
const bigAt = e => { const r = bigPad.getBoundingClientRect(); setSpin(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); };
bigPad.addEventListener("pointerdown", e => { e.stopPropagation(); bigDrag = true; try { bigPad.setPointerCapture(e.pointerId); } catch (_) {} bigAt(e); });
bigPad.addEventListener("pointermove", e => { if (bigDrag) bigAt(e); });
["pointerup", "pointercancel"].forEach(ev => bigPad.addEventListener(ev, () => bigDrag = false));
$("spinReset").onclick = () => setSpin(0, 0);
$("spinDone").onclick = closeSpin;
big.addEventListener("pointerdown", e => { if (e.target === big) closeSpin(); });

// ---------------------------------------------------------------- HUD + messages
let toastTimer = 0, toastT = null;
function toast(text, foul) { const t = $("toast"); t.textContent = text; t.classList.toggle("foul", !!foul); t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3400); }
let hintsShown = 0;
function hint(t) { if (t && hintsShown > 3) t = ""; $("hint").textContent = t; $("hint").hidden = !t; }
function hud() {
  if (!S) return;
  const g = S.game;
  for (let i = 0; i < 2; i++) {
    const el = $("p" + i);
    el.classList.toggle("on", S.turn === i && !S.over);
    el.querySelector(".nm").textContent = S.players[i].name;
    let sub = "";
    if (g === "nine") {
      el.querySelector(".sc").textContent = match ? match.frames[i] : 0; el.querySelector(".sc").style.fontSize = "";
      sub = "racks";
    } else if (g === "snooker") {
      el.querySelector(".sc").textContent = S.scores[i];
      sub = S.high && S.high[i] ? `High ${S.high[i]}` : "";
    } else {
      const grp = S.groups[i], left = Rules.shotsLeft(S, i);
      el.querySelector(".sc").textContent = grp ? (grp[0].toUpperCase() + grp.slice(1) + "s") : "–";
      el.querySelector(".sc").style.fontSize = grp ? "22px" : "";
      if (left) sub = left.map(id => { const d = Rules.def(g, id); return `<span class="dot ${d.kind === "stripe" ? "stripe" : ""}" style="background:${d.color};--c:${d.color}"></span>`; }).join("");
      if (grp && left && !left.length) sub = `on the ${g === "uk" ? "black" : "8"}`;
      if (g === "uk" && S.turn === i && S.visits === 2) sub = `<b style="color:var(--amber)">2 shots</b> ${sub}`;
    }
    el.querySelector(".sub").innerHTML = sub;
  }
  $("frames").textContent = match ? (match.bestOf > 1 ? `${match.frames[0]} (${match.bestOf}) ${match.frames[1]}` : "Frame") : "";
  $("onTxt").textContent = S.over ? "Frame over" : `On ${Rules.ballOnText(S)}`;
  if (g === "snooker") {
    const reds = S.balls.filter(b => b.on && Rules.def(g, b.id).kind === "red").length;
    $("leftTxt").innerHTML = `<span><b>${reds}</b> red${reds === 1 ? "" : "s"}</span><span><b>${Rules.pointsLeft(S)}</b> on the table</span>${S.brk ? `<span>Break <b>${S.brk}</b></span>` : ""}`;
  } else if (g === "nine") {
    $("leftTxt").innerHTML = S.balls.filter(b => b.on && b.id).sort((a, b) => a.id - b.id).map(b => { const d = Rules.def(g, b.id); return `<span class="dot ${d.kind === "stripe" ? "stripe" : ""}" style="background:${d.color};--c:${d.color}"></span>`; }).join("");
  } else $("leftTxt").innerHTML = S.isBreak ? "<span>Break off</span>" : S.freeTable ? "<span><b>Free table</b></span>" : "";
  const me = S.players[S.turn];
  $("turnChip").textContent = S.over ? "" : me.type === "human" ? (S.players[1].type === "human" ? `${me.name} to play` : "Your shot") : `${me.name}`;
  $("turnChip").classList.toggle("me", me.type === "human");
  pullEl.classList.toggle("off", mode !== "aim");
}

// ---------------------------------------------------------------- overlap inset
const ov = $("ov"), ox = ov.getContext("2d");
function drawOverlap(hit) {
  const w = ov.width, h = ov.height; ox.clearRect(0, 0, w, h);
  ox.fillStyle = "#" + new THREE.Color(STYLES[S.game].cloth).getHexString(); ox.fillRect(0, h * .6, w, h * .4);
  const c = cueBall();
  if (!hit || !hit.ball) { $("ovTxt").textContent = "No ball in line"; return; }
  const b = hit.ball, ux = Math.cos(aim), uy = Math.sin(aim), lat = ux * (b.y - c.y) - uy * (b.x - c.x);
  const r = h * .27, cx = w / 2, cy = h * .45, k = r / T.R;
  const d = Rules.def(S.game, b.id), bx = cx - lat * k;
  ox.fillStyle = d.color; ox.beginPath(); ox.arc(bx, cy, r, 0, 7); ox.fill();
  ox.fillStyle = "rgba(246,243,234,.45)"; ox.beginPath(); ox.arc(cx, cy, r, 0, 7); ox.fill(); ox.strokeStyle = "#fff"; ox.lineWidth = 3; ox.stroke();
  ox.fillStyle = "#23466a"; ox.beginPath(); ox.arc(cx + spin.x * r * .5, cy - spin.y * r * .5, r * .13, 0, 7); ox.fill();
  const f = 1 - Math.abs(lat) / (2 * T.R);
  const names = [[1, "full ball"], [7 / 8, "⅞ ball"], [3 / 4, "¾ ball"], [5 / 8, "⅝ ball"], [1 / 2, "½ ball"], [3 / 8, "⅜ ball"], [1 / 4, "¼ ball"], [1 / 8, "⅛ ball"], [1 / 16, "very thin"]];
  let best = names[0]; for (const n of names) if (Math.abs(n[0] - f) < Math.abs(best[0] - f)) best = n;
  $("ovTxt").textContent = `${d.name[0].toUpperCase() + d.name.slice(1)}: ${best[1]}`;
}

// ---------------------------------------------------------------- guides
function guides() {
  if (mode !== "aim" || cfg.guides === "off") { view.setGuides(null); return castFirst(T, W.balls, 0, aim); }
  const c = cueBall(), hit = castFirst(T, W.balls, 0, aim), g = { from: c, to: hit };
  if (hit.ball) {
    g.ghost = hit;
    const nx = hit.ball.x - hit.x, ny = hit.ball.y - hit.y, nl = Math.hypot(nx, ny), n = { x: nx / nl, y: ny / nl };
    const len = cfg.guides === "full" ? 0.55 : 0.14;
    g.objFrom = hit.ball; g.objTo = { x: hit.ball.x + n.x * len, y: hit.ball.y + n.y * len };
    if (cfg.guides === "full") {
      const ux = Math.cos(aim), uy = Math.sin(aim), dn = ux * n.x + uy * n.y; let tx = ux - dn * n.x, ty = uy - dn * n.y; const tl = Math.hypot(tx, ty);
      if (tl > 0.02) { tx /= tl; ty /= tl; g.cueFrom = hit; g.cueTo = { x: hit.x + tx * 0.25 * tl, y: hit.y + ty * 0.25 * tl }; }
    }
  } else g.ghost = hit;
  view.setGuides(g);
  return hit;
}

// ---------------------------------------------------------------- main loop
const DTMAX = /[?&]fast/.test(location.search) ? 0.6 : 0.1;
const viewState = { mode: "aim", pitch: 0, angle: 0, cue: { x: 0, y: 0 }, snap: true };
let last = performance.now();
function frame(now) {
  const dt = Math.min(DTMAX, (now - last) / 1000); last = now;
  if (S && W) {
    const c = cueBall();
    if (mode === "think") {
      const t0 = performance.now();
      let r;
      do { r = cpu.gen.next(); } while (!r.done && performance.now() - t0 < 10);
      if (r.done) {
        const d = r.value; $("think").hidden = true;
        if (d.place) { Rules.placeCue(S, d.place.x, d.place.y); W.setBalls(S.balls); view.resetBalls(S.balls); }
        cpu = { d, from: aim, t: 0 }; mode = "cpuaim";
        const cb = cueBall(); const lg = Rules.legalFirst(S).map(id => W.ball(id))[0];
        cpu.from = lg ? Math.atan2(lg.y - cb.y, lg.x - cb.x) : d.angle; aim = cpu.from; camSnap();
      }
    } else if (mode === "cpuaim") {
      cpu.t += dt;
      const k = Math.min(1, cpu.t / 1.1), e = k * k * (3 - 2 * k);
      let da = cpu.d.angle - cpu.from; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      aim = cpu.from + da * e;
      if (cpu.t > 1.5) startStroke(cpu.d);
    } else if (mode === "stroke") {
      const st = cpu.stroke; st.t += dt;
      if (st.t > (st.fast ? 0.5 + 0.06 + 0.05 * (1 - st.from / (T.R * 11.4)) : 0.62)) strike(st.d);
    } else if (mode === "run") {
      W.advance(dt);
      for (; lastEvent < W.events.length; lastEvent++) {
        const e = W.events[lastEvent];
        Snd.hit(e.v || 2, e.t === "hit" ? "ball" : e.t === "cush" ? "cush" : "pot");
      }
      // camera stays put and turns to keep the action in view
      const firstHit = W.events.find(e => e.t === "hit" && (e.a === 0 || e.b === 0));
      let tb = c;
      if (firstHit) { const ob = W.ball(firstHit.a === 0 ? firstHit.b : firstHit.a); if (ob.on || ob.pocket >= 0) tb = ob; }
      const tp = tb.on ? tb : (tb.pocket >= 0 ? T.pockets[tb.pocket].drop : tb);
      follow.track = { x: tp.x, y: tp.y };
      follow.t = (follow.t || 0) + dt;
      if (firstHit && follow.hitT == null) follow.hitT = follow.t;
      if (!follow.high && follow.t > (follow.hitT != null ? follow.hitT + 0.45 : 1.3)) follow.high = true;
      if (!W.moving() && !view.potAnimating()) endShot();
    } else if (mode === "between") {
      between -= dt; if (between <= 0) nextTurn();
    }
    // cue + guides
    const showCue = (mode === "aim" || mode === "cpuaim" || mode === "stroke") && c.on;
    let gap = T.R * 1.4;
    if (mode === "aim" && pulling) gap = pullGap(pullP);
    if (mode === "stroke") { const st = cpu.stroke, t = st.t; const fwd = st.fast ? 0.06 + 0.05 * (1 - st.from / (T.R * 11.4)) : 0.12; gap = t < 0.5 ? T.R * 1.4 + Math.sin(t / 0.5 * Math.PI / 2) * T.R * 6 : Math.max(0, st.from * (1 - (t - 0.5) / fwd)); }
    let sp = mode === "cpuaim" || (mode === "stroke" && cpu.stroke.d !== undefined && S.players[S.turn].type === "cpu") ? { x: cpu.d ? cpu.d.sx : 0, y: cpu.d ? cpu.d.sy : 0 } : { ...spin };
    const cAng = mode === "stroke" ? cpu.stroke.d.angle : aim;
    let lim = null;
    if (showCue) { lim = cueLimits(c, cAng, sp.y); if (mode === "aim") sp.y = lim.y; }
    view.setCue(showCue, c, cAng, sp, gap, lim ? lim.elev : 0.07);
    if (mode === "aim") showCushionLimit(lim);
    const hit = mode === "aim" ? guides() : (view.setGuides(null), null);
    $("inset").hidden = mode !== "aim" || !c.on || viewMode === "top";
    if (!$("inset").hidden) drawOverlap(hit);
    // camera
    const cpuTurn = S.players[S.turn].type === "cpu" && mode !== "between";
    viewState.mode = mode === "place" ? "top" : viewMode === "top" ? "top" : cpuTurn && (mode === "think" || mode === "cpuaim" || mode === "stroke" || mode === "run") ? "tv" : mode === "run" ? (follow.high ? "tv" : "follow") : viewMode;
    viewState.pitch = pitch; viewState.angle = mode === "run" ? follow.angle : (mode === "stroke" ? cpu.stroke.d.angle : aim);
    viewState.cue = mode === "run" ? { x: follow.eye.x + Math.cos(follow.angle) * (0.34 + pitch * 1.1), y: follow.eye.y + Math.sin(follow.angle) * (0.34 + pitch * 1.1) } : { x: c.x, y: c.y };
    viewState.track = follow && follow.track; viewState.eye = follow && follow.eye;
    viewState.zoom = zoom[viewState.mode === "top" ? "top" : viewState.mode === "tv" ? "tv" : "aim"];
    view.sync(W, dt);
    view.updateCamera(viewState, dt);
    view.render();
    pullEl.classList.toggle("off", mode !== "aim");
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
buildMenu();
hint("");
try {
  view = new View(stage); view.setQuality(cfg.quality);
  // show a table behind the menu
  T = buildTable(cfg.game); view.build(T, cfg.game, STYLES[cfg.game]);
  S = Rules.createGame(cfg.game, players()); W = new World(T); W.setBalls(S.balls); view.resetBalls(S.balls);
  S.ballInHand = null; aim = 0; viewMode = "aim"; pitch = 0.55; mode = "idle";
  const c = W.ball(0); aim = Math.atan2(T.W / 2 - c.y, T.L * 0.75 - c.x);
} catch (e) { console.error(e); $("menu").querySelector("p").textContent = "Your browser couldn't start the 3D table."; }
hud();
requestAnimationFrame(frame);
window.__game = { zoom, pull: p => shoot(p), get S() { return S; }, get W() { return W; }, get mode() { return mode; }, set aim(a) { aim = a; }, get aim() { return aim; }, set pitch(p) { pitch = p; }, shoot, cfg, endFrame: () => { S.over = { winner: 0, text: 'Test frame over.' }; nextTurn(); }, renderInfo: () => view.renderer.info.render };
