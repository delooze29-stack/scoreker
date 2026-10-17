// ScoreKer reminders — run hourly over the weekend by .github/workflows/reminders.yml
//
// Nudges a player who still hasn't entered (phone notification + email):
//   'eve'     the evening before the red      (main predictions missing)
//   'morning' in the 3 hours before the red    (main predictions or free colour missing)
//   'free'    in the 2 hours before the free-colour games kick off (free colour missing)
// And once every game has finished: a 'full time' phone notification to both players.
// Each one goes once per player per weekend (remembered in data/reminders.json).
//
// Phone notifications need the VAPID_PRIVATE_KEY secret; emails need GMAIL_APP_PASSWORD
// (and optionally GMAIL_USER). Either can be set on its own.
// TEST=1 sends a test notification and/or email to Mathew only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseConfig, PLAYERS, VAPID_PUBLIC_KEY } from '../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SITE = 'https://delooze29-stack.github.io/scoreker/';
const H = 3600000;

const USER = process.env.GMAIL_USER || PLAYERS[0].email;
const PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const VAPID_PRIVATE = (process.env.VAPID_PRIVATE_KEY || '').trim();
const TEST = process.env.TEST === '1' || process.env.TEST === 'true';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// ---------- Firestore (public REST reads) ----------
async function readStatus(weekId, email) {
  const r = await fetch(`${FS_BASE}/weeks/${weekId}/status/${encodeURIComponent(email)}?key=${firebaseConfig.apiKey}`);
  if (r.status === 404) return null;
  if (r.status === 403) throw new Error('Firestore said no — the status rule needs "allow read: if true;" (see firestore.rules).');
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
  const f = (await r.json()).fields || {};
  const num = (k) => (f[k] ? Number(f[k].integerValue ?? f[k].doubleValue ?? 0) : 0);
  const bool = (k) => (f[k] && 'booleanValue' in f[k] ? f[k].booleanValue : undefined);
  const filled = num('filled'), total = num('total');
  return { filled, total, main: bool('main') ?? filled >= total - 1, free: bool('free') ?? (total > 0 && filled >= total) };
}

// email -> [subscription, ...]
async function readDevices() {
  const out = {};
  let token = '';
  do {
    const r = await fetch(`${FS_BASE}/push?pageSize=300&key=${firebaseConfig.apiKey}${token ? `&pageToken=${token}` : ''}`);
    if (r.status === 403) { console.warn('Can\'t read the push list — add the "match /push" block from firestore.rules.'); return out; }
    if (!r.ok) { console.warn(`Push list ${r.status}`); return out; }
    const j = await r.json();
    for (const d of j.documents || []) {
      const email = d.fields?.email?.stringValue;
      try { const sub = JSON.parse(d.fields?.sub?.stringValue || ''); if (email && sub.endpoint) (out[email] ||= []).push(sub); } catch {}
    }
    token = j.nextPageToken || '';
  } while (token);
  return out;
}

// ---------- senders ----------
let webpush = null;
async function pushTo(devices, email, payload) {
  const subs = devices[email.toLowerCase()] || [];
  if (!VAPID_PRIVATE || !subs.length) return 0;
  if (!webpush) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(`mailto:${USER}`, VAPID_PUBLIC_KEY, VAPID_PRIVATE);
  }
  let ok = 0;
  for (const sub of subs) {
    try { await webpush.sendNotification(sub, JSON.stringify({ url: SITE, ...payload }), { TTL: 4 * 3600 }); ok++; }
    catch (e) { console.warn(`  push failed (${e.statusCode || e.message})${[404, 410].includes(e.statusCode) ? ' — that phone has switched notifications off' : ''}`); }
  }
  return ok;
}

let transport = null;
async function emailTo(to, m) {
  if (!PASS) return false;
  if (!transport) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({ service: 'gmail', auth: { user: USER, pass: PASS } });
  }
  await transport.sendMail({ from: `ScoreKer <${USER}>`, to, subject: m.subject, text: m.text, html: m.html });
  return true;
}

