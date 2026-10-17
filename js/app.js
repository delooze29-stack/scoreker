import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, Timestamp, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig, PLAYERS, HIGH_BREAK_BONUS } from './config.js';
import { scoreBreak, decideFrame, COLOURS, VALUE } from './scoring.js';

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const $app = document.getElementById('app');

const S = {
  user: null, me: -1, view: 'frame', showPlayer: 0,
  week: null, weekError: null,
  preds: [null, null], hidden: [false, false], status: [null, null],
  draft: null, saving: false, freeHidden: [false, false],
  season: null, seasonLoading: false,
};

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tz = 'Europe/London';
const fmtKO = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' });
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');
const name = (i) => esc(PLAYERS[i].name);
const emailOf = (i) => PLAYERS[i].email.toLowerCase();
const other = (i) => 1 - i;
const now = () => Date.now();
const redStarted = () => S.week && now() >= Date.parse(S.week.redKickoff);
const freeLocked = () => S.week && now() >= Date.parse(S.week.freeLock);
const allGames = (w) => [w.red, ...w.free, ...w.clear, w.tiebreak].filter(Boolean);

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), 2400);
}

function gameLine(g) {
  if (!g) return '';
  if (g.status === 'FT' && g.result) return `${fmtKO(g.kickoff)} · FT ${g.result[0]}–${g.result[1]}`;
  if (g.status === 'LIVE' && g.result) return `${fmtKO(g.kickoff)} · LIVE ${g.result[0]}–${g.result[1]}`;
  return fmtKO(g.kickoff);
}
const predText = (p) => (Array.isArray(p) && Number.isInteger(p[0]) ? `${p[0]}–${p[1]}` : 'no prediction');
const dot = (c, sm) => (c ? `<span class="dot ${sm ? 'sm ' : ''}c-${c} ${c === 'black' ? 'black' : ''}" aria-hidden="true"></span>` : `<span class="dot empty${sm ? ' sm' : ''}" aria-hidden="true"></span>`);

// ---------- data ----------
async function fetchJSON(url) {
  const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

async function loadWeek() {
  try {
    const w = await fetchJSON('data/week.json');
    S.week = w.empty ? null : w;
    S.weekError = w.empty ? (w.notes || []).join(' ') || 'No frame this weekend.' : null;
  } catch {
    S.week = null; S.weekError = 'No fixtures yet — they arrive on Friday morning.';
  }
}

async function ensureWeekDoc(w) {
  const ref = doc(db, 'weeks', w.weekId);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      redKickoff: Timestamp.fromDate(new Date(w.redKickoff)),
      freeLock: Timestamp.fromDate(new Date(w.freeLock)),
    });
  }
}

async function readDoc(...path) {
  try { const snap = await getDoc(doc(db, ...path)); return { ok: true, data: snap.exists() ? snap.data() : null }; }
  catch { return { ok: false, data: null }; }
}

// A player's predictions for a week: the main 8 games, plus their free colour pick
// (kept in a separate document so it stays hidden until the free-colour games kick off).
async function readPred(weekId, i) {
  const [main, free] = await Promise.all([readDoc('weeks', weekId, 'preds', emailOf(i)), readDoc('weeks', weekId, 'free', emailOf(i))]);
  if (!main.ok) return { ok: false, data: null, freeOk: free.ok };
  if (!main.data && !free.data) return { ok: true, data: null, freeOk: free.ok };
  const pred = { scores: { ...((main.data && main.data.scores) || {}) }, freeChoice: (main.data && main.data.freeChoice) || null };
  if (free.data && free.data.colour) {
    pred.freeChoice = free.data.colour;
    if (free.data.gameId && Array.isArray(free.data.score)) pred.scores[free.data.gameId] = free.data.score;
  }
  return { ok: true, data: pred, freeOk: free.ok, freeDoc: free.data };
}

async function loadPreds() {
  if (!S.week) return;
  const id = S.week.weekId;
  try { await ensureWeekDoc(S.week); } catch (e) { console.warn('week doc', e); }
  const res = await Promise.all([readPred(id, 0), readPred(id, 1)]);
  S.preds = res.map((r) => r.data);
  S.hidden = res.map((r) => !r.ok);
  S.freeHidden = res.map((r) => !r.freeOk);
  const st = await Promise.all([0, 1].map(async (i) => {
    try { const s = await getDoc(doc(db, 'weeks', id, 'status', emailOf(i))); return s.exists() ? s.data() : null; } catch { return null; }
  }));
  S.status = st;
  if (!S.draft || S.draft.weekId !== id) {
    const mine = S.preds[S.me] || {};
    const scores = JSON.parse(JSON.stringify(mine.scores || {}));
    const fg = mine.freeChoice ? S.week.free.find((g) => g.colour === mine.freeChoice) : null;
    const freeScore = fg && Array.isArray(scores[fg.id]) ? scores[fg.id].slice() : [null, null];
    for (const g of S.week.free) delete scores[g.id];
    S.draft = { weekId: id, scores, free: { colour: mine.freeChoice || null, score: freeScore } };
  }
}

