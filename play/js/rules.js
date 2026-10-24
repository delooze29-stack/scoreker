// Rules for snooker, UK 8-ball (pub "two shot" rules) and US 8-ball (simplified WPA).
// The state is plain data so the computer player can copy it and try shots out.
import { SPECS } from "./physics.js";

const SQ3 = Math.sqrt(3);

// ---------------------------------------------------------------- ball sets
const SNOOKER_COLOURS = [
  { value: 2, name: "yellow", color: "#f2c200" }, { value: 3, name: "green", color: "#13843f" },
  { value: 4, name: "brown", color: "#7a4a22" }, { value: 5, name: "blue", color: "#1f52c4" },
  { value: 6, name: "pink", color: "#f08cb4" }, { value: 7, name: "black", color: "#111111" },
];
const US_COLORS = { 1: "#f2b705", 2: "#1d3fae", 3: "#d0261d", 4: "#5b2a86", 5: "#f06a15", 6: "#126b3a", 7: "#7a1f1a", 8: "#111111" };

const DEFS = {};
function defsFor(game) {
  if (DEFS[game]) return DEFS[game];
  const d = [{ id: 0, kind: "cue", name: "cue ball", color: "#f6f3ea" }];
  if (game === "snooker") {
    for (let i = 1; i <= 15; i++) d.push({ id: i, kind: "red", value: 1, name: "red", color: "#b3121c" });
    SNOOKER_COLOURS.forEach((c, i) => d.push({ id: 16 + i, kind: "colour", ...c }));
  } else if (game === "uk") {
    for (let i = 1; i <= 7; i++) d.push({ id: i, kind: "red", name: "red", color: "#c8141c" });
    for (let i = 8; i <= 14; i++) d.push({ id: i, kind: "yellow", name: "yellow", color: "#f2c200" });
    d.push({ id: 15, kind: "black", name: "black", color: "#111111", num: 8 });
  } else if (game === "nine") {
    for (let n = 1; n <= 9; n++) d.push({ id: n, kind: n === 9 ? "stripe" : "solid", num: n, name: `${n}-ball`, color: US_COLORS[n > 8 ? n - 8 : n] });
  } else {
    for (let n = 1; n <= 15; n++) {
      const kind = n === 8 ? "eight" : n < 8 ? "solid" : "stripe";
      d.push({ id: n, kind, num: n, name: n === 8 ? "8-ball" : `${n}-ball`, color: US_COLORS[n > 8 ? n - 8 : n] });
    }
  }
  return (DEFS[game] = d);
}
export const defs = defsFor;
export const def = (game, id) => defsFor(game)[id];

// ---------------------------------------------------------------- table marks
export function marks(game) {
  const S = SPECS[game], L = S.L, W = S.W;
  if (game === "snooker") {
    const bx = 0.737, dR = 0.292;
    return { baulk: bx, D: { x: bx, y: W / 2, r: dR },
      spots: { 2: { x: bx, y: W / 2 - dR }, 3: { x: bx, y: W / 2 + dR }, 4: { x: bx, y: W / 2 },
        5: { x: L / 2, y: W / 2 }, 6: { x: L * 0.75, y: W / 2 }, 7: { x: L - 0.324, y: W / 2 } } };
  }
  return { baulk: game === "uk" ? L * 0.2 : L * 0.25, foot: { x: L * 0.75, y: W / 2 } };
}

