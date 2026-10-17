// ScoreKer reminder emails — run hourly over the weekend by .github/workflows/reminders.yml
//
// Emails a player who still hasn't entered:
//   'eve'     the evening before the red      (main predictions missing)
//   'morning' in the 3 hours before the red    (main predictions or free colour missing)
//   'free'    in the 2 hours before the free-colour games kick off (free colour missing)
// Each reminder goes once per player per weekend (remembered in data/reminders.json).
//
// Sends from Gmail. Needs the GMAIL_APP_PASSWORD secret (and optionally GMAIL_USER).
// TEST=1 sends one test email to the sender address only.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { firebaseConfig, PLAYERS } from '../js/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const SITE = 'https://delooze29-stack.github.io/scoreker/';
const H = 3600000;

const USER = process.env.GMAIL_USER || PLAYERS[0].email;
const PASS = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
const TEST = process.env.TEST === '1' || process.env.TEST === 'true';

const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit' });

async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

// Read a player's "status" doc (counts only) from Firestore's public REST API
async function readStatus(weekId, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/weeks/${weekId}/status/${encodeURIComponent(email)}?key=${firebaseConfig.apiKey}`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (r.status === 403) throw new Error('Firestore said no — the status rule needs "allow read: if true;" (see firestore.rules).');
  if (!r.ok) throw new Error(`Firestore ${r.status}: ${await r.text()}`);
  const f = (await r.json()).fields || {};
  const num = (k) => (f[k] ? Number(f[k].integerValue ?? f[k].doubleValue ?? 0) : 0);
  const bool = (k) => (f[k] && 'booleanValue' in f[k] ? f[k].booleanValue : undefined);
  const filled = num('filled'), total = num('total');
  return {
    filled, total,
    main: bool('main') ?? filled >= total - 1,
    free: bool('free') ?? (total > 0 && filled >= total),
  };
}

function message(kind, player, week, st) {
  const red = `${week.red.home} v ${week.red.away}`;
  const lines = [`Hi ${player.name},`, ''];
  let subject;
  if (kind === 'free') {
    subject = `ScoreKer: pick your free colour before ${fmt(week.freeLock)}`;
    lines.push(
      `You haven't picked your free colour yet. The Championship games kick off at ${fmt(week.freeLock)}, and after that it's too late.`,
      '',
      `If you potted the red (${red}), choose one game to go for. Miss the pick and your break ends there.`,
    );
  } else {
    subject = kind === 'eve'
      ? `ScoreKer: this weekend's frame is ready — red is ${red}`
      : `ScoreKer: predictions lock at ${fmt(week.redKickoff)}`;
    const what = !st ? "you haven't entered any predictions yet"
      : !st.main ? `you've only entered ${st.filled} of ${st.total}`
      : "you haven't picked your free colour yet";
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
  return { subject, text, html };
}

async function mailer() {
  const nodemailer = (await import('nodemailer')).default;
  return nodemailer.createTransport({ service: 'gmail', auth: { user: USER, pass: PASS } });
}

async function main() {
  if (!PASS) { console.log('GMAIL_APP_PASSWORD is not set — reminders are switched off.'); return; }

  if (TEST) {
    const t = await mailer();
    await t.sendMail({ from: `ScoreKer <${USER}>`, to: USER, subject: 'ScoreKer: test email ✓', text: `Reminders are working.\n\n${SITE}` });
    console.log(`Test email sent to ${USER}.`);
    return;
  }

  const week = await readJSON(path.join(DATA, 'week.json'), null);
  if (!week || week.empty) { console.log('No frame this weekend.'); return; }
  const now = Date.now();
  const red = Date.parse(week.redKickoff), lock = Date.parse(week.freeLock);
  if (now > lock) { console.log('Everything is locked for this weekend.'); return; }

  const logFile = path.join(DATA, 'reminders.json');
  const log = await readJSON(logFile, {});
  const sent = (log[week.weekId] ||= {});
  let t = null, changed = false;

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
    t ||= await mailer();
    const m = message(kind, p, week, st);
    await t.sendMail({ from: `ScoreKer <${USER}>`, to: p.email, ...m });
    sent[email] = [...done, kind];
    changed = true;
    console.log(`  emailed ${p.email}: ${m.subject}`);
  }

  if (changed) {
    for (const k of Object.keys(log).sort().slice(0, -6)) delete log[k];
    await fs.writeFile(logFile, JSON.stringify(log, null, 2) + '\n');
  }
}

await main();