async function loadSeason() {
  if (S.seasonLoading) return;
  S.seasonLoading = true;
  try {
    const idx = await fetchJSON('data/weeks/index.json');
    const out = [];
    for (const id of idx.weeks) {
      let w;
      try { w = await fetchJSON(`data/weeks/${id}.json`); } catch { continue; }
      if (w.empty || now() < Date.parse(w.redKickoff)) continue;
      const preds = (await Promise.all([readPred(id, 0), readPred(id, 1)])).map((r) => r.data);
      if (!preds[0] && !preds[1]) continue;
      out.push({ week: w, preds, frame: decideFrame(w, preds) });
    }
    S.season = out;
  } catch {
    S.season = [];
  }
  S.seasonLoading = false;
  render();
}

function seasonTally() {
  const t = [0, 1].map(() => ({ w: 0, d: 0, l: 0, exact: 0, frames: 0 }));
  const breaks = [];
  for (const f of S.season || []) {
    const fr = f.frame;
    fr.breaks.forEach((b, i) => {
      if (fr.status === 'final') t[i].exact += b.exacts;
      if (b.finished) breaks.push({ i, total: b.total, weekId: f.week.weekId });
    });
    if (fr.status !== 'final') continue;
    if (fr.winner == null) { t[0].d++; t[1].d++; }
    else { t[fr.winner].w++; t[fr.winner].frames++; t[other(fr.winner)].l++; }
  }
  breaks.sort((a, b) => b.total - a.total || a.weekId.localeCompare(b.weekId));
  return { t, breaks };
}

// ---------- actions ----------
async function login() {
  const provider = new GoogleAuthProvider();
  try { await signInWithPopup(auth, provider); }
  catch (e) {
    if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'].includes(e.code)) {
      await signInWithRedirect(auth, provider);
    } else { renderLogin(e.message); }
  }
}

const mainGames = (w) => [w.red, ...w.clear, w.tiebreak].filter(Boolean);
const full = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isInteger);
function filledCount() {
  const m = mainGames(S.week).filter((g) => full(S.draft.scores[g.id])).length;
  const f = S.draft.free.colour && full(S.draft.free.score) ? 1 : 0;
  const total = mainGames(S.week).length + 1;
  return { filled: m + f, total, main: m === total - 1, free: f === 1 };
}

async function savePreds() {
  if (!S.week || S.saving || freeLocked()) return;
  const id = S.week.weekId;
  const fr = S.draft.free;
  if (fr.colour && !full(fr.score)) { toast('Put a score in for your free colour'); return; }
  S.saving = true; render();
  try {
    if (!redStarted()) {
      const scores = {};
      for (const g of mainGames(S.week)) if (S.draft.scores[g.id]) scores[g.id] = S.draft.scores[g.id];
      await setDoc(doc(db, 'weeks', id, 'preds', emailOf(S.me)), { scores, name: PLAYERS[S.me].name, updatedAt: serverTimestamp() });
    }
    if (fr.colour) {
      const g = S.week.free.find((x) => x.colour === fr.colour);
      await setDoc(doc(db, 'weeks', id, 'free', emailOf(S.me)), { colour: fr.colour, gameId: g.id, score: fr.score, updatedAt: serverTimestamp() });
    }
    const { filled, total, main, free } = filledCount();
    await setDoc(doc(db, 'weeks', id, 'status', emailOf(S.me)), { filled, total, main, free, at: serverTimestamp() });
    const keep = S.draft; await loadPreds(); S.draft = keep;
    toast(filled === total ? 'Locked in ✓' : `Saved ${filled}/${total}`);
  } catch (e) {
    console.error(e); toast('Could not save — predictions are locked');
  }
  S.saving = false; render();
}

function pickFree(colour) {
  if (!S.week || freeLocked()) return;
  if (S.draft.free.colour !== colour) S.draft.free = { colour, score: [null, null] };
  render();
}