// ---------- wording ----------
function message(kind, player, week, st) {
  const red = `${week.red.home} v ${week.red.away}`;
  const lines = [`Hi ${player.name},`, ''];
  let subject, push;
  if (kind === 'free') {
    subject = `ScoreKer: pick your free colour before ${fmt(week.freeLock)}`;
    push = { title: 'Pick your free colour 🎱', body: `The Championship games kick off at ${fmt(week.freeLock)}. If you potted the red, choose one to go for.` };
    lines.push(
      `You haven't picked your free colour yet. The Championship games kick off at ${fmt(week.freeLock)}, and after that it's too late.`,
      '',
      `If you potted the red (${red}), choose one game to go for. Miss the pick and your break ends there.`,
    );
  } else {
    const what = !st ? "you haven't entered any predictions yet"
      : !st.main ? `you've only entered ${st.filled} of ${st.total}`
      : "you haven't picked your free colour yet";
    subject = kind === 'eve'
      ? `ScoreKer: this weekend's frame is ready — red is ${red}`
      : `ScoreKer: predictions lock at ${fmt(week.redKickoff)}`;
    push = kind === 'eve'
      ? { title: "This weekend's frame is ready 🎱", body: `The red is ${red}, ${fmt(week.redKickoff)}. Get your predictions in.` }
      : { title: `Predictions lock at ${fmt(week.redKickoff).split(' ')[1]}`, body: `Reminder: ${what}. The red is ${red}.` };
    lines.push(
      `Quick reminder — ${what}.`,
      '',
      `The red is ${red}, kicking off ${fmt(week.redKickoff)}. Your red, clearance and tie-break predictions lock then.`,
      `Free colour (one Championship game) can be picked until ${fmt(week.freeLock)}.`,
    );
    if (!st) lines.push('', `First time? Open the link, enter ${player.email} and a password, tap "Create account", then click the confirmation email (check junk).`);
  }
  lines.push('', SITE, '', '— ScoreKer');
  const text = lines.join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222">${lines
    .map((l) => (l === SITE ? `<p><a href="${SITE}" style="display:inline-block;background:#F5B700;color:#1A1300;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Open ScoreKer</a></p>` : l ? `<p style="margin:0 0 8px">${l.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>` : ''))
    .join('')}</div>`;
  return { subject, text, html, push: { ...push, tag: `sk-${week.weekId}-${kind}` } };
}

// ---------- main ----------
async function main() {
  if (!PASS && !VAPID_PRIVATE) { console.log('Neither GMAIL_APP_PASSWORD nor VAPID_PRIVATE_KEY is set — reminders are switched off.'); return; }
  console.log(`Channels: ${VAPID_PRIVATE ? 'phone notifications' : ''}${VAPID_PRIVATE && PASS ? ' + ' : ''}${PASS ? 'email' : ''}`);
  const devices = VAPID_PRIVATE ? await readDevices() : {};
  for (const p of PLAYERS) console.log(`${p.name}: ${(devices[p.email.toLowerCase()] || []).length} phone(s) with notifications on`);

  if (TEST) {
    const me = PLAYERS[0];
    const n = await pushTo(devices, me.email, { title: 'ScoreKer test ✓', body: 'Notifications are working.', tag: 'sk-test' });
    const e = await emailTo(USER, { subject: 'ScoreKer: test email ✓', text: `Reminders are working.\n\n${SITE}`, html: `<p>Reminders are working.</p><p><a href="${SITE}">${SITE}</a></p>` });
    console.log(`Test: ${n} notification(s), ${e ? 'email sent' : 'no email'} for ${me.name}.`);
    return;
  }

  const week = await readJSON(path.join(DATA, 'week.json'), null);
  if (!week || week.empty) { console.log('No frame this weekend.'); return; }
  const now = Date.now();
  const red = Date.parse(week.redKickoff), lock = Date.parse(week.freeLock);

  const logFile = path.join(DATA, 'reminders.json');
  const log = await readJSON(logFile, {});
  const sent = (log[week.weekId] ||= {});
  let changed = false;

  if (now < lock) {
    for (const p of PLAYERS) {
      const email = p.email.toLowerCase();
      const st = await readStatus(week.weekId, email);
      const done = sent[email] || [];
      let kind = null;
      if (now >= red - 22 * H && now < red - 12 * H && !(st && st.main)) kind = 'eve';
      else if (now >= red - 3 * H && now < red && !(st && st.main && st.free)) kind = 'morning';
      else if (now >= red && now >= lock - 2 * H && now < lock && st && !st.free) kind = 'free';
      console.log(`${p.name}: ${st ? `${st.filled}/${st.total} main=${st.main} free=${st.free}` : 'not entered'} → ${kind || 'nothing due'}${kind && done.includes(kind) ? ' (already sent)' : ''}`);
      if (!kind || done.includes(kind)) continue;
      const m = message(kind, p, week, st);
      const n = await pushTo(devices, email, m.push);
      const e = await emailTo(p.email, m);
      console.log(`  sent: ${n} notification(s)${e ? ' + email' : ''} — ${m.subject}`);
      sent[email] = [...done, kind];
      changed = true;
    }
  } else {
    // Full time: every game in the frame has finished
    const games = [week.red, ...week.free, ...week.clear, week.tiebreak].filter(Boolean);
    const allDone = games.every((g) => g.status === 'FT');
    console.log(`Locked. ${games.filter((g) => g.status === 'FT').length}/${games.length} games finished.`);
    if (allDone && !sent._fulltime) {
      for (const p of PLAYERS) {
        const n = await pushTo(devices, p.email, { title: 'Full time 🎱', body: "The frame's finished — see who won and how your break went.", tag: `sk-${week.weekId}-ft` });
        console.log(`  full-time alert to ${p.name}: ${n} notification(s)`);
      }
      sent._fulltime = true;
      changed = true;
    }
  }

  if (changed) {
    for (const k of Object.keys(log).sort().slice(0, -6)) delete log[k];
    await fs.writeFile(logFile, JSON.stringify(log, null, 2) + '\n');
  }
}

await main();
