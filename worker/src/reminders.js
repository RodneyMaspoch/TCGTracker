// reminders.js — 2026-10-16, user request: "will I know there's one upcoming,
// like a drop in 2 hours or tomorrow at 9am?"
//
// 1) LAUNCH REMINDERS for announced release / drop / event dates (the same
//    dated items shown in each page's "Coming up"). Pushes:
//      • the evening before (7:00 PM ET)
//      • the morning of (8:00 AM ET) when no exact time is known
//      • 1 hour before, when an exact launch time IS known
// 2) DATED TIPS → REMINDERS. When an early-signal tip (Restockd, TrackaLacker,
//    autoqueue, …) mentions a specific upcoming date/time ("Pokémon Center
//    drop tomorrow 9am ET"), it's saved and gets 1-hour and 15-minute
//    reminders. Always labelled unconfirmed.
//
// Every reminder fires at most once (tracked in the events table), and only
// inside a short window after its moment — never late.

import { notifyAll } from './push.js';
import { insertEvent } from './db.js';

// Keep in sync with the "Coming up" lists in public/tracker-app.js.
// time = 'HH:MM' Eastern when officially announced, otherwise omitted.
const LAUNCHES = [
  { game: 'pokemon', name: "Deck Crafter's Collection", date: '2026-10-23' },
  { game: 'pokemon', name: 'Delta Reign — Elite Trainer Box', date: '2026-11-06' },
  { game: 'pokemon', name: 'ME7: Aura Seeker (Japan)', date: '2026-11-27' },
  { game: 'mtg', name: 'Reality Fracture — Secret Lair Bundle', date: '2026-10-23' },
  { game: 'mtg', name: 'SCG CON: Hartford', date: '2026-10-23' },
  { game: 'mtg', name: "Magic Presents: All Leylines' Eve", date: '2026-10-30' },
  { game: 'mtg', name: 'Star Trek Prerelease', date: '2026-11-06' },
  { game: 'mtg', name: 'Star Trek', date: '2026-11-13' },
  { game: 'mtg', name: 'MagicCon: Atlanta', date: '2026-11-13' },
  { game: 'mtg', name: 'Secret Lair × MSCHF: The Zeta Set (24-hr window)', date: '2026-12-09' },
  { game: 'lorcana', name: 'Hyperia City', date: '2026-10-23' },
  { game: 'lorcana', name: "Hyperia City — Illumineer's Trove", date: '2026-10-23' },
  { game: 'lorcana', name: 'Lorcana Challenge — Bangkok', date: '2026-10-30' },
  { game: 'lorcana', name: 'Hyperia City — Beast Gift Box', date: '2026-11-13' },
  { game: 'lorcana', name: 'Lorcana Challenge — London', date: '2026-11-13' },
  { game: 'lorcana', name: 'Lorcana World Championship', date: '2026-12-04' },
];
const GAME_PAGE = { pokemon: '/pokemon', mtg: '/', lorcana: '/lorcana' };

const GRACE_MS = 5 * 60 * 1000; // a reminder only fires within 5 min of its moment

// ---- Eastern-time helpers (EDT mid-Mar..early-Nov, EST otherwise) ----
function etOffsetHours(y, m, d) {
  // 2nd Sunday of March → 1st Sunday of November = EDT (UTC-4)
  const nthSunday = (month, n) => { const first = new Date(Date.UTC(y, month, 1)).getUTCDay(); return 1 + ((7 - first) % 7) + 7 * (n - 1); };
  const start = Date.UTC(y, 2, nthSunday(2, 2), 7);
  const end = Date.UTC(y, 10, nthSunday(10, 1), 6);
  const t = Date.UTC(y, m, d, 12);
  return t >= start && t < end ? 4 : 5;
}
export function etToDate(y, m, d, hh, mm) {
  return new Date(Date.UTC(y, m, d, hh + etOffsetHours(y, m, d), mm));
}
const TZ_SHIFT = { ET: 0, EDT: 0, EST: 0, CT: 1, CDT: 1, CST: 1, MT: 2, PT: 3, PDT: 3, PST: 3 }; // hours behind ET