// ---------- views ----------
function renderLogin(err, info) {
  $app.innerHTML = `
    <div class="login">
      <div class="brand">SCOREKER</div>
      <p>Weekend football predictions, played as a frame of snooker.</p>
      <button class="primary" id="signin" style="max-width:320px">Sign in with Google</button>
      <p class="small muted">or with your email</p>
      <form id="pwform" class="pwform" style="width:100%;max-width:320px;display:flex;flex-direction:column;gap:8px">
        <label class="small muted" for="em" style="text-align:left">Email</label>
        <input id="em" type="email" autocomplete="email" required class="field">
        <label class="small muted" for="pw" style="text-align:left">Password (6+ characters)</label>
        <input id="pw" type="password" autocomplete="current-password" minlength="6" required class="field">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button type="submit" class="primary" style="min-height:46px;font-size:15px">Sign in</button>
          <button type="button" id="create" class="primary done" style="min-height:46px;font-size:15px">Create account</button>
        </div>
        <button type="button" id="forgot" class="linkbtn" style="align-self:center">Forgot password?</button>
      </form>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}
      ${info ? `<p class="small" style="color:var(--good-text)">${esc(info)}</p>` : ''}
    </div>`;
  document.getElementById('signin').onclick = login;
  const em = () => document.getElementById('em').value.trim();
  const pw = () => document.getElementById('pw').value;
  const nice = (e) => ({
    'auth/invalid-credential': 'Wrong email or password.',
    'auth/wrong-password': 'Wrong email or password.',
    'auth/user-not-found': 'No account with that email yet — tap Create account.',
    'auth/email-already-in-use': 'That email already has an account — tap Sign in.',
    'auth/weak-password': 'Password needs at least 6 characters.',
    'auth/invalid-email': 'That email address doesn\'t look right.',
  }[e.code] || e.message);
  document.getElementById('pwform').onsubmit = async (ev) => {
    ev.preventDefault();
    try { await signInWithEmailAndPassword(auth, em(), pw()); } catch (e) { renderLogin(nice(e)); }
  };
  document.getElementById('create').onclick = async () => {
    if (!em() || pw().length < 6) { renderLogin('Enter your email and a password of 6+ characters first.'); return; }
    if (playerIndex(em()) < 0) { renderLogin(`${em()} isn't one of the two players.`); return; }
    try {
      const cred = await createUserWithEmailAndPassword(auth, em(), pw());
      await sendEmailVerification(cred.user);
    } catch (e) { renderLogin(nice(e)); }
  };
  document.getElementById('forgot').onclick = async () => {
    if (!em()) { renderLogin('Type your email first, then tap Forgot password.'); return; }
    try { await sendPasswordResetEmail(auth, em()); renderLogin(null, `Reset link sent to ${em()}.`); } catch (e) { renderLogin(nice(e)); }
  };
}

function renderVerify() {
  $app.innerHTML = `
    <div class="login">
      <div class="brand">SCOREKER</div>
      <p>Nearly there. We've sent a link to <b>${esc(S.user.email)}</b> — click it to confirm your email, then come back and tap Continue.</p>
      <p class="small muted">Can't see it? Check your junk folder.</p>
      <button class="primary" id="cont" style="max-width:320px">Continue</button>
      <button class="linkbtn" id="resend">Send the link again</button>
      <button class="linkbtn" id="out">Sign out</button>
    </div>`;
  document.getElementById('cont').onclick = async () => {
    await S.user.reload();
    if (S.user.emailVerified) { await S.user.getIdToken(true); start(S.user); } else toast('Not confirmed yet');
  };
  document.getElementById('resend').onclick = async () => { try { await sendEmailVerification(S.user); toast('Link sent'); } catch { toast('Try again in a minute'); } };
  document.getElementById('out').onclick = () => signOut(auth);
}

function renderNotPlayer() {
  $app.innerHTML = `
    <div class="login">
      <div class="brand">SCOREKER</div>
      <p>${esc(S.user.email)} isn't one of the two players.</p>
      <button class="primary" id="out" style="max-width:300px">Sign out</button>
    </div>`;
  document.getElementById('out').onclick = () => signOut(auth);
}

function header(title, sub) {
  return `<header class="top">
    <div><div class="brand">${title}</div><div class="sub">${sub}</div></div>
    <button class="linkbtn" id="signout">Sign out</button>
  </header>`;
}

function nav() {
  const b = (v, l) => `<button data-nav="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${l}</button>`;
  return `<nav class="bottom" aria-label="Sections"><div class="in">${b('frame', 'Frame')}${b('predict', 'Predict')}${b('season', 'Season')}${b('rules', 'Rules')}</div></nav>`;
}

function weekSub() {
  if (!S.week) return 'Waiting for fixtures';
  return `Weekend of ${fmtDay(S.week.weekId + 'T12:00:00Z')}`;
}

