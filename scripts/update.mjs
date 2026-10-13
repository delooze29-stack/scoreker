// ScoreKer weekly data script — run by GitHub Actions (see .github/workflows/scoreker.yml)
//
//   node scripts/update.mjs select    -> pick this weekend's 13 games (+ tie-break), set colours from odds
//   node scripts/update.mjs results   -> fetch scores for the current weekend and update the files
//
// Needs the ODDS_API_KEY environment variable (a GitHub secret). Writes:
//   data/week.json            the current weekend
//   data/weeks/<weekId>.json  a copy of every weekend (used by the Season screen)
//   data/weeks/index.json     list of weekend ids

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const API = 'https://api.the-odds-api.com/v4';
const SPORTS = { PL: 'soccer_epl', CH: 'soccer_efl_champ', L1: 'soccer_england_league1' };
const COLOURS = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
const RED_GAP_MIN = 110; // colour games must kick off at least this long after the red

// ---------- pure helpers (exported for tests) ----------

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function toGame(ev, league) {
  const prices = { home: [], draw: [], away: [] };
  for (const bk of ev.bookmakers || []) {
    const m = (bk.markets || []).find((x) => x.key === 'h2h');
    if (!m) continue;
    for (const o of m.outcomes) {
      if (o.name === ev.home_team) prices.home.push(o.price);
      else if (o.name === ev.away_team) prices.away.push(o.price);
      else if (o.name === 'Draw') prices.draw.push(o.price);
    }
  }
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  return {
    id: ev.id, sport: ev.sport_key, league, home: ev.home_team, away: ev.away_team,
    kickoff: ev.commence_time,
    odds: { home: r2(avg(prices.home)), draw: r2(avg(prices.draw)), away: r2(avg(prices.away)) },
    status: 'NS', result: null,
  };
}

const hasOdds = (g) => g.odds.home && g.odds.away;
const ko = (g) => Date.parse(g.kickoff);

function shuffle(xs, rnd = Math.random) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Most one-sided game = yellow ... most even game = black
export function colourise(games) {
  const sorted = games.slice().sort((a, b) => Math.abs(b.odds.home - b.odds.away) - Math.abs(a.odds.home - a.odds.away));
  return sorted.map((g, i) => ({ ...g, colour: COLOURS[i] }));
}

// Picks the red, 6 clearance games (PL first), 6 free-colour games (Championship first) and the tie-break.
export function pickWeek({ pl, ch, l1 = [] }, rnd = Math.random) {
  const notes = [];
  const all = [...pl, ...ch, ...l1].filter(hasOdds);
  const latest = (xs) => xs.slice().sort((a, b) => ko(b) - ko(a))[0] || null;
  // Reserve the tie-break first: the last Premier League game of the weekend (else last game of all)
  const tb0 = latest(pl.filter(hasOdds)) || latest(all);
  const notTb = (g) => !tb0 || g.id !== tb0.id;
  const plO = pl.filter(hasOdds).filter(notTb), chO = ch.filter(hasOdds).filter(notTb), l1O = l1.filter(hasOdds).filter(notTb);

  // Red candidates: earliest PL games first, then earliest Championship games
  const redCands = [...plO.slice().sort((a, b) => ko(a) - ko(b)), ...chO.slice().sort((a, b) => ko(a) - ko(b))];
  for (const gap of [RED_GAP_MIN, 1]) {
    for (const red of redCands) {
      const after = (g) => g.id !== red.id && ko(g) >= ko(red) + gap * 60000;
      let clearPool = shuffle(plO.filter(after), rnd);
      let freePool = shuffle(chO.filter(after), rnd);
      const clear = clearPool.slice(0, 6);
      if (clear.length < 6) {
        const extra = freePool.filter((g) => !clear.includes(g)).slice(0, 6 - clear.length);
        clear.push(...extra);
        if (extra.length) notes.push(`Premier League short — ${extra.length} Championship game(s) used in the clearance.`);
      }
      let free = freePool.filter((g) => !clear.includes(g)).slice(0, 6);
      if (free.length < 6) {
        const extra = shuffle(l1O.filter(after), rnd).slice(0, 6 - free.length);
        free.push(...extra);
        if (extra.length) notes.push(`Championship short — ${extra.length} League One game(s) used for the free colour.`);
      }
      if (clear.length === 6 && free.length === 6) {
        if (gap !== RED_GAP_MIN) notes.push('No clear early kick-off this weekend: some colour games start before the red finishes.');
        const used = new Set([red.id, ...clear.map((g) => g.id), ...free.map((g) => g.id)]);
        const rest = all.filter((g) => !used.has(g.id) && ko(g) > ko(red));
        const tiebreak = tb0 && !used.has(tb0.id) && ko(tb0) > ko(red) ? tb0 : (latest(rest.filter((g) => g.league === 'PL')) || latest(rest));
        const cl = colourise(clear), fr = colourise(free);
        return {
          red: { ...red, colour: 'red' },
          free: fr, clear: cl, tiebreak,
          redKickoff: red.kickoff,
          freeLock: new Date(Math.min(...fr.map(ko))).toISOString(),
          notes,
        };
      }
    }
  }
  return null;
}

// Window for "this weekend": Friday 12:00 UTC before the target Saturday until Monday 04:00 UTC after it.
export function weekendWindow(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const toSat = (6 - d.getUTCDay() + 7) % 7; // 0 if today is Saturday
  // On Sunday/Monday, still mean the weekend just gone? No: select always looks ahead.
  const sat = new Date(d.getTime() + toSat * 86400000);
  const from = new Date(Math.max(now.getTime(), sat.getTime() - 12 * 3600000)); // Fri 12:00 UTC
  const to = new Date(sat.getTime() + 52 * 3600000); // Mon 04:00 UTC
  return { weekId: sat.toISOString().slice(0, 10), from, to };
}