function rack(game) {
  const S = SPECS[game], R = S.R, W = S.W, L = S.L, g = 0.00005;
  const out = [];
  // racks are never perfect: tiny random gaps make the pack break up the way a real one does
  const jit = () => (Math.random() - 0.5) * 0.0004;
  const at = (apexX, k, j) => ({ x: apexX + k * (SQ3 * R + g + 0.0004) + jit(), y: W / 2 + (j - k / 2) * (2 * R + g + 0.0004) + jit() });
  if (game === "snooker") {
    const m = marks(game), apex = m.spots[6].x + 2 * R + 0.003;
    let id = 1;
    for (let k = 0; k < 5; k++) for (let j = 0; j <= k; j++) out.push({ id: id++, ...at(apex, k, j) });
    SNOOKER_COLOURS.forEach((c, i) => out.push({ id: 16 + i, ...m.spots[c.value] }));
    out.push({ id: 0, x: m.D.x - 0.05, y: W / 2 - 0.12 });
  } else if (game === "uk") {
    // R=red Y=yellow B=black, apex on the foot spot
    const pattern = ["R", "YR", "RBY", "YRYR", "RYYRY"];
    const next = { R: 1, Y: 8 };
    pattern.forEach((row, k) => [...row].forEach((c, j) => {
      const id = c === "B" ? 15 : next[c]++;
      out.push({ id, ...at(L * 0.75, k, j) });
    }));
    out.push({ id: 0, x: L * 0.2 - 0.08, y: W / 2 + 0.05 });
  } else if (game === "nine") { // diamond: 1 at the front, 9 in the middle, the rest shuffled
    const rest = [2, 3, 4, 5, 6, 7, 8].sort(() => Math.random() - 0.5);
    const pattern = [[1], [rest[0], rest[1]], [rest[2], 9, rest[3]], [rest[4], rest[5]], [rest[6]]];
    pattern.forEach((row, k) => row.forEach((id, j) => {
      const width = k <= 2 ? k : 4 - k; // rows 1,2,3,2,1
      out.push({ id, x: L * 0.75 + k * (SQ3 * R + g + 0.0004) + jit(), y: W / 2 + (j - width / 2) * (2 * R + g + 0.0004) + jit() });
    }));
    out.push({ id: 0, x: L * 0.25 - 0.1, y: W / 2 });
  } else {
    const pattern = [[1], [9, 2], [10, 8, 3], [11, 4, 12, 5], [6, 13, 7, 14, 15]];
    pattern.forEach((row, k) => row.forEach((id, j) => out.push({ id, ...at(L * 0.75, k, j) })));
    out.push({ id: 0, x: L * 0.25 - 0.1, y: W / 2 });
  }
  return out.map(b => ({ ...b, on: true })).sort((a, b) => a.id - b.id);
}

// ---------------------------------------------------------------- state
export function createGame(game, players, opts = {}) {
  const s = {
    game, players, turn: opts.first ?? 0, scores: [0, 0], frames: opts.frames || [0, 0], bestOf: opts.bestOf || 1,
    balls: rack(game), isBreak: true, over: null, lastText: "", shots: 0,
    ballInHand: { zone: game === "snooker" ? "D" : "baulk" },
  };
  if (game === "snooker") Object.assign(s, { ballOn: "red", brk: 0, high: [0, 0] });
  else if (game === "nine") Object.assign(s, { groups: [null, null], visits: 1, freeTable: false });
  else Object.assign(s, { groups: [null, null], visits: 1, freeTable: false });
  return s;
}
export const clone = s => JSON.parse(JSON.stringify(s));
export const ballOf = (s, id) => s.balls.find(b => b.id === id);
const onTable = (s, pred) => s.balls.filter(b => b.on && b.id !== 0 && pred(def(s.game, b.id)));
const nameOf = (s, i) => s.players[i].name;
const vb = (s, i, he, you) => (s.players[i].name === "You" ? you : he);

// ---------------------------------------------------------------- placement (ball in hand)
export function zoneOf(s) {
  if (!s.ballInHand) return null;
  const m = marks(s.game), S = SPECS[s.game];
  if (s.ballInHand.zone === "D") return { type: "D", ...m.D };
  if (s.ballInHand.zone === "baulk") return { type: "baulk", x: m.baulk };
  return { type: "any" };
}
export function validPlacement(s, x, y) {
  const S = SPECS[s.game], R = S.R, z = zoneOf(s);
  if (x < R || y < R || x > S.L - R || y > S.W - R) return false;
  if (z.type === "D" && (x > z.x || Math.hypot(x - z.x, y - z.y) > z.r)) return false;
  if (z.type === "baulk" && x > z.x) return false;
  return s.balls.every(b => !b.on || b.id === 0 || Math.hypot(b.x - x, b.y - y) > 2 * R + 0.0005);
}
export function placeCue(s, x, y) { const c = ballOf(s, 0); c.x = x; c.y = y; c.on = true; s.ballInHand = null; }

