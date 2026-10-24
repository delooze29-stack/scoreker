// Computer player. Looks for pots, tries them out with the real physics to plan position,
// and plays safe when nothing is on. Runs as a generator so the screen keeps drawing.
import { World, summarise, SPECS } from "./physics.js";
import * as Rules from "./rules.js";

export const LEVELS = {
  easy:   { name: "Easy",   aim: 1.4,  power: 0.10, options: 2, spins: 1, safety: 0, position: 0.3 },
  medium: { name: "Medium", aim: 0.55, power: 0.05, options: 4, spins: 3, safety: 1, position: 0.8 },
  hard:   { name: "Hard",   aim: 0.22, power: 0.03, options: 6, spins: 5, safety: 2, position: 1 },
  pro:    { name: "Pro",    aim: 0.09, power: 0.015, options: 8, spins: 5, safety: 3, position: 1.2 },
};

const D2R = Math.PI / 180;
function erf(x) { // Abramowitz-Stegun
  const s = Math.sign(x); x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return s * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x));
}
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Is the straight path from (ax,ay) to (bx,by) clear of balls (other than those in skip)?
function clear(balls, ax, ay, bx, by, skip, gap) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  for (const b of balls) {
    if (!b.on || skip.includes(b.id)) continue;
    let t = ((b.x - ax) * dx + (b.y - ay) * dy) / (l2 || 1); t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (Math.hypot(ax + dx * t - b.x, ay + dy * t - b.y) < gap) return false;
  }
  return true;
}

// Every direct pot available to the player from the cue ball position, best first.
export function potOptions(table, s, sigmaDeg, cuePos) {
  const R = table.R, balls = s.balls, cue = cuePos || Rules.ballOf(s, 0);
  if (!cue || (!cue.on && !cuePos)) return [];
  const want = new Set(Rules.wantPot(s)), legal = new Set(Rules.legalFirst(s));
  const sig = sigmaDeg * D2R, out = [];
  for (const b of balls) {
    if (!b.on || !want.has(b.id) || !legal.has(b.id)) continue;
    for (const p of table.pockets) {
      const ax = p.aim.x, ay = p.aim.y, ox = ax - b.x, oy = ay - b.y, d2 = Math.hypot(ox, oy);
      if (d2 < 1e-6) continue;
      const ux = ox / d2, uy = oy / d2;
      const appr = Math.acos(Math.max(-1, Math.min(1, ux * p.o.x + uy * p.o.y)));
      if (appr > (p.kind === "corner" ? 55 : 38) * D2R) continue;
      const gx = b.x - ux * 2 * R, gy = b.y - uy * 2 * R;
      const cx = gx - cue.x, cy = gy - cue.y, d1 = Math.hypot(cx, cy);
      if (d1 < 0.5 * R) continue;
      const cut = Math.acos(Math.max(-1, Math.min(1, (cx * ux + cy * uy) / d1)));
      if (cut > 80 * D2R) continue;
      if (gx < R * 0.9 || gy < R * 0.9 || gx > table.L - R * 0.9 || gy > table.W - R * 0.9) continue;
      if (!clear(balls, cue.x, cue.y, gx, gy, [0, b.id], 2 * R - 0.001)) continue;
      if (!clear(balls, b.x, b.y, ax, ay, [0, b.id], 2 * R - 0.001)) continue;
      const open = p.kind === "corner" ? (p.mouth / 2) * Math.cos(appr) - R * 0.55 : (p.mouth / 2) * Math.pow(Math.cos(appr), 2.5) - R * 0.5;
      const tolOb = Math.max(0.0015, open) / Math.max(d2, 0.05);
      let tolCue = 0.8 * tolOb * 2 * R * Math.max(Math.cos(cut), 0.12) / Math.max(d1, 0.05);
      if (cut > 60 * D2R) tolCue *= 0.45;
      let prob = erf(tolCue / (sig * Math.SQRT2));
      out.push({ ball: b.id, pocket: p.id, angle: Math.atan2(cy, cx), cut, d1, d2, prob, ux, uy });
    }
  }
  return out.sort((a, b) => b.prob - a.prob);
}