const LABEL = { exact: 'Exact ×2', potted: 'Potted', miss: 'Missed', live: 'Live', pending: 'To play', off: 'Not reached', none: '—', choose: 'Pick colour' };
const STAGE = { red: 'Red', free: 'Free colour', clear: 'Clearance' };

function breakRows(b, i) {
  const youThem = i === S.me ? 'You' : PLAYERS[i].name;
  return b.rows.map((r) => {
    let stage, fx, det;
    if (r.stage === 'free') {
      if (r.state === 'none') { stage = 'Free colour'; fx = 'No free colour — red missed'; det = 'Straight into the clearance'; }
      else if (!r.game) { stage = 'Free colour'; fx = r.state === 'choose' ? (i === S.me ? 'Pick your free colour on the Predict screen' : 'Their pick is hidden until the free-colour games kick off') : (r.note || 'Not chosen yet'); det = S.week.freeLock ? `Locks ${fmtKO(S.week.freeLock)}` : ''; }
      else { stage = `Free colour · ${cap(r.colour)} ${VALUE[r.colour]} · ${esc(r.game.league)}`; fx = `${esc(r.game.home)} v ${esc(r.game.away)}`; det = `${gameLine(r.game)} · ${esc(youThem)} ${predText(r.pred)}`; }
    } else {
      stage = r.stage === 'red' ? 'Red · 1' : `${cap(r.colour)} · ${VALUE[r.colour]} · clearance`;
      fx = `${esc(r.game.home)} v ${esc(r.game.away)}`;
      det = `${gameLine(r.game)} · ${esc(youThem)} ${predText(r.pred)}`;
    }
    const pts = r.points ? `+${r.points}` : (['exact', 'potted', 'miss'].includes(r.state) ? '0' : '–');
    return `<div class="row">${dot(r.colour)}
      <div style="min-width:0"><div class="stage">${stage}</div><div class="fx">${fx}</div><div class="det">${det}</div></div>
      <div class="right"><span class="badge b-${r.state}">${LABEL[r.state]}</span><span class="pts">${pts}</span></div></div>`;
  }).join('');
}

const POS = { yellow: [21.5, 67], green: [21.5, 33], brown: [21.5, 50], blue: [50, 50], pink: [75, 50], red: [80.5, 50], black: [91, 50] };

function tableView(b) {
  const onTable = [];
  const potted = [];
  let nextMarked = false;
  for (const r of b.rows) {
    if (r.stage === 'free') { if (r.points) potted.push({ c: r.colour, t: `+${r.points} free` }); continue; }
    if (r.state === 'exact' || r.state === 'potted') { potted.push({ c: r.colour, t: `+${r.points}` }); continue; }
    if (r.stage === 'red' && r.state === 'miss') continue;
    let cls = '';
    if (r.state === 'miss') cls = 'missed';
    else if (!nextMarked && ['live', 'pending'].includes(r.state) && !b.ended) { cls = 'next'; nextMarked = true; }
    onTable.push({ c: r.colour, cls, label: `${r.colour}${cls === 'missed' ? ' – missed' : ''}` });
  }
  const balls = onTable.map((x) => `<div class="ball c-${x.c} ${x.c === 'black' ? 'black' : ''} ${x.cls}" role="img" aria-label="${x.label}" style="left:${POS[x.c][0]}%;top:${POS[x.c][1]}%"></div>`).join('');
  const pockets = [['0', '0'], ['50%', '0'], ['100%', '0'], ['0', '100%'], ['50%', '100%'], ['100%', '100%']]
    .map(([l, t]) => `<div class="pocket" style="left:calc(${l} - 7px);top:calc(${t} - 7px)"></div>`).join('');
  return `<section class="table-wrap" aria-label="Snooker table">
    <div class="cushion"><div class="baize"><div class="baulk"></div><div class="d"></div>${pockets}${balls}</div></div>
    <div class="rail"><span class="muted">Potted:</span>${potted.length ? potted.map((p) => `<span class="chip">${dot(p.c, true)}${p.t}</span>`).join('') : '<span class="muted">nothing yet</span>'}</div>
  </section>`;
}

