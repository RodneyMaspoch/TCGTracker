// headsup.js — the "early signal" tier: checks reference sites and Reddit
// for mentions of upcoming drops/lotteries/restocks BEFORE they're
// confirmed on an official retailer page. Deliberately separate from the
// confirmed restock/good-price triggers in poll.js — everything here is
// labeled unconfirmed on the frontend, never silently upgraded to a
// confirmed alert.
//
// Why regex-snippet extraction instead of trying to fully parse dates out
// of prose: these are ordinary written articles (TrackaLacker, TCG Drop
// Radar, autoqueue.app), not structured data. Reliably parsing "is there a
// drawing at 5pm on the 30th" out of arbitrary English prose is a real NLP
// problem, not a regex one — attempting it and getting it wrong would be
// worse than not attempting it (per this project's standing no-fake-data
// rule: don't present a guess as a fact). Instead this flags the general
// area of text that mentions a near-term date near restock/drawing
// keywords, stores that snippet verbatim, and links to the source — a
// human reads the actual sentence rather than trusting an auto-parsed
// "confirmed" time that might be wrong.

import { insertHeadsUp } from './db.js';
import { notifyAll } from './push.js';

const KEYWORD_RE = /(drawing|lottery|restock|pre[- ]?order|drop)/i;
const RETAILER_RE = /(walmart|target|best ?buy|gamestop)/i;
// Matches a near-term date mention: a weekday name, "today"/"tomorrow", or
// a month name + day number — loose on purpose, this only decides whether
// a snippet is *worth surfacing*, not what the date actually is.
const DATE_RE = /(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{0,2}/i;

function extractSnippets(text, maxSnippets = 3) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const snippets = [];
  const re = new RegExp(KEYWORD_RE.source, 'gi');
  let match;
  while ((match = re.exec(clean)) !== null && snippets.length < maxSnippets) {
    const start = Math.max(0, match.index - 160);
    const end = Math.min(clean.length, match.index + 220);
    const window = clean.slice(start, end);
    if (RETAILER_RE.test(window) && DATE_RE.test(window)) {
      snippets.push((start > 0 ? '…' : '') + window + (end < clean.length ? '…' : ''));
    }
  }
  return snippets;
}

function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/json;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Cheap non-cryptographic hash (djb2) — good enough for change detection,
// not for security. Used so re-checking a page that hasn't changed
// doesn't insert a duplicate row / fire a duplicate push every tick.
function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const SOURCES = [
  {
    key: 'trackalacker',
    url: 'https://www.trackalacker.com/articles/news/walmart-draw-system-guide',
    game: 'pokemon',
  },
  {
    key: 'tcgdropradar',
    url: 'https://tcgdropradar.com/retailer/walmart/',
    game: 'pokemon',
  },
  {
    key: 'autoqueue',
    url: 'https://autoqueue.app/blog/how-walmart-pokemon-restock-queue-works',
    game: 'pokemon',
  },
];

// Restockd (restockd.app) — a real restock-alert app (free tier, iOS/
// Android, Discord + X community) the user says has been the most
// reliably early of anything they've used, including Walmart lottery
// windows and Pokémon Center queue activity. It has no public API, but
// its "live tracker" page is a public, no-login, server-rendered page
// listing recent detections (product, retailer, price, date) — same
// "read a public page, no key needed" shape as the other 3 sources
// above, just with structured entries instead of prose. Pokémon-only;
// restockd.app has no equivalent MTG/Lorcana tracker page (checked —
// only /brands/pokemon and /brands/needoh exist).
const RESTOCKD_URL = 'https://restockd.app/brands/pokemon';
// Matches entries shaped like "<Product Name><Retailer>·$<Price>·<Mon D, YYYY>"
// — product name and retailer often render with no space between them
// once the page's HTML collapses to plain text, so this doesn't assume
// a separator, just that one of these retailer names appears right
// before the price/date pair.
const RESTOCKD_ENTRY_RE = /([A-Z][^$\n]{5,120}?)(Target|Walmart|GameStop|Pok[ée]mon Center|Best ?Buy|Dollar General)[\s·•\-|]*\$(\d+(?:\.\d{2})?)[\s·•\-|]*([A-Z][a-z]{2}\.?\s+\d{1,2},?\s+\d{4})/g;