// How good is the best pot for `player` in state s (0..1)?
function bestProb(table, s, player, sigmaDeg) {
  const t = { ...s, turn: player };
  if (s.ballInHand && s.turn === player) return 0.85;
  const opts = potOptions(table, t, sigmaDeg);
  if (!opts.length) return 0;
  if (s.game === "snooker") {
    let best = 0;
    for (const o of opts.slice(0, 8)) best = Math.max(best, o.prob * (0.75 + Rules.def("snooker", o.ball).value / 28));
    return Math.min(1, best);
  }
  return opts[0].prob;
}

function score(table, s, res, me, lv) {
  const s2 = res.state, info = res.info, opp = 1 - me;
  if (s2.over) return s2.over.winner === me ? 10000 : -10000;
  let sc = 0;
  if (s.game === "snooker") {
    sc += ((s2.scores[me] - s.scores[me]) - (s2.scores[opp] - s.scores[opp])) * 14;
  } else if (s.game === "nine") {
    const left = st => st.balls.filter(b => b.on && b.id).length;
    sc += (left(s) - left(s2)) * 25;
  } else {
    const mineLeft = st => { const g = st.groups[me]; return g ? st.balls.filter(b => b.on && b.id && Rules.def(st.game, b.id).kind === g).length : 7; };
    sc += (mineLeft(s) - mineLeft(s2)) * 30;
  }
  if (s2.turn === me && !info.foul) {
    sc += 70 + 260 * lv.position * bestProb(table, s2, me, lv.aim);
  } else {
    sc -= 40 + 240 * bestProb(table, s2, opp, 0.5);
    if (s2.ballInHand && s2.turn === opp) sc -= s.game === "snooker" ? 60 : 160;
    if (info.foul) sc -= 60;
    if (s.game === "uk" && s2.visits === 2 && s2.turn === opp) sc -= 120;
  }
  return sc;
}

function trial(table, s, angle, speed, sx, sy) {
  const w = new World(table);
  w.setBalls(s.balls);
  w.strike(0, angle, speed, sx, sy);
  w.runToRest(30, true);
  const sum = summarise(w.events);
  const t = Rules.clone(s);
  t.balls = w.balls.map(b => ({ id: b.id, x: b.x, y: b.y, on: b.on }));
  return { sum, res: Rules.resolve(t, sum) };
}

// Throw (friction between the balls) pushes the object ball off the ghost-ball line, so adjust the aim
// until the object ball sets off where we want it.
function objDir(table, s, ballId, angle, speed, sx, sy) {
  const w = new World(table); w.setBalls(s.balls); w.strike(0, angle, speed, sx, sy);
  for (let i = 0; i < 300; i++) {
    w.advance(0.02, true);
    const h = w.events.find(e => e.t === "hit" && (e.a === 0 || e.b === 0));
    if (h) { const o = w.ball(h.a === 0 ? h.b : h.a); return o.id === ballId ? Math.atan2(o.vy, o.vx) : null; }
    if (!w.moving()) return null;
  }
  return null;
}
function correctAim(table, s, o, speed, sx, sy) {
  const want = Math.atan2(o.uy, o.ux), wrap = x => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
  let a = o.angle;
  for (let it = 0; it < 2; it++) {
    const d0 = objDir(table, s, o.ball, a, speed, sx, sy); if (d0 === null) return a;
    const err = wrap(want - d0); if (Math.abs(err) < 0.0004) return a;
    const eps = 0.0015, d1 = objDir(table, s, o.ball, a + eps, speed, sx, sy); if (d1 === null) return a;
    const slope = wrap(d1 - d0) / eps; if (Math.abs(slope) < 0.05) return a;
    const step = Math.max(-0.02, Math.min(0.02, err / slope));
    a += step;
  }
  return a;
}

function potSpeed(table, o) {
  const aR = table.spec.mu.roll * 9.81;
  const vOb = Math.sqrt(2 * aR * o.d2 * 1.4) + 0.35;
  return Math.min(table.spec.vmax * 0.9, Math.sqrt(Math.pow(vOb / (Math.max(Math.cos(o.cut), 0.25) * 0.97), 2) + 2 * aR * o.d1 * 2.5));
}