function bannerFor(b, i) {
  const who = i === S.me ? 'You' : PLAYERS[i].name;
  if (b.finished) return [`Final break: ${b.total}`, `${b.exacts} exact score${b.exacts === 1 ? '' : 's'} this weekend.`];
  if (b.ended) {
    const miss = b.rows.find((r) => r.state === 'miss');
    const what = miss && miss.game ? `${miss.game.home} v ${miss.game.away}` : 'a missed ball';
    return [`Break over at ${b.total}`, `Missed on ${esc(what)}.`];
  }
  const next = b.rows.find((r) => ['live', 'pending', 'choose'].includes(r.state));
  if (next && next.state === 'choose') return [`At the table · break ${b.total}`, `${esc(who)} potted the red — pick a free colour on the Predict screen before ${fmtKO(S.week.freeLock)}.`];
  if (next && next.game) {
    const st = next.game.status === 'LIVE' ? `live now ${next.game.result[0]}–${next.game.result[1]}` : `kicks off ${fmtKO(next.game.kickoff)}`;
    return [`At the table · break ${b.total}`, `Next: ${next.colour === 'red' ? 'the red' : `the ${next.colour}`} — ${esc(next.game.home)} v ${esc(next.game.away)}, ${st}. ${esc(who)} went ${predText(next.pred)}.`];
  }
  return [`At the table · break ${b.total}`, ''];
}

function renderFrame() {
  if (!S.week) return `${header('SCOREKER', weekSub())}<div class="note"><b>No frame yet</b><p>${esc(S.weekError || '')}</p></div>`;
  const fr = decideFrame(S.week, S.preds);
  const tally = S.season ? seasonTally().t : null;
  const frames = tally ? `${tally[0].frames} <span>(FRAMES)</span> ${tally[1].frames}` : '<span>FRAMES</span>';
  const scoreCell = (i) => {
    const b = fr.breaks[i];
    let state, on = false;
    if (S.hidden[i]) state = 'Hidden until the red';
    else if (!S.preds[i]) state = redStarted() ? 'No predictions' : 'Not entered yet';
    else if (b.finished) state = 'Final';
    else if (b.ended) state = 'Break over';
    else { state = 'At the table'; on = true; }
    return `<div><div class="big">${S.hidden[i] ? '–' : b.total}</div><div class="state ${on ? 'on' : ''}">${state}</div></div>`;
  };
  let result = '';
  if (fr.status === 'final') result = fr.winner == null ? 'Frame drawn' : `${name(fr.winner)} wins the frame (${fr.how})`;
  else if (!redStarted()) result = `Predictions lock at the red: ${fmtKO(S.week.redKickoff)}`;

  const i = S.showPlayer;
  const b = fr.breaks[i];
  const [bt, bx] = bannerFor(b, i);
  const seg = `<div class="seg" role="tablist" aria-label="Show break for">
    ${[0, 1].map((k) => `<button role="tab" data-show="${k}" aria-selected="${k === i}">${k === S.me ? 'My' : `${name(k)}'s`} break</button>`).join('')}</div>`;

  const body = S.hidden[i]
    ? `<div class="note"><b>Hidden until the red kicks off</b><p>${name(i)}'s predictions appear at ${fmtKO(S.week.redKickoff)}. ${S.status[i] ? `They've entered ${S.status[i].filled}/${S.status[i].total}.` : `They haven't entered yet.`}</p></div>`
    : `${tableView(b)}
      <div class="note"><b>${bt}</b><p>${bx}</p></div>
      ${i === S.me && !freeLocked() && b.rows[0].state !== 'miss' && !S.draft.free.colour ? `<div class="section"><button class="primary" data-nav="predict">Pick your free colour</button></div>` : ''}
      <section class="section" aria-label="Ball by ball"><div class="head"><h2>Ball by ball</h2><span class="small muted">Exact score = double</span></div>${breakRows(b, i)}</section>`;

  return `${header('SCOREKER', weekSub())}
    <section class="board" aria-label="Scoreboard">
      <div class="names"><div>${name(0)}</div><div class="frames">${frames}</div><div style="text-align:right">${name(1)}</div></div>
      <div class="scores">${scoreCell(0)}${scoreCell(1)}</div>
      ${result ? `<div class="result">${result}</div>` : ''}
    </section>
    ${seg}${body}
    ${S.week.notes && S.week.notes.length ? `<p class="small muted" style="margin:14px 16px 0">${S.week.notes.map(esc).join(' ')}</p>` : ''}
    <p class="small muted" style="margin:14px 16px 0;line-height:1.5">Level on points? Most exact scores wins. Still level: re-spotted black on ${S.week.tiebreak ? `${esc(S.week.tiebreak.home)} v ${esc(S.week.tiebreak.away)}` : 'the late game'}. Level again: frame drawn.</p>`;
}