// Apply scores-endpoint events to a week. Returns number of games changed.
export function applyScores(week, events) {
  const byId = new Map(events.map((e) => [e.id, e]));
  let changed = 0;
  const games = [week.red, ...week.free, ...week.clear, week.tiebreak].filter(Boolean);
  for (const g of games) {
    const e = byId.get(g.id);
    if (!e || !e.scores) continue;
    const sc = (name) => { const s = e.scores.find((x) => x.name === name); return s ? parseInt(s.score, 10) : null; };
    const h = sc(g.home), a = sc(g.away);
    if (h == null || a == null || Number.isNaN(h) || Number.isNaN(a)) continue;
    const status = e.completed ? 'FT' : 'LIVE';
    if (g.status !== status || !g.result || g.result[0] !== h || g.result[1] !== a) {
      g.status = status; g.result = [h, a]; changed++;
    }
  }
  return changed;
}

// ---------- API + files ----------

const KEY = process.env.ODDS_API_KEY;

async function api(p, params = {}) {
  const u = new URL(API + p);
  u.searchParams.set('apiKey', KEY);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u);
  const left = r.headers.get('x-requests-remaining');
  const shown = u.toString().replace(KEY, '***');
  if (!r.ok) throw new Error(`${r.status} from ${shown}: ${await r.text()}`);
  console.log(`GET ${p} ok — credits left this month: ${left}`);
  return r.json();
}

const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

async function fetchOdds(sport, league, win) {
  try {
    const evs = await api(`/sports/${sport}/odds`, {
      regions: 'uk', markets: 'h2h', oddsFormat: 'decimal', dateFormat: 'iso',
      commenceTimeFrom: iso(win.from), commenceTimeTo: iso(win.to),
    });
    return evs.map((e) => toGame(e, league));
  } catch (e) {
    console.warn(`Could not fetch ${league}: ${e.message}`);
    return [];
  }
}

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

async function save(week) {
  await fs.mkdir(path.join(DATA, 'weeks'), { recursive: true });
  const body = JSON.stringify(week, null, 2) + '\n';
  await fs.writeFile(path.join(DATA, 'week.json'), body);
  await fs.writeFile(path.join(DATA, 'weeks', `${week.weekId}.json`), body);
  const idxFile = path.join(DATA, 'weeks', 'index.json');
  const idx = await readJSON(idxFile, { weeks: [] });
  if (!idx.weeks.includes(week.weekId)) idx.weeks.push(week.weekId);
  idx.weeks.sort();
  await fs.writeFile(idxFile, JSON.stringify(idx, null, 2) + '\n');
}

async function select() {
  const win = weekendWindow();
  const existing = await readJSON(path.join(DATA, 'week.json'), null);
  if (existing && existing.weekId === win.weekId && process.env.FORCE !== '1') {
    console.log(`Week ${win.weekId} already picked — set FORCE=1 to re-pick.`);
    return;
  }
  console.log(`Picking games for weekend ${win.weekId} (${iso(win.from)} → ${iso(win.to)})`);
  const pl = await fetchOdds(SPORTS.PL, 'PL', win);
  const ch = await fetchOdds(SPORTS.CH, 'Championship', win);
  let pick = pickWeek({ pl, ch });
  if (!pick) {
    const l1 = await fetchOdds(SPORTS.L1, 'League One', win);
    pick = pickWeek({ pl, ch, l1 });
  }
  if (!pick) {
    console.log('Not enough games with odds this weekend — no frame set.');
    await save({ weekId: win.weekId, empty: true, createdAt: new Date().toISOString(), notes: ['Not enough fixtures this weekend.'] });
    return;
  }
  const week = { weekId: win.weekId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...pick };
  await save(week);
  console.log(`Red: ${week.red.home} v ${week.red.away} (${week.red.kickoff})`);
  for (const g of week.clear) console.log(`Clear ${g.colour}: ${g.home} v ${g.away}`);
  for (const g of week.free) console.log(`Free ${g.colour}: ${g.home} v ${g.away}`);
  if (week.tiebreak) console.log(`Tie-break: ${week.tiebreak.home} v ${week.tiebreak.away}`);
}

async function results() {
  const week = await readJSON(path.join(DATA, 'week.json'), null);
  if (!week || week.empty) { console.log('No current week.'); return; }
  const games = [week.red, ...week.free, ...week.clear, week.tiebreak].filter(Boolean);
  const now = Date.now();
  const due = games.filter((g) => g.status !== 'FT' && ko(g) < now);
  if (!due.length) { console.log('Nothing kicked off that still needs a result.'); return; }
  const sports = [...new Set(due.map((g) => g.sport))];
  let changed = 0;
  for (const sport of sports) {
    try {
      const evs = await api(`/sports/${sport}/scores`, { daysFrom: '3', dateFormat: 'iso' });
      changed += applyScores(week, evs);
    } catch (e) { console.warn(`Scores failed for ${sport}: ${e.message}`); }
  }
  if (!changed) { console.log('No score changes.'); return; }
  week.updatedAt = new Date().toISOString();
  await save(week);
  console.log(`Updated ${changed} game(s).`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (!KEY) { console.error('ODDS_API_KEY is not set.'); process.exit(1); }
  const mode = process.argv[2];
  if (mode === 'select') await select();
  else if (mode === 'results') await results();
  else { console.error('Usage: node scripts/update.mjs select|results'); process.exit(1); }
}