// ---- dedupe via the events table ----
async function alreadySent(env, key) {
  const row = await env.DB.prepare(
    `SELECT 1 FROM events WHERE kind IN ('launch_reminder','tip_reminder') AND data_json LIKE ? LIMIT 1`
  ).bind(`%"key":"${key}"%`).first();
  return !!row;
}
async function send(env, kind, key, title, body, url, productId = null) {
  if (await alreadySent(env, key)) return;
  await insertEvent(env, { created_at: new Date().toISOString(), kind, product_id: productId, message: body, data_json: JSON.stringify({ key, url }) });
  await notifyAll(env, { title, body, url, tag: key });
}
const due = (target, now) => now >= target.getTime() && now < target.getTime() + GRACE_MS;

// ---- 1) launch reminders ----
async function runLaunchReminders(env, now) {
  for (const l of LAUNCHES) {
    const [y, mo, d] = l.date.split('-').map(Number);
    const m = mo - 1;
    const prev = new Date(Date.UTC(y, m, d - 1));
    const eveBefore = etToDate(prev.getUTCFullYear(), prev.getUTCMonth(), prev.getUTCDate(), 19, 0);
    const slug = `${l.game}-${l.name}-${l.date}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const url = GAME_PAGE[l.game] || '/';
    if (due(eveBefore, now)) {
      await send(env, 'launch_reminder', `${slug}-eve`, '📅 Tomorrow', `${l.name} — tomorrow${l.time ? ` at ${l.time} ET` : ''}`, url);
    }
    if (l.time) {
      const [hh, mm] = l.time.split(':').map(Number);
      const start = etToDate(y, m, d, hh, mm);
      if (due(new Date(start.getTime() - 3600000), now)) {
        await send(env, 'launch_reminder', `${slug}-1h`, '⏰ In 1 hour', `${l.name} — starts at ${l.time} ET`, url);
      }
    } else {
      const morning = etToDate(y, m, d, 8, 0);
      if (due(morning, now)) await send(env, 'launch_reminder', `${slug}-am`, '📅 Today', `${l.name} — today`, url);
    }
  }
}

// ---- 2) dated tips → reminders ----
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// Finds e.g. "Oct 17 at 9am ET", "October 17, 2026 9:00 AM PT", "tomorrow at 9 AM ET", "today 3pm".
export function parseTipTime(text, now = new Date()) {
  const t = String(text);
  const time = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\s*(ET|EDT|EST|CT|CDT|CST|MT|PT|PDT|PST)?/i;
  let y; let m; let d;
  const rel = t.match(new RegExp(`\\b(today|tonight|tomorrow)\\b[^.]{0,20}?${time.source}`, 'i'));
  const abs = t.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?[^.]{0,12}?${time.source}`, 'i'));
  let tm;
  if (abs) {
    m = MONTHS.indexOf(abs[1].toLowerCase().slice(0, 3)); d = Number(abs[2]); y = abs[3] ? Number(abs[3]) : now.getUTCFullYear();
    tm = abs.slice(4);
  } else if (rel) {
    const base = new Date(now.getTime() - 4 * 3600000); // roughly "today" in ET
    if (/tomorrow/i.test(rel[1])) base.setUTCDate(base.getUTCDate() + 1);
    y = base.getUTCFullYear(); m = base.getUTCMonth(); d = base.getUTCDate();
    tm = rel.slice(2);
  } else return null;
  let hh = Number(tm[0]) % 12; if (/p/i.test(tm[2])) hh += 12;
  const mm = Number(tm[1] || 0);
  const shift = TZ_SHIFT[(tm[3] || 'ET').toUpperCase()] ?? 0;
  const at = etToDate(y, m, d, hh + shift, mm);
  const ahead = at.getTime() - now.getTime();
  if (ahead < 10 * 60000 || ahead > 7 * 86400000) return null; // only real upcoming times (10 min – 7 days out)
  return at;
}