// ---------------------------------------------------------------- what may be hit / potted
// Balls the striker may legally hit first.
const lowest = s => { const on = s.balls.filter(b => b.on && b.id); return on.length ? Math.min(...on.map(b => b.id)) : null; };
export function legalFirst(s) {
  const g = s.game;
  if (g === "nine") { const l = lowest(s); return l ? [l] : []; }
  if (g === "snooker") {
    if (s.ballOn === "red") return onTable(s, d => d.kind === "red").map(b => b.id);
    if (s.ballOn === "colour") return onTable(s, d => d.kind === "colour").map(b => b.id);
    return onTable(s, d => d.value === s.ballOn && d.kind === "colour").map(b => b.id);
  }
  const me = s.turn, grp = s.groups[me];
  const blackKind = g === "uk" ? "black" : "eight";
  if (s.freeTable) return onTable(s, () => true).map(b => b.id);
  if (!grp) return onTable(s, d => d.kind !== blackKind).map(b => b.id);
  const mine = onTable(s, d => d.kind === grp);
  return (mine.length ? mine : onTable(s, d => d.kind === blackKind)).map(b => b.id);
}
// Balls the striker wants to pot this shot.
export function wantPot(s) {
  const g = s.game;
  if (g === "nine") return s.balls.filter(b => b.on && b.id).map(b => b.id);
  if (g === "snooker") return legalFirst(s);
  const grp = s.groups[s.turn], blackKind = g === "uk" ? "black" : "eight";
  if (!grp) return onTable(s, d => d.kind !== blackKind).map(b => b.id);
  const mine = onTable(s, d => d.kind === grp);
  return (mine.length ? mine : onTable(s, d => d.kind === blackKind)).map(b => b.id);
}
export function ballOnText(s) {
  if (s.game === "nine") { const l = lowest(s); return l ? `the ${l}` : "—"; }
  if (s.game === "snooker") {
    if (s.ballOn === "red") return "red";
    if (s.ballOn === "colour") return "a colour";
    return SNOOKER_COLOURS.find(c => c.value === s.ballOn).name;
  }
  const grp = s.groups[s.turn];
  if (!grp) return "open table";
  const left = onTable(s, d => d.kind === grp).length;
  return left ? `${grp}s (${left} left)` : (s.game === "uk" ? "the black" : "the 8-ball");
}
export function pointsLeft(s) {
  const reds = onTable(s, d => d.kind === "red").length;
  const colours = onTable(s, d => d.kind === "colour").map(b => def(s.game, b.id).value);
  if (reds) return reds * 8 + 27 + (s.ballOn === "colour" ? 7 : 0);
  return colours.reduce((a, v) => a + v, 0);
}

// ---------------------------------------------------------------- resolve a shot
// sum: {first, pots:[ids], cushionAfterHit}; s.balls must already hold the final positions.
export function resolve(s0, sum) {
  const s = clone(s0);
  s.shots++;
  const info = s.game === "snooker" ? resolveSnooker(s, sum) : s.game === "nine" ? resolveNine(s, sum) : resolvePool(s, sum);
  s.isBreak = false;
  s.lastText = info.text;
  return { state: s, info };
}

function freeSpot(s, x, y) { const R = SPECS[s.game].R; return s.balls.every(b => !b.on || Math.hypot(b.x - x, b.y - y) > 2 * R + 0.0005); }