function freeSection() {
  const w = S.week;
  const locked = freeLocked();
  const fr = S.draft.free;
  const g = fr.colour ? w.free.find((x) => x.colour === fr.colour) : null;
  const head = `<div class="head"><h2 id="pick-h">Free colour · ${esc(w.free[0].league)}</h2><span class="small muted">${locked ? 'Locked' : `Locks ${fmtKO(w.freeLock)}`}</span></div>`;
  if (g) {
    return `<section class="section" aria-labelledby="pick-h">${head}
      <div class="small muted" style="margin-top:-4px">Only counts if you pot the red. Miss it and your break ends.</div>
      ${predRow(g, `Your free colour · ${cap(g.colour)} ${VALUE[g.colour]}`, locked, true)}
      ${locked ? '' : `<button class="linkbtn" data-pick="" style="align-self:flex-start">Change colour</button>`}
    </section>`;
  }
  return `<section class="section" aria-labelledby="pick-h">${head}
    <div class="small muted" style="margin-top:-4px">Pick ONE game to go for — now, or after you've seen the red. Only counts if you pot the red.</div>
    <div class="picker">${w.free.map((x) => `
      <button class="pick" data-pick="${x.colour}" ${locked ? 'disabled' : ''}>
        ${dot(x.colour)}<span class="lbl"><b>${cap(x.colour)} · ${VALUE[x.colour]}</b><span>${esc(x.home)} v ${esc(x.away)}</span></span>
      </button>`).join('')}</div>
  </section>`;
}

function predRow(g, label, locked, isFree = false) {
  const p = (isFree ? S.draft.free.score : S.draft.scores[g.id]) || [];
  const v = (x) => (Number.isInteger(x) ? x : '');
  return `<div class="pred-row">${dot(g.colour)}
    <div style="min-width:0"><div class="fx">${esc(g.home)} v ${esc(g.away)}</div><div class="det">${label ? label + ' · ' : ''}${fmtKO(g.kickoff)}</div></div>
    <div class="score">
      <input type="number" inputmode="numeric" min="0" max="20" data-g="${g.id}" data-s="0" ${isFree ? 'data-fr="1"' : ''} value="${v(p[0])}" aria-label="${esc(g.home)} goals" placeholder="–" ${locked ? 'disabled' : ''}>
      <span class="muted" aria-hidden="true">–</span>
      <input type="number" inputmode="numeric" min="0" max="20" data-g="${g.id}" data-s="1" ${isFree ? 'data-fr="1"' : ''} value="${v(p[1])}" aria-label="${esc(g.away)} goals" placeholder="–" ${locked ? 'disabled' : ''}>
    </div>${oddsStrip(g, p)}</div>`;
}

// Bookmaker odds as UK fractions, e.g. 2.5 -> "6/4"
const FRACS = [[1,10],[1,8],[1,7],[1,6],[1,5],[2,9],[1,4],[2,7],[3,10],[1,3],[4,11],[2,5],[4,9],[1,2],[8,15],[4,7],[8,13],[4,6],[8,11],[4,5],[5,6],[10,11],[1,1],[11,10],[6,5],[5,4],[11,8],[6,4],[13,8],[7,4],[15,8],[2,1],[9,4],[5,2],[11,4],[3,1],[10,3],[7,2],[4,1],[9,2],[5,1],[11,2],[6,1],[13,2],[7,1],[15,2],[8,1],[9,1],[10,1],[11,1],[12,1],[14,1],[16,1],[18,1],[20,1],[25,1],[33,1],[40,1],[50,1]];
function frac(dec) {
  if (!dec) return '–';
  const x = dec - 1;
  let best = FRACS[0];
  for (const f of FRACS) if (Math.abs(f[0] / f[1] - x) < Math.abs(best[0] / best[1] - x)) best = f;
  return best[0] === best[1] ? 'Evens' : `${best[0]}/${best[1]}`;
}
const pickOf = (p) => (Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1]) ? Math.sign(p[0] - p[1]) : null);

function oddsStrip(g, p) {
  const o = g.odds || {};
  if (!o.home) return '';
  const pick = pickOf(p);
  const cell = (k, label, odds) => `<span class="odd ${pick === k ? 'on' : ''}" data-k="${k}"><span class="who">${esc(label)}</span><b>${frac(odds)}</b></span>`;
  return `<div class="odds" data-odds="${g.id}" aria-label="Bookmaker odds">
    ${cell(1, g.home, o.home)}${cell(0, 'Draw', o.draw)}${cell(-1, g.away, o.away)}</div>`;
}

function highlightOdds(id, p) {
  const strip = $app.querySelector(`[data-odds="${CSS.escape(id)}"]`);
  if (!strip) return;
  const pick = pickOf(p);
  strip.querySelectorAll('.odd').forEach((el) => el.classList.toggle('on', pick === +el.dataset.k));
}