async function notifyHeadsUp(env, row) {
  await notifyAll(env, {
    title: '🔔 Heads up',
    body: row.title,
    url: '/heads-up',
    tag: `headsup-${row.source}`,
  });
}

async function checkWebSource(env, source) {
  let html;
  try {
    html = await fetchText(source.url);
  } catch (err) {
    console.warn(`[headsup] fetch failed for ${source.key}: ${err.message}`);
    return;
  }
  const text = stripToText(html);
  const snippets = extractSnippets(text);
  const now = new Date().toISOString();

  for (const snippet of snippets) {
    const row = {
      source: source.key,
      game: source.game,
      title: `Possible upcoming ${source.game} drawing/restock — ${source.key}`,
      snippet,
      url: source.url,
      discovered_at: now,
      dedupe_key: hashText(snippet),
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
  }
}

// Restockd's page lists actual detections, not speculative prose, so
// this skips the keyword/date-proximity heuristic extractSnippets() uses
// for the other 3 sources and parses the structured entries directly.
// These still land in the same "unconfirmed" heads_up tier rather than
// being upgraded to a confirmed event, because it's Restockd's
// detection, not one this app verified itself against the retailer page.
async function checkRestockd(env) {
  let html;
  try {
    html = await fetchText(RESTOCKD_URL);
  } catch (err) {
    console.warn(`[headsup] fetch failed for restockd: ${err.message}`);
    return;
  }
  const text = stripToText(html);
  const re = new RegExp(RESTOCKD_ENTRY_RE.source, 'g');
  const now = new Date().toISOString();
  let match;
  let count = 0;
  while ((match = re.exec(text)) !== null && count < 20) {
    const [, rawName, retailer, price, date] = match;
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (name.length < 4) continue; // too short to be a real product name — likely a bad match
    const title = `${name} — ${retailer} $${price} (${date})`;
    const row = {
      source: 'restockd',
      game: 'pokemon',
      title,
      snippet: null,
      url: RESTOCKD_URL,
      discovered_at: now,
      dedupe_key: hashText(`${name}|${retailer}|${price}|${date}`),
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
    count++;
  }
}

// Reddit's own search JSON is public and needs no API key for this volume
// of use — same "read a public page" boundary as everything else here.
async function checkReddit(env) {
  const url = 'https://www.reddit.com/r/pokemontcg/search.json?q=walmart+drawing+OR+walmart+restock&restrict_sr=1&sort=new&limit=10';
  let json;
  try {
    const text = await fetchText(url);
    json = JSON.parse(text);
  } catch (err) {
    console.warn(`[headsup] reddit fetch/parse failed: ${err.message}`);
    return;
  }
  const posts = json?.data?.children || [];
  for (const p of posts) {
    const d = p.data;
    if (!d || !d.id) continue;
    // Only surface reasonably fresh posts (last 3 days) — an old thread
    // resurfacing in search isn't a new "heads up" signal.
    const ageMs = Date.now() - (d.created_utc * 1000);
    if (ageMs > 3 * 24 * 60 * 60 * 1000) continue;
    const row = {
      source: 'reddit',
      game: 'pokemon',
      title: d.title,
      snippet: (d.selftext || '').slice(0, 300) || d.title,
      url: `https://www.reddit.com${d.permalink}`,
      discovered_at: new Date(d.created_utc * 1000).toISOString(),
      dedupe_key: d.id,
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
  }
}

// Called from poll.js's tick — one heads-up source per call, rotated, to
// keep each Cron tick cheap (same reasoning as the fast/slow lane
// staggering for retailer checks).
const CHECKERS = [
  (env) => checkWebSource(env, SOURCES[0]),
  (env) => checkWebSource(env, SOURCES[1]),
  (env) => checkWebSource(env, SOURCES[2]),
  (env) => checkReddit(env),
  (env) => checkRestockd(env),
];

export async function runHeadsUpCheck(env, index) {
  const checker = CHECKERS[index % CHECKERS.length];
  await checker(env);
}

export const HEADS_UP_CHECK_COUNT = CHECKERS.length;