function respotSnooker(s, ids) {
  const m = marks("snooker"), S = SPECS.snooker;
  ids.sort((a, b) => def("snooker", b).value - def("snooker", a).value).forEach(id => {
    const b = ballOf(s, id), v = def("snooker", id).value;
    const order = [v, 7, 6, 5, 4, 3, 2];
    for (const k of order) { const p = m.spots[k]; if (freeSpot(s, p.x, p.y)) { Object.assign(b, { x: p.x, y: p.y, on: true }); return; } }
    const p = m.spots[v];
    for (let dx = 0.002; dx < S.L; dx += 0.002) {
      if (p.x + dx < S.L - S.R && freeSpot(s, p.x + dx, p.y)) { Object.assign(b, { x: p.x + dx, y: p.y, on: true }); return; }
      if (p.x - dx > S.R && freeSpot(s, p.x - dx, p.y)) { Object.assign(b, { x: p.x - dx, y: p.y, on: true }); return; }
    }
  });
}
function lowestColour(s) {
  const vals = onTable(s, d => d.kind === "colour").map(b => def(s.game, b.id).value);
  return vals.length ? Math.min(...vals) : null;
}

function resolveSnooker(s, sum) {
  const me = s.turn, opp = 1 - me, d = id => def("snooker", id);
  const on = s.ballOn, first = sum.first, pots = sum.pots;
  const isRed = id => d(id).kind === "red";
  const onVal = typeof on === "number" ? on : on === "red" ? 1 : (first && !isRed(first) ? d(first).value : 4);
  let foul = null, val = Math.max(4, onVal);
  const bump = v => { val = Math.max(val, v); };
  if (first === null) foul = "missed every ball";
  else if (on === "red" && !isRed(first)) { foul = `hit the ${d(first).name} first`; bump(d(first).value); }
  else if (on === "colour" && isRed(first)) foul = "hit a red when on a colour";
  else if (typeof on === "number" && d(first).value !== on) { foul = `hit the ${d(first).name} instead of the ${d(colourId(on)).name}`; bump(d(first).value); }
  for (const id of pots) {
    if (id === 0) { foul = foul || "in-off"; continue; }
    const dd = d(id);
    if (on === "red" && !isRed(id)) { foul = foul || `potted the ${dd.name}`; bump(dd.value); }
    else if (on === "colour" && (isRed(id) || id !== first)) { foul = foul || `potted the ${dd.name}`; bump(dd.value); }
    else if (typeof on === "number" && dd.value !== on) { foul = foul || `potted the ${dd.name}`; bump(dd.value); }
  }
  const pottedColours = pots.filter(id => id !== 0 && !isRed(id));
  const redsLeft = () => onTable(s, x => x.kind === "red").length;
  const cuePotted = pots.includes(0);
  let text;

  if (foul) {
    s.scores[opp] += val;
    respotSnooker(s, pottedColours);
    s.brk = 0; s.turn = opp;
    s.ballOn = redsLeft() ? "red" : lowestColour(s);
    if (cuePotted) { s.ballInHand = { zone: "D" }; ballOf(s, 0).on = false; }
    text = `Foul: ${nameOf(s, me)} ${foul}. ${val} points to ${nameOf(s, opp)}.`;
    if (on === 7 && onTable(s, x => x.kind === "colour").length <= 1 && !redsLeft()) endSnooker(s, me, true);
    return { foul, foulVal: val, text, potted: pots, keep: false };
  }
  let pts = 0;
  for (const id of pots) pts += d(id).value;
  if (pts > 0) {
    s.scores[me] += pts; s.brk += pts; s.high[me] = Math.max(s.high[me], s.brk);
    const names = pots.map(id => d(id).name);
    text = `${nameOf(s, me)} potted ${names.length > 1 ? `${names.length} reds` : `the ${names[0]}`}. Break ${s.brk}.`;
    if (on === "red") s.ballOn = "colour";
    else if (on === "colour") { respotSnooker(s, pottedColours); s.ballOn = redsLeft() ? "red" : 2; }
    else if (on === 7) { endSnooker(s, me, false); return { foul: null, text: s.over ? s.over.text : text, potted: pots, keep: !s.over, points: pts }; }
    else s.ballOn = on + 1;
    return { foul: null, text, potted: pots, keep: true, points: pts };
  }
  s.brk = 0; s.turn = opp;
  s.ballOn = redsLeft() ? "red" : lowestColour(s);
  text = `${nameOf(s, me)} missed. ${nameOf(s, opp)} to play.`;
  return { foul: null, text, potted: [], keep: false };
}
const colourId = v => 14 + v; // yellow (2) is id 16