// 2026-10-20 — a DAY with no time ("likely this Wednesday (10/21)",
// "Oct 21", "tomorrow"). Returns {y, m, d} in Eastern time when it is
// today .. 7 days ahead, else null.
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function parseTipDay(text, now = new Date()) {
  const t = String(text).toLowerCase();
  const etNow = new Date(now.getTime() - 4 * 3600000); // close enough to "today" in ET
  const today = Date.UTC(etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate());
  const pick = (y, m, d) => {
    const ts = Date.UTC(y, m, d);
    const days = (ts - today) / 86400000;
    return days >= 0 && days <= 7 ? { y, m, d } : null;
  };
  let mm = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (mm) return pick(etNow.getUTCFullYear(), Number(mm[1]) - 1, Number(mm[2])); // explicit date wins, even if past
  mm = t.match(new RegExp(`\\b(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (mm) return pick(etNow.getUTCFullYear(), MONTHS.indexOf(mm[1]), Number(mm[2]));
  if (/\btoday\b|\btonight\b/.test(t)) return pick(etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate());
  if (/\btomorrow\b/.test(t)) return pick(etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate() + 1);
  const wd = t.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (wd) {
    const ahead = (WEEKDAYS.indexOf(wd[1]) - etNow.getUTCDay() + 7) % 7;
    return pick(etNow.getUTCFullYear(), etNow.getUTCMonth(), etNow.getUTCDate() + ahead);
  }
  return null;
}

// Called by headsup.js for each NEW tip.
export async function scheduleTipIfDated(env, row) {
  const text = `${row.title} ${row.snippet || ''}`;
  const key = `tip-${row.source}-${row.dedupe_key}`.replace(/[^a-zA-Z0-9-]+/g, '-').slice(0, 120);
  const at = parseTipTime(text);
  let data;
  if (at) {
    data = { key, at: at.toISOString(), url: row.url || '/heads-up', title: row.title };
  } else {
    const day = parseTipDay(text);
    if (!day) return;
    const dayAt = etToDate(day.y, day.m, day.d, 8, 0); // 8:00 AM ET that day
    data = { key, at: dayAt.toISOString(), dayOnly: true, url: row.url || '/heads-up', title: row.title };
  }
  await env.DB.prepare(`INSERT INTO events (created_at, kind, product_id, message, data_json) VALUES (?, 'tip_scheduled', NULL, ?, ?)`)
    .bind(new Date().toISOString(), `Upcoming (unconfirmed): ${row.title}`, JSON.stringify(data)).run();
}

async function runTipReminders(env, now) {
  const since = new Date(now - 8 * 86400000).toISOString();
  const { results } = await env.DB.prepare(`SELECT data_json FROM events WHERE kind = 'tip_scheduled' AND created_at > ? ORDER BY id DESC LIMIT 50`).bind(since).all();
  for (const r of results) {
    let d; try { d = JSON.parse(r.data_json); } catch (_) { continue; }
    const at = new Date(d.at);
    if (d.dayOnly) {
      // Day known, time not: evening before (7 PM ET) + morning of (8 AM ET).
      const eve = new Date(at.getTime() - 13 * 3600000);
      if (due(eve, now)) await send(env, 'tip_reminder', `${d.key}-eve`, '📅 Tomorrow (unconfirmed)', d.title, d.url);
      if (due(at, now)) await send(env, 'tip_reminder', `${d.key}-am`, '📅 Today (unconfirmed)', d.title, d.url);
      continue;
    }
    const when = at.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (due(new Date(at.getTime() - 3600000), now)) await send(env, 'tip_reminder', `${d.key}-1h`, '⏰ In 1 hour (unconfirmed)', `${d.title} — ${when} ET`, d.url);
    if (due(new Date(at.getTime() - 15 * 60000), now)) await send(env, 'tip_reminder', `${d.key}-15m`, '⏰ In 15 minutes (unconfirmed)', `${d.title} — ${when} ET`, d.url);
  }
}

export async function runReminders(env) {
  const now = Date.now();
  await runLaunchReminders(env, now).catch((err) => console.error('[reminders] launch:', err));
  await runTipReminders(env, now).catch((err) => console.error('[reminders] tips:', err));
}