// ---------------------------------------------------------------- ball in hand
function placeCue(table, s, lv) {
  const R = table.R, z = Rules.zoneOf(s), cands = [];
  const tryAt = (x, y) => { if (Rules.validPlacement(s, x, y)) cands.push({ x, y }); };
  if (z.type === "D") { for (let a = -90; a <= 90; a += 12) for (const r of [0.06, 0.14, 0.22, 0.28]) tryAt(z.x - Math.cos(a * D2R) * r, z.y + Math.sin(a * D2R) * r); }
  else {
    const maxX = z.type === "baulk" ? z.x : table.L;
    for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) tryAt(R + (maxX - 2 * R) * (i + 0.5) / 10, R + (table.W - 2 * R) * (j + 0.5) / 6);
    if (z.type === "any") { // also try spots that line up straight-ish pots
      const t = { ...s, ballInHand: null };
      for (const id of Rules.wantPot(t)) {
        const b = Rules.ballOf(s, id);
        for (const p of table.pockets) {
          const ux = p.aim.x - b.x, uy = p.aim.y - b.y, l = Math.hypot(ux, uy);
          for (const back of [0.18, 0.35]) for (const off of [-0.25, 0, 0.25]) {
            const ang = Math.atan2(uy, ux) + off;
            tryAt(b.x - Math.cos(ang) * (back + 2 * R), b.y - Math.sin(ang) * (back + 2 * R));
          }
        }
      }
    }
  }
  let best = null;
  for (const c of cands) {
    const t = Rules.clone(s); Rules.placeCue(t, c.x, c.y);
    const opts = potOptions(table, t, lv.aim);
    const sc = opts.length ? opts[0].prob + 0.1 * Math.min(1, opts.length / 5) : -Math.hypot(c.x - table.L / 2, c.y - table.W / 2) * 0.01;
    if (!best || sc > best.sc) best = { ...c, sc };
  }
  return best || { x: z.x ? z.x - 0.05 : table.L * 0.2, y: table.W / 2 };
}