function endSnooker(s, lastStriker, afterFoul) {
  const [a, b] = s.scores;
  if (a === b) { // re-spotted black decides it
    const blk = ballOf(s, colourId(7)); const p = marks("snooker").spots[7];
    Object.assign(blk, { x: p.x, y: p.y, on: true });
    s.ballOn = 7; s.turn = 1 - lastStriker; s.brk = 0;
    s.ballInHand = { zone: "D" }; ballOf(s, 0).on = false;
    s.respotBlack = true;
    return;
  }
  const w = a > b ? 0 : 1;
  s.over = { winner: w, text: `${nameOf(s, w)} ${vb(s, w, "wins", "win")} the frame ${Math.max(a, b)}–${Math.min(a, b)}.` };
}

function resolvePool(s, sum) {
  const g = s.game, me = s.turn, opp = 1 - me, d = id => def(g, id);
  const blackKind = g === "uk" ? "black" : "eight", blackName = g === "uk" ? "black" : "8-ball";
  const first = sum.first, pots = sum.pots, grp = s.groups[me];
  const legal = new Set(legalFirst({ ...s, balls: s.balls.map(b => ({ ...b, on: b.on || pots.includes(b.id) })) }));
  const ownBefore = grp ? s.balls.filter(b => b.id && d(b.id).kind === grp && (b.on || pots.includes(b.id))).length : 1;
  const onBlack = !!grp && ownBefore === 0;
  let foul = null;
  if (first === null) foul = "missed every ball";
  else if (!legal.has(first)) foul = `hit the ${d(first).kind === blackKind ? blackName : d(first).name} first`;
  if (pots.includes(0)) foul = foul || "potted the cue ball";
  if (grp && pots.some(id => id && d(id).kind !== grp && d(id).kind !== blackKind)) foul = foul || "potted an opponent's ball";
  if (g === "us" && !foul && !pots.length && !sum.cushionAfterHit && !s.isBreak) foul = "didn't send a ball to a cushion";
  const blackDown = pots.some(id => id && d(id).kind === blackKind);
  let text;

  if (blackDown) {
    const blk = s.balls.find(b => b.id && d(b.id).kind === blackKind);
    if (s.isBreak) { // black on the break goes back on its spot
      const f = marks(g).foot; let x = f.x;
      while (!freeSpot(s, x, f.y)) x += 0.002;
      Object.assign(blk, { x, y: f.y, on: true });
    } else if (onBlack && !foul) {
      s.over = { winner: me, text: `${nameOf(s, me)} potted the ${blackName} and ${vb(s, me, "wins", "win")} the frame.` };
      return { foul: null, text: s.over.text, potted: pots, keep: false };
    } else {
      s.over = { winner: opp, text: `${nameOf(s, me)} ${onBlack ? "fouled while potting" : "potted"} the ${blackName} too early. ${nameOf(s, opp)} ${vb(s, opp, "wins", "win")} the frame.` };
      return { foul: foul || "early black", text: s.over.text, potted: pots, keep: false };
    }
  }
  if (foul) {
    s.turn = opp;
    if (g === "uk") { s.visits = 2; s.freeTable = true; if (pots.includes(0)) { s.ballInHand = { zone: "baulk" }; ballOf(s, 0).on = false; } }
    else { s.visits = 1; s.freeTable = false; s.ballInHand = { zone: "any" }; ballOf(s, 0).on = false; }
    text = `Foul: ${nameOf(s, me)} ${foul}. ${nameOf(s, opp)} ${vb(s, opp, "has", "have")} ${g === "uk" ? "two shots" : "ball in hand"}.`;
    return { foul, text, potted: pots, keep: false };
  }
  const colourPots = pots.filter(id => id && d(id).kind !== blackKind);
  if (!grp && colourPots.length) {
    const k = d(colourPots[0]).kind, other = g === "uk" ? (k === "red" ? "yellow" : "red") : (k === "solid" ? "stripe" : "solid");
    s.groups[me] = k; s.groups[opp] = other;
  }
  const mine = s.groups[me];
  const ownPots = mine ? colourPots.filter(id => d(id).kind === mine) : [];
  s.freeTable = false;
  if (ownPots.length) {
    text = `${nameOf(s, me)} potted ${ownPots.length > 1 ? `${ownPots.length} ${mine}s` : `a ${mine}`}${!grp ? ` and ${vb(s, me, "takes", "take")} ${mine}s` : ""}.`;
    return { foul: null, text, potted: pots, keep: true };
  }
  if (s.visits > 1) { s.visits--; text = `${nameOf(s, me)} missed but ${vb(s, me, "has", "have")} another shot.`; return { foul: null, text, potted: pots, keep: true }; }
  s.turn = opp; s.visits = 1;
  text = `${nameOf(s, me)} missed. ${nameOf(s, opp)} to play.`;
  return { foul: null, text, potted: pots, keep: false };
}