function renderPredict() {
  if (!S.week) return `${header('PREDICT', weekSub())}<div class="note"><b>No frame yet</b><p>${esc(S.weekError || '')}</p></div>`;
  const locked = redStarted();
  const allLocked = freeLocked();
  const w = S.week;
  const opp = other(S.me);
  const { filled, total } = filledCount();
  const oppTxt = S.status[opp] ? `${name(opp)} has entered ${S.status[opp].filled}/${S.status[opp].total}.` : `${name(opp)} hasn't entered yet.`;
  const btn = S.saving ? 'Saving…' : allLocked ? 'Locked' : locked ? 'Save free colour' : `Save predictions (${filled}/${total})`;
  return `${header('PREDICT', `${weekSub()} · ${total} games to call`)}
    <div class="note"><b>${allLocked ? 'Everything is locked' : locked ? 'Main predictions are locked' : `Locks at the red kick-off · ${fmtKO(w.redKickoff)}`}</b>
      <p>${allLocked ? 'Enjoy the football.' : locked ? `The red has kicked off. You can still pick or change your free colour until ${fmtKO(w.freeLock)}.` : `${oppTxt} Their scores stay hidden until kick-off.`}</p></div>
    <section class="section"><div class="head"><h2>The red</h2><span class="small muted">Result right = 1 + free colour</span></div>${predRow(w.red, '', locked)}</section>
    ${freeSection()}
    <section class="section"><div class="head"><h2>Clearance · yellow to black</h2></div>
      <div class="small muted" style="margin-top:-4px">Played in order. A miss ends your break.</div>
      ${w.clear.map((g) => predRow(g, `${cap(g.colour)} ${VALUE[g.colour]}${g.league !== 'PL' ? ' · ' + esc(g.league) : ''}`, locked)).join('')}</section>
    ${w.tiebreak ? `<section class="section"><div class="head"><h2>Tie-break game</h2><span class="small muted">Only if the frame is level</span></div>${predRow(w.tiebreak, '', locked)}</section>` : ''}
    <div class="section" style="margin-bottom:20px">
      <button class="primary" id="save" ${allLocked || S.saving ? 'disabled' : ''}>${btn}</button>
      <div class="small muted" style="text-align:center">Colours set from bookmaker odds: closer match = higher colour.</div>
    </div>`;
}