// ---------------------------------------------------------------- main
export function* think(table, s0, levelId) {
  const lv = LEVELS[levelId] || LEVELS.medium, me = s0.turn;
  let s = s0, place = null;
  if (s.ballInHand) {
    if (s.isBreak) {
      const m = Rules.marks(s.game);
      place = s.game === "snooker" ? { x: m.D.x, y: m.D.y - 0.17 } : { x: m.baulk - 0.06, y: table.W / 2 + (Math.random() - 0.5) * 0.15 };
    } else place = placeCue(table, s, lv);
    s = Rules.clone(s); Rules.placeCue(s, place.x, place.y);
    yield;
  }
  const cue = Rules.ballOf(s, 0);
  let best = null;
  const consider = c => { if (!best || c.score > best.score) best = c; };

  // the break
  if (s.isBreak && s.game !== "snooker") {
    const apex = s.balls.filter(b => b.on && b.id).sort((a, b) => a.x - b.x)[0];
    const ang = Math.atan2(apex.y - cue.y, apex.x - cue.x);
    return finish(table, { place, angle: ang, speed: table.spec.vmax * 0.97, sx: 0, sy: 0.15, label: "break" }, lv, true);
  }
  if (s.isBreak && s.game === "snooker") {
    const reds = s.balls.filter(b => b.on && Rules.def("snooker", b.id).kind === "red");
    const back = reds.sort((a, b) => b.x - a.x).slice(0, 5).sort((a, b) => a.y - b.y);
    const targets = [back[0], back[1]]; // the right-hand end of the back row (y small = right)
    for (const t of targets) for (const f of [-0.92, 0.84, 0.92]) for (const sp of [0.6, 0.72]) for (const side of [0.6, 0.9]) {
      const d = Math.hypot(t.x - cue.x, t.y - cue.y), base = Math.atan2(t.y - cue.y, t.x - cue.x);
      const ang = base - Math.asin(Math.min(0.99, f * 2 * table.R / d));
      const { res } = trial(table, s, ang, table.spec.vmax * sp, side, 0);
      const c = Rules.ballOf(res.state, 0);
      consider({ angle: ang, speed: table.spec.vmax * sp, sx: side, sy: 0, score: score(table, s, res, me, lv) - (c.on ? c.x : 3) * 30, label: "break" });
      yield;
    }
    return finish(table, { place, ...best }, lv);
  }

  // 1) pots
  const opts = potOptions(table, s, lv.aim).slice(0, lv.options);
  const spinSets = [[0, 0], [0, 0.7], [0, -0.75], [0.6, 0.3], [-0.6, 0.3]].slice(0, lv.spins);
  const missScore = s.game === "snooker" ? -110 : -150;
  for (const o of opts) {
    const v0 = potSpeed(table, o);
    if (lv.aim < 1) o.angle = correctAim(table, s, o, Math.min(table.spec.vmax * 0.95, v0 * 1.3), 0, 0);
    for (const k of lv.spins === 1 ? [1.1] : [0.95, 1.35, 1.9]) for (const [sx, sy] of spinSets) {
      const speed = Math.min(table.spec.vmax * 0.95, v0 * k);
      const { sum, res } = trial(table, s, o.angle, speed, sx, sy);
      const made = sum.pots.includes(o.ball) && !res.info.foul;
      const sc = score(table, s, res, me, lv);
      const ev = made ? o.prob * sc + (1 - o.prob) * missScore : 0.4 * sc + 0.6 * missScore;
      consider({ angle: o.angle, speed, sx, sy, score: ev, label: `pot ${o.ball}`, prob: o.prob });
    }
    yield;
  }

  // 2) safeties (and escapes from snookers)
  if (lv.safety > 0 && (!best || best.score < 120 || best.prob < 0.55)) {
    const legal = Rules.legalFirst(s).map(id => Rules.ballOf(s, id))
      .sort((a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y));
    const nT = [0, 3, 5, 7][lv.safety], fr = lv.safety > 1 ? [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9] : [-0.7, 0, 0.7];
    const speeds = s.game === "snooker" ? [0.16, 0.3, 0.48] : [0.2, 0.34, 0.55];
    let direct = 0;
    for (const t of legal.slice(0, nT)) {
      const d = Math.hypot(t.x - cue.x, t.y - cue.y), base = Math.atan2(t.y - cue.y, t.x - cue.x);
      if (!clear(s.balls, cue.x, cue.y, t.x, t.y, [0, t.id], 2 * table.R - 0.002)) continue;
      direct++;
      for (const f of fr) for (const k of speeds) {
        const ang = base - Math.asin(Math.max(-0.99, Math.min(0.99, f * 2 * table.R / d)));
        const { res } = trial(table, s, ang, table.spec.vmax * k, 0, -0.2);
        consider({ angle: ang, speed: table.spec.vmax * k, sx: 0, sy: -0.2, score: score(table, s, res, me, lv) - 5, label: "safety" });
      }
      yield;
    }
    if (!direct || lv.safety >= 2) { // escapes off cushions
      const n = direct ? 24 : 72;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        for (const k of [0.3, 0.5]) {
          const { res } = trial(table, s, ang, table.spec.vmax * k, 0, 0);
          consider({ angle: ang, speed: table.spec.vmax * k, sx: 0, sy: 0, score: score(table, s, res, me, lv) - 10, label: "escape" });
        }
        if (i % 6 === 5) yield;
      }
    }
  }
  if (!best) { // nothing found: look for any legal contact off the cushions
    for (let i = 0; i < 36; i++) {
      const ang = (i / 36) * Math.PI * 2;
      const { res } = trial(table, s, ang, table.spec.vmax * 0.42, 0, 0);
      consider({ angle: ang, speed: table.spec.vmax * 0.42, sx: 0, sy: 0, score: score(table, s, res, me, lv) - 10, label: "escape" });
      if (i % 6 === 5) yield;
    }
  }
  if (!best) { // nothing sensible found: hit the nearest legal ball firmly
    const t = Rules.legalFirst(s).map(id => Rules.ballOf(s, id))[0];
    best = { angle: t ? Math.atan2(t.y - cue.y, t.x - cue.x) : 0, speed: table.spec.vmax * 0.4, sx: 0, sy: 0, label: "hope" };
  }
  return finish(table, { place, ...best }, lv);
}

function finish(table, d, lv, isBreak) {
  const aimErr = gauss() * lv.aim * D2R * (isBreak ? 2 : 1);
  return { ...d, angle: d.angle + aimErr, speed: Math.min(table.spec.vmax, d.speed * (1 + gauss() * lv.power)), plannedAngle: d.angle };
}

// Run the generator to completion (for tests).
export function decide(table, s, level) { const g = think(table, s, level); let r; do { r = g.next(); } while (!r.done); return r.value; }
