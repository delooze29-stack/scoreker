// ScoreKer scoring engine — pure functions, no Firebase, no DOM.
// A "week" comes from data/weeks/<id>.json (written by the weekly script).
// A "pred" is a player's predictions: { scores: { [gameId]: [home, away] }, freeChoice: 'yellow'..'black' | null }

export const COLOURS = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
export const VALUE = { red: 1, yellow: 2, green: 3, brown: 4, blue: 5, pink: 6, black: 7 };

const sign = (h, a) => Math.sign(h - a);
const hasPred = (p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]);

// How one prediction fared against one game.
// state: 'exact' | 'potted' | 'miss' | 'live' | 'pending'
export function judge(game, p) {
  if (!game) return 'pending';
  if (game.status !== 'FT' || !game.result) return game.status === 'LIVE' ? 'live' : 'pending';
  if (!hasPred(p)) return 'miss';
  const [rh, ra] = game.result;
  if (p[0] === rh && p[1] === ra) return 'exact';
  if (sign(p[0], p[1]) === sign(rh, ra)) return 'potted';
  return 'miss';
}

// Works out one player's break for the weekend.
// Returns { total, rows, finished, exacts, inPlay }
//  row.state: 'exact' | 'potted' | 'miss' | 'live' | 'pending' | 'off' (not reached) | 'none' (no free colour)
export function scoreBreak(week, pred, now = Date.now()) {
  const s = (pred && pred.scores) || {};
  const rows = [];
  let total = 0;
  let ended = false;    // a miss has ended the break
  let blocked = false;  // an earlier ball isn't decided yet, so later balls can't be scored

  const play = (stage, colour, game) => {
    const value = VALUE[colour];
    const p = game ? s[game.id] : null;
    if (ended) { rows.push({ stage, colour, game, pred: p, state: 'off', points: 0 }); return 'off'; }
    const j = judge(game, p);
    if (blocked) {
      rows.push({ stage, colour, game, pred: p, state: j === 'live' ? 'live' : 'pending', points: 0, waiting: true });
      return 'pending';
    }
    if (j === 'live' || j === 'pending') { blocked = true; rows.push({ stage, colour, game, pred: p, state: j, points: 0 }); return j; }
    if (j === 'miss') { rows.push({ stage, colour, game, pred: p, state: 'miss', points: 0 }); return 'miss'; }
    const points = value * (j === 'exact' ? 2 : 1);
    total += points;
    rows.push({ stage, colour, game, pred: p, state: j, points });
    return j;
  };

  // 1. The red
  const red = play('red', 'red', week.red);

  // 2. The free colour (only if the red was potted)
  if (red === 'miss') {
    rows.push({ stage: 'free', colour: null, game: null, state: 'none', points: 0 });
  } else if (red === 'live' || red === 'pending') {
    const g = pred && pred.freeChoice ? week.free.find((x) => x.colour === pred.freeChoice) : null;
    rows.push({ stage: 'free', colour: pred && pred.freeChoice, game: g, pred: g ? s[g.id] : null, state: 'pending', points: 0, waiting: true });
  } else {
    const choice = pred && pred.freeChoice;
    const g = choice ? week.free.find((x) => x.colour === choice) : null;
    if (!g) {
      const lock = week.freeLock ? Date.parse(week.freeLock) : 0;
      if (now < lock) { blocked = true; rows.push({ stage: 'free', colour: null, game: null, state: 'choose', points: 0 }); }
      else { ended = true; rows.push({ stage: 'free', colour: null, game: null, state: 'miss', points: 0, note: 'No colour chosen' }); }
    } else {
      const r = play('free', choice, g);
      if (r === 'miss') ended = true;
    }
  }

  // 3. The clearance, yellow to black
  for (const colour of COLOURS) {
    const g = week.clear.find((x) => x.colour === colour);
    const r = play('clear', colour, g);
    if (r === 'miss') ended = true;
  }

  const finished = !rows.some((r) => ['live', 'pending', 'choose'].includes(r.state));
  const inPlay = !finished && !ended;
  return { total, rows, finished, ended, inPlay, exacts: countExacts(week, pred) };
}

// Exact scores across all 13 frame games (tie-break 1)
export function countExacts(week, pred) {
  const s = (pred && pred.scores) || {};
  const games = [week.red, ...week.free, ...week.clear].filter(Boolean);
  return games.filter((g) => judge(g, s[g.id]) === 'exact').length;
}

// Tie-break 2: the Sunday late game. Higher is better.
function tieQuality(game, p) {
  if (!hasPred(p) || !game.result) return [-1, -99, -99];
  const [rh, ra] = game.result;
  const cls = p[0] === rh && p[1] === ra ? 2 : sign(p[0], p[1]) === sign(rh, ra) ? 1 : 0;
  return [cls, -Math.abs((p[0] - p[1]) - (rh - ra)), -Math.abs((p[0] + p[1]) - (rh + ra))];
}

// Decide the frame between two players.
// Returns { status: 'final'|'in-progress', winner: 0|1|null (null = drawn), how, breaks:[b0,b1] }
export function decideFrame(week, preds, now = Date.now()) {
  const b = preds.map((p) => scoreBreak(week, p, now));
  if (!b[0].finished || !b[1].finished) return { status: 'in-progress', winner: null, how: null, breaks: b };
  if (b[0].total !== b[1].total) return { status: 'final', winner: b[0].total > b[1].total ? 0 : 1, how: 'points', breaks: b };
  if (b[0].exacts !== b[1].exacts) return { status: 'final', winner: b[0].exacts > b[1].exacts ? 0 : 1, how: 'exact scores', breaks: b };
  const tb = week.tiebreak;
  if (!tb) return { status: 'final', winner: null, how: 'drawn', breaks: b };
  if (tb.status !== 'FT' || !tb.result) return { status: 'in-progress', winner: null, how: 'tie-break', breaks: b };
  const q = preds.map((p) => tieQuality(tb, p && p.scores && p.scores[tb.id]));
  for (let i = 0; i < 3; i++) {
    if (q[0][i] !== q[1][i]) return { status: 'final', winner: q[0][i] > q[1][i] ? 0 : 1, how: 're-spotted black', breaks: b };
  }
  return { status: 'final', winner: null, how: 'drawn', breaks: b };
}