function renderSeason() {
  if (!S.season) { if (!S.seasonLoading) loadSeason(); return `${header('SEASON', 'Loading…')}`; }
  const { t, breaks } = seasonTally();
  const hb = breaks[0];
  const finals = S.season.filter((f) => f.frame.status === 'final').length;
  const rows = [0, 1].map((i) => `<tr><th scope="row">${name(i)}</th><td>${t[i].w}</td><td>${t[i].d}</td><td>${t[i].l}</td><td>${t[i].exact}</td><td class="fr">${t[i].frames}${hb && hb.i === i ? `<span class="small muted" style="font-family:inherit"> +${HIGH_BREAK_BONUS}?</span>` : ''}</td></tr>`).join('');
  const frames = S.season.slice().reverse().map((f) => {
    const fr = f.frame;
    const sc = `${fr.breaks[0].total} – ${fr.breaks[1].total}`;
    const res = fr.status !== 'final' ? '<span class="badge b-live">In play</span>' : fr.winner == null ? '<span class="badge b-pending">Drawn</span>' : `<span class="badge ${fr.winner === 0 ? 'b-exact' : 'b-live'}">${name(fr.winner)}</span>`;
    return `<li><span class="small muted">${fmtDay(f.week.weekId + 'T12:00:00Z')}</span><span class="num">${sc}</span>${res}</li>`;
  }).join('');
  return `${header('SEASON', `${finals} frame${finals === 1 ? '' : 's'} played`)}
    <section class="section"><h2>Frames table</h2>
      <table class="tbl"><thead><tr><th scope="col">Player</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">Exact</th><th scope="col">Frames</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="small muted">Win a frame = 1. Drawn = 0 each. Highest break of the season earns +${HIGH_BREAK_BONUS} frames at the end.</div></section>
    <section class="section"><h2>Highest break</h2>
      ${hb ? `<div class="hb"><div><div class="small muted">Current holder · ${fmtDay(hb.weekId + 'T12:00:00Z')}</div><div style="font-size:17px;font-weight:700">${name(hb.i)}</div></div><div class="board" style="margin:0;border:0;background:none"><div class="big">${hb.total}</div></div></div>` : '<p class="small muted">No breaks yet.</p>'}
      <ul class="list">${breaks.slice(0, 5).map((x, k) => `<li><span class="small muted">#${k + 1}</span><span><b>${name(x.i)}</b> <span class="small muted">· ${fmtDay(x.weekId + 'T12:00:00Z')}</span></span><span class="num">${x.total}</span></li>`).join('')}</ul></section>
    <section class="section" style="margin-bottom:20px"><h2>Frame by frame</h2>
      ${frames ? `<ul class="list">${frames}</ul>` : '<p class="small muted">No frames yet.</p>'}</section>`;
}

function renderRules() {
  return `${header('RULES', 'How a frame works')}
    <section class="section"><ol class="rules">
      <li>Each weekend is one frame: <b>1 red</b>, <b>6 clearance games</b> (Premier League), a <b>tie-break</b> game, and <b>6 Championship games</b> to choose your free colour from.</li>
      <li>Colours come from the odds: the most one-sided game is yellow (2), the most even is black (7).</li>
      <li>Predict the red, the clearance and the tie-break before the red kicks off. You can't see each other's until then.</li>
      <li><b>The red</b> is the first game. Right result = 1 point and your free colour counts.</li>
      <li><b>Free colour:</b> pick ONE Championship game and predict it, any time before they kick off (before or after the red). Pot it and you score its value; miss it and your break ends. Your pick stays hidden from your opponent until those games start.</li>
      <li>Miss the red? No free colour, but you still play the clearance.</li>
      <li><b>Clearance:</b> yellow to black, in order. A miss ends your break.</li>
      <li>Right result = potted. Exact score = <b>double points</b>.</li>
      <li>Highest score wins the frame (1 point). Level: most exact scores, then the tie-break game. Still level: frame drawn.</li>
      <li>Highest break of the season wins a prize and ${HIGH_BREAK_BONUS} bonus frames.</li>
    </ol></section>
    <p class="small muted" style="margin:16px">Signed in as ${esc(S.user.email)}</p>`;
}

function render() {
  if (!S.user || S.me < 0 || !S.user.emailVerified) return;
  const views = { frame: renderFrame, predict: renderPredict, season: renderSeason, rules: renderRules };
  $app.innerHTML = views[S.view]() + nav();
  bind();
}

function bind() {
  $app.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => { S.view = b.dataset.nav; render(); window.scrollTo(0, 0); }));
  $app.querySelectorAll('[data-show]').forEach((b) => (b.onclick = () => { S.showPlayer = +b.dataset.show; render(); }));
  $app.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => (b.dataset.pick ? pickFree(b.dataset.pick) : (S.draft.free = { colour: null, score: [null, null] }, render()))));
  $app.querySelectorAll('input[data-g]').forEach((inp) => (inp.oninput = () => {
    const id = inp.dataset.g; const side = +inp.dataset.s; const isFree = !!inp.dataset.fr;
    const src = isFree ? S.draft.free.score : S.draft.scores[id];
    const cur = Array.isArray(src) ? src.slice() : [null, null];
    const n = parseInt(inp.value, 10);
    cur[side] = Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : null;
    if (isFree) S.draft.free.score = cur; else S.draft.scores[id] = cur;
    highlightOdds(id, cur);
    const btn = document.getElementById('save');
    if (btn && !btn.disabled && !redStarted()) {
      const { filled, total } = filledCount();
      btn.textContent = `Save predictions (${filled}/${total})`;
    }
  }));
  const save = document.getElementById('save'); if (save) save.onclick = savePreds;
  const so = document.getElementById('signout'); if (so) so.onclick = () => signOut(auth);
}

// ---------- start ----------
async function refresh() {
  await loadWeek();
  await loadPreds();
  render();
}

getRedirectResult(auth).catch((e) => console.warn(e));

function playerIndex(email) {
  const e = (email || '').toLowerCase();
  return PLAYERS.findIndex((p) => [p.email, ...(p.aliases || [])].map((x) => x.toLowerCase()).includes(e));
}

async function start(user) {
  S.user = user;
  if (!user) { renderLogin(); return; }
  S.me = playerIndex(user.email);
  if (S.me < 0) { renderNotPlayer(); return; }
  if (!user.emailVerified) { renderVerify(); return; }
  S.showPlayer = S.me;
  await refresh();
  loadSeason();
}

onAuthStateChanged(auth, start);

// Keep it fresh while the app is open
setInterval(() => { if (S.user && S.me >= 0 && S.user.emailVerified && document.visibilityState === 'visible' && S.view === 'frame') refresh(); }, 120000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.user && S.me >= 0 && S.user.emailVerified) refresh(); });