// 9-ball: hit the lowest ball first; anything potted on a legal shot keeps you at the table;
// pot the 9 legally (even in a combination) to win. Any foul gives ball in hand anywhere.
function resolveNine(s, sum) {
  const me = s.turn, opp = 1 - me, first = sum.first, pots = sum.pots;
  const before = s.balls.filter(b => b.id && (b.on || pots.includes(b.id))).map(b => b.id);
  const low = before.length ? Math.min(...before) : null;
  let foul = null;
  if (first === null) foul = "missed every ball";
  else if (first !== low) foul = `hit the ${first} first instead of the ${low}`;
  if (pots.includes(0)) foul = foul || "potted the cue ball";
  if (!foul && !pots.length && !sum.cushionAfterHit && !s.isBreak) foul = "didn't send a ball to a cushion";
  const nineDown = pots.includes(9);
  if (nineDown && !foul) {
    s.over = { winner: me, text: `${nameOf(s, me)} potted the 9 and ${vb(s, me, "wins", "win")} the rack.` };
    return { foul: null, text: s.over.text, potted: pots, keep: false };
  }
  if (nineDown) { // a foul brings the 9 back to its spot
    const f = marks(s.game).foot; let x = f.x; while (!freeSpot(s, x, f.y)) x += 0.002;
    Object.assign(ballOf(s, 9), { x, y: f.y, on: true });
  }
  if (foul) {
    s.turn = opp; s.ballInHand = { zone: "any" }; ballOf(s, 0).on = false;
    return { foul, text: `Foul: ${nameOf(s, me)} ${foul}. ${nameOf(s, opp)} ${vb(s, opp, "has", "have")} ball in hand.`, potted: pots, keep: false };
  }
  const real = pots.filter(id => id);
  if (real.length) return { foul: null, text: `${nameOf(s, me)} potted the ${real.join(" and the ")}.`, potted: pots, keep: true };
  s.turn = opp;
  return { foul: null, text: `${nameOf(s, me)} missed. ${nameOf(s, opp)} to play.`, potted: [], keep: false };
}

// Short status for the scoreboard.
export function shotsLeft(s, player) {
  if (s.game === "snooker" || s.game === "nine") return null;
  const grp = s.groups[player]; if (!grp) return null;
  return s.balls.filter(b => b.on && b.id && def(s.game, b.id).kind === grp).map(b => b.id);
}
