// Game screen: turns, controls, scoreboard, computer opponent.
import { buildTable, World, summarise, castFirst, SPECS } from "./physics.js";
import * as Rules from "./rules.js";
import { think, LEVELS, potOptions } from "./ai.js";
import { View } from "./render.js";

const $ = id => document.getElementById(id);
const D2R = Math.PI / 180;

const STYLES = {
  snooker: { crowd: true, cloth: 0x1a6a33, wood: 0x4b2412, railWidth: 0.12, railRough: .4, plate: 0x2a170c, plateRough: .5, plateMetal: .05, diamonds: false },
  uk:      { crowd: false, cloth: 0x1d6e3c, wood: 0x3a2213, railWidth: 0.09, railRough: .42, plate: 0x0d0d0d, plateRough: .35, plateMetal: .15, diamonds: false },
  us:      { crowd: true, cloth: 0x1673b8, wood: 0x0b0a09, railWidth: 0.11, railRough: .3, plate: 0x0b0b0b, plateRough: .4, plateMetal: .1, diamonds: true },
};
const GAMES = [
  { id: "snooker", name: "Snooker", note: "12ft table, 15 reds", cloth: "#1a6a33", wood: "#4b2412", balls: ["#b3121c", "#b3121c", "#f08cb4", "#111"] },
  { id: "uk", name: "UK 8-ball", note: "7ft pub table, reds & yellows", cloth: "#1d6e3c", wood: "#2c1a10", balls: ["#c8141c", "#f2c200", "#111", "#c8141c"] },
  { id: "us", name: "US 8-ball", note: "8ft table, spots & stripes", cloth: "#1673b8", wood: "#161412", balls: ["#f2b705", "#1d3fae", "#d0261d", "#111"] },
];

const cfg = { game: "snooker", opp: "medium", bestOf: 1, guides: "full", sound: true };
let T, S, W, view, mode = "menu", aim = 0, pitch = 0, spin = { x: 0, y: 0 }, viewMode = "aim";
let cpu = null, follow = null, place = null, lastEvent = 0, frameFirst = 0, match = null, between = 0;

// ---------------------------------------------------------------- sound (synthesised clicks)
const Snd = {
  ctx: null,
  init() { if (!this.ctx) try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); },
  hit(v, kind) {
    if (!cfg.sound || !this.ctx || v < 0.05) return;
    const c = this.ctx, t = c.currentTime, g = c.createGain(), vol = Math.min(1, v / 4) * (kind === "cush" ? 0.35 : kind === "cue" ? 0.6 : 0.8);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === "pot" ? 0.25 : 0.06));
    const o = c.createOscillator(); o.type = "sine";
    o.frequency.setValueAtTime(kind === "cush" ? 180 : kind === "pot" ? 90 : kind === "cue" ? 900 : 2600 + Math.random() * 400, t);
    if (kind === "pot") o.frequency.exponentialRampToValueAtTime(45, t + 0.25);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + 0.3);
    if (kind !== "pot") { // a little noise for the click
      const n = c.createBufferSource(), buf = c.createBuffer(1, 600, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / 80);
      n.buffer = buf; const ng = c.createGain(); ng.gain.value = vol * 0.6; n.connect(ng); ng.connect(c.destination); n.start(t);
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
}
$("startBtn").onclick = () => { Snd.init(); startMatch(); };
$("resumeBtn").onclick = () => { $("menu").hidden = true; };
$("menuBtn").onclick = () => { $("resumeBtn").hidden = !S || !!S.over; $("menu").hidden = false; };
$("toMenuBtn").onclick = () => { $("result").hidden = true; $("resumeBtn").hidden = true; $("menu").hidden = false; };
$("nextBtn").onclick = () => { $("result").hidden = true; if (match.done) startMatch(); else startFrame(); };
$("soundBtn").onclick = () => { cfg.sound = !cfg.sound; $("soundBtn").textContent = cfg.sound ? "🔊" : "🔈"; Snd.init(); };

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
  mode = "aim"; pitch = humanPitch;
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
  if (S.isBreak && S.game !== "snooker") $("pw").value = 85; else if (S.isBreak) $("pw").value = 55;
  powerOut();
  camSnap();
  hint(viewMode === "aim" ? "Drag ← → to aim · ↑ ↓ to raise the view" : "Tap or drag to point the cue");
}
let userTop = false, humanPitch = 0.18;
function camSnap() { viewState.snap = true; $("viewBtn").textContent = viewMode === "top" ? "Behind ball" : "Overhead"; }

// ---------------------------------------------------------------- shooting
function power() { return +$("pw").value / 100; }
function powerOut() { $("pwOut").textContent = $("pw").value + "%"; }
$("pw").oninput = powerOut;
function shoot() {
  if (mode !== "aim") return;
  Snd.init();
  startStroke({ angle: aim, speed: Math.max(0.05, power()) * T.spec.vmax, sx: spin.x, sy: spin.y });
}
function startStroke(d) {
  mode = "stroke"; cpu = cpu || {}; cpu.stroke = { d, t: 0 };
  hint("");
}
function strike(d) {
  W.strike(0, d.angle, d.speed, d.sx, d.sy);
  Snd.hit(d.speed, "cue");
  lastEvent = 0; mode = "run";
  const c = cueBall();
  follow = { eye: { x: c.x - Math.cos(d.angle) * (0.34 + pitch * 1.1), y: c.y - Math.sin(d.angle) * (0.34 + pitch * 1.1) }, track: { x: c.x, y: c.y }, angle: d.angle };
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
let drag = null;
stage.addEventListener("pointerdown", e => {
  if (e.target.closest("button")) return;
  Snd.init();
  drag = { x: e.clientX, y: e.clientY, aim, pitch, axis: null };
  try { stage.setPointerCapture(e.pointerId); } catch (_) {}
  if (mode === "place") movePlace(e);
  else if (mode === "aim" && viewMode === "top") pointAim(e);
});
stage.addEventListener("pointermove", e => {
  if (!drag) return;
  if (mode === "place") { movePlace(e); return; }
  if (mode !== "aim") return;
  if (viewMode === "top") { pointAim(e); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.axis && Math.hypot(dx, dy) > 6) drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
  if (drag.axis === "x") aim = drag.aim - dx * 0.0032 * (1 - pitch * 0.4);
  if (drag.axis === "y") humanPitch = pitch = Math.max(0, Math.min(1, drag.pitch - dy * 0.004));
});
const up = () => { drag = null; };
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
$("shoot").onclick = shoot;
$("viewBtn").onclick = () => {
  if (mode === "place") return;
  viewMode = viewMode === "top" ? "aim" : "top"; userTop = viewMode === "top"; camSnap();
  hint(mode === "aim" ? (viewMode === "aim" ? "Drag ← → to aim · ↑ ↓ to raise the view" : "Tap or drag to point the cue") : "");
};
[["aL2", 1], ["aL1", 0.1], ["aR1", -0.1], ["aR2", -1]].forEach(([id, d]) => {
  const el = $(id); let t1, t2; const stop = () => { clearTimeout(t1); clearInterval(t2); };
  const nudge = () => { if (mode === "aim") aim += d * D2R; };
  el.addEventListener("pointerdown", e => { e.preventDefault(); nudge(); t1 = setTimeout(() => t2 = setInterval(nudge, 60), 350); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => el.addEventListener(ev, stop));
});
window.addEventListener("keydown", e => {
  if (mode !== "aim") return;
  if (e.key === "ArrowLeft") { aim += (e.shiftKey ? 1 : 0.1) * D2R; e.preventDefault(); }
  if (e.key === "ArrowRight") { aim -= (e.shiftKey ? 1 : 0.1) * D2R; e.preventDefault(); }
  if (e.key === " ") { shoot(); e.preventDefault(); }
});

// spin pad
const pad = $("spinPad"), dot = $("spinDot");
function setSpin(x, y) {
  const l = Math.hypot(x, y), m = 0.85; if (l > m) { x *= m / l; y *= m / l; }
  if (Math.hypot(x, y) < 0.08) { x = 0; y = 0; }
  spin = { x, y }; dot.setAttribute("cx", (x * 47).toFixed(1)); dot.setAttribute("cy", (-y * 47).toFixed(1));
  const v = y > 0.15 ? "Top" : y < -0.15 ? "Screw" : "", h = x > 0.15 ? "right" : x < -0.15 ? "left" : "";
  $("spinTxt").textContent = !v && !h ? "Centre" : v && h ? `${v} + ${h}` : v || (h === "right" ? "Right side" : "Left side");
}
let padDrag = false;
const padAt = e => { if (mode !== "aim") return; const r = pad.getBoundingClientRect(); setSpin(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1)); };
pad.addEventListener("pointerdown", e => { padDrag = true; try { pad.setPointerCapture(e.pointerId); } catch (_) {} padAt(e); });
pad.addEventListener("pointermove", e => { if (padDrag) padAt(e); });
["pointerup", "pointercancel"].forEach(ev => pad.addEventListener(ev, () => padDrag = false));
pad.addEventListener("dblclick", () => setSpin(0, 0));

// ---------------------------------------------------------------- HUD + messages
let toastTimer = 0, toastT = null;
function toast(text, foul) { const t = $("toast"); t.textContent = text; t.classList.toggle("foul", !!foul); t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3400); }
function hint(t) { $("hint").textContent = t; $("hint").hidden = !t; }
function hud() {
  if (!S) return;
  const g = S.game;
  for (let i = 0; i < 2; i++) {
    const el = $("p" + i);
    el.classList.toggle("on", S.turn === i && !S.over);
    el.querySelector(".nm").textContent = S.players[i].name;
    let sub = "";
    if (g === "snooker") {
      el.querySelector(".sc").textContent = S.scores[i];
      sub = S.turn === i && S.brk ? `Break ${S.brk}` : "";
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
  $("frames").textContent = match ? `${match.frames[0]} (${match.bestOf}) ${match.frames[1]}` : "";
  $("onTxt").textContent = S.over ? "Frame over" : `On: ${Rules.ballOnText(S)}`;
  if (g === "snooker") {
    const reds = S.balls.filter(b => b.on && Rules.def(g, b.id).kind === "red").length;
    $("leftTxt").textContent = `${reds} red${reds === 1 ? "" : "s"} · ${Rules.pointsLeft(S)} left`;
  } else $("leftTxt").textContent = S.isBreak ? "Break" : S.freeTable ? "Free table" : "";
  const me = S.players[S.turn];
  $("turnChip").textContent = S.over ? "" : me.type === "human" ? (S.players[1].type === "human" ? `${me.name} to play` : "Your shot") : `${me.name}`;
  $("turnChip").classList.toggle("me", me.type === "human");
  $("shoot").disabled = mode !== "aim";
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
      if (st.t > 0.62) strike(st.d);
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
      if (!W.moving() && !view.potAnimating()) endShot();
    } else if (mode === "between") {
      between -= dt; if (between <= 0) nextTurn();
    }
    // cue + guides
    const showCue = (mode === "aim" || mode === "cpuaim" || mode === "stroke") && c.on;
    let gap = T.R * 1.4;
    if (mode === "stroke") { const t = cpu.stroke.t; gap = t < 0.5 ? T.R * 1.4 + Math.sin(t / 0.5 * Math.PI / 2) * T.R * 6 : Math.max(0, T.R * 7.4 * (1 - (t - 0.5) / 0.12)); }
    const sp = mode === "cpuaim" || (mode === "stroke" && cpu.stroke.d !== undefined && S.players[S.turn].type === "cpu") ? { x: cpu.d ? cpu.d.sx : 0, y: cpu.d ? cpu.d.sy : 0 } : spin;
    view.setCue(showCue, c, mode === "stroke" ? cpu.stroke.d.angle : aim, sp, gap);
    const hit = mode === "aim" ? guides() : (view.setGuides(null), null);
    $("inset").hidden = mode !== "aim" || !c.on || viewMode === "top";
    if (!$("inset").hidden) drawOverlap(hit);
    // camera
    viewState.mode = mode === "place" ? "top" : mode === "run" ? (viewMode === "top" ? "top" : "follow") : viewMode;
    viewState.pitch = pitch; viewState.angle = mode === "run" ? follow.angle : (mode === "stroke" ? cpu.stroke.d.angle : aim);
    viewState.cue = mode === "run" ? { x: follow.eye.x + Math.cos(follow.angle) * (0.34 + pitch * 1.1), y: follow.eye.y + Math.sin(follow.angle) * (0.34 + pitch * 1.1) } : { x: c.x, y: c.y };
    viewState.track = follow && follow.track; viewState.eye = follow && follow.eye;
    view.sync(W, dt);
    view.updateCamera(viewState, dt);
    view.render();
    $("shoot").disabled = mode !== "aim";
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
buildMenu();
hint("");
try {
  view = new View(stage);
  // show a table behind the menu
  T = buildTable(cfg.game); view.build(T, cfg.game, STYLES[cfg.game]);
  S = Rules.createGame(cfg.game, players()); W = new World(T); W.setBalls(S.balls); view.resetBalls(S.balls);
  S.ballInHand = null; aim = 0; viewMode = "aim"; pitch = 0.55; mode = "idle";
  const c = W.ball(0); aim = Math.atan2(T.W / 2 - c.y, T.L * 0.75 - c.x);
} catch (e) { console.error(e); $("menu").querySelector("p").textContent = "Your browser couldn't start the 3D table."; }
hud();
requestAnimationFrame(frame);
window.__game = { get S() { return S; }, get W() { return W; }, get mode() { return mode; }, set aim(a) { aim = a; }, get aim() { return aim; }, set pitch(p) { pitch = p; }, shoot, cfg, endFrame: () => { S.over = { winner: 0, text: 'Test frame over.' }; nextTurn(); }, renderInfo: () => view.renderer.info.render };
