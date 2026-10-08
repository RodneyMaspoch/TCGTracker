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

const MONTH_INDEX = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};
// "September 16, 2026" / "Sep 16 2026" / "August 13, 2026" — a MONTH-DAY
// pair with an explicit year, which is what a retrospective guide article
// actually writes (unlike a live event log, which this project otherwise
// treats a bare "today"/"tomorrow"/weekday mention from as inherently
// near-term). Deliberately requires the year: without one, there's no way
// to tell "September 16" apart from a date in literally any other year,
// and guessing wrong in either direction is worse than not matching.
const EXPLICIT_DATE_RE = /(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i;

// A guide-style article (as opposed to a live event log) mixes real past
// events in with anything current — "Target restocked on Sep 16" reads
// exactly like a fresh signal to the keyword/date heuristic above even
// once that date is weeks gone. Where an explicit month+day+year is
// present, reject anything more than a few days stale rather than treat
// every mention of a retailer-near-a-date as equally "worth a push
// notification today." A snippet with no explicit year (just "today",
// "tomorrow", or a bare weekday name) is unaffected — those are already
// inherently about the near term, not a historical record.
function isStaleExplicitDate(window) {
  const m = window.match(EXPLICIT_DATE_RE);
  if (!m) return false;
  const parsed = new Date(Date.UTC(parseInt(m[3], 10), MONTH_INDEX[m[1].toLowerCase()], parseInt(m[2], 10)));
  if (isNaN(parsed.getTime())) return false;
  const daysOld = (Date.now() - parsed.getTime()) / 86400000;
  return daysOld > 3;
}

// Canonical display name for whatever RETAILER_RE actually matched —
// shared by the prose-snippet sources below and checkRestockd(), so
// "Best Buy"/"bestbuy"/"best  buy" and "Pokemon Center"/"Pokémon Center"
// all collapse to the one spelling the frontend's retailer chip shows.
function normalizeRetailer(raw) {
  if (!raw) return null;
  const low = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  if (low.includes('walmart')) return 'Walmart';
  if (low.includes('target')) return 'Target';
  if (low.includes('gamestop')) return 'GameStop';
  if (low.replace(/\s/g, '').includes('bestbuy')) return 'Best Buy';
  if (low.includes('pok')) return 'Pokémon Center';
  // Added 2026-10-05 for HotStock, which tracks a wider retailer set than
  // the original Walmart-drawing-focused RETAILER_RE did.
  if (low.includes('ebay')) return 'eBay';
  if (low.includes('antonline')) return 'Antonline';
  if (low.includes("sam's") || low.includes('sams club')) return "Sam's Club";
  if (low.includes('costco')) return 'Costco';
  return raw.trim();
}

// 2026-10-02 fix: a real page's nav/footer/sidebar legitimately repeats
// the same boilerplate sentence ("Get Restock Alerts → ... When does
// Walmart restock Pokémon cards? ...") near several unrelated headings —
// the keyword regex used to treat each of those as a fresh, distinct
// signal, which is exactly what produced 3 near-identical
// "tcgdropradar" cards in a row (same text, three slightly different
// truncation points). Now a candidate window is rejected if (a) it
// overlaps the previous ACCEPTED window's position, or (b) its
// normalized text is one already accepted this pass — either one on its
// own would have caught this specific case; both together also catch
// the same boilerplate recurring in two genuinely different places on
// the page.
function extractSnippets(text, maxSnippets = 3) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const snippets = [];
  const seenSignatures = new Set();
  let lastEnd = -Infinity;
  const re = new RegExp(KEYWORD_RE.source, 'gi');
  let match;
  while ((match = re.exec(clean)) !== null && snippets.length < maxSnippets) {
    if (match.index < lastEnd) continue;
    const start = Math.max(0, match.index - 160);
    const end = Math.min(clean.length, match.index + 220);
    const window = clean.slice(start, end);
    if (!RETAILER_RE.test(window) || !DATE_RE.test(window)) continue;
    if (isStaleExplicitDate(window)) continue;
    const signature = window.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
    if (seenSignatures.has(signature)) continue;
    seenSignatures.add(signature);
    lastEnd = end;
    snippets.push({
      text: (start > 0 ? '…' : '') + window + (end < clean.length ? '…' : ''),
      retailer: normalizeRetailer((window.match(RETAILER_RE) || [])[0]),
    });
  }
  return snippets;
}

// Distinct, scannable titles per snippet instead of the one fixed
// generic sentence every snippet from a given source used to get
// ("Possible upcoming pokemon drawing/restock — tcgdropradar" x3 in the
// screenshot that triggered this fix) — derived from the snippet's own
// first clause, never invented.
function titleFromSnippet(snippetText, game) {
  const core = snippetText.replace(/^…/, '').replace(/…$/, '').trim();
  const firstClause = (core.split(/(?<=[.?!])\s/)[0] || core).trim();
  if (!firstClause) return `Possible upcoming ${game} drawing/restock`;
  return firstClause.length > 90 ? firstClause.slice(0, 87) + '…' : firstClause;
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
    // 2026-10-04: was pointed at trackalacker.com's generic "how the
    // Walmart draw system works" explainer — a mechanics guide, not a log
    // of actual events, so it rarely had a retailer+date pairing to match
    // at all. Verified (web search + fetch) this Collector Guide page is
    // a different, far more content-dense article — it names specific
    // retailers next to specific dated events ("Target put first-wave
    // product up... on September 16, 2026", "Walmart opened preorders...
    // with Battle Decks going live on August 13, 2026"). That also means
    // it mixes in real PAST events alongside anything current, which the
    // old loose "any month+day nearby" check would have surfaced as if
    // fresh — see the new explicit-date recency filter in extractSnippets
    // below, added for exactly this source.
    key: 'trackalacker',
    url: 'https://www.trackalacker.com/articles/news/pokemon-30th-celebration-collector-guide',
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

  for (const snip of snippets) {
    const row = {
      source: source.key,
      game: source.game,
      title: titleFromSnippet(snip.text, source.game),
      snippet: snip.text,
      url: source.url,
      retailer: snip.retailer,
      discovered_at: now,
      dedupe_key: hashText(snip.text),
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
    // Retailer is now its own column (see migration 0005) instead of only
    // living inside the title string, so the frontend can render it as a
    // real chip — kept in the title too (with the price/date) since there's
    // no dedicated price/date column yet.
    const title = `${name} — $${price} (${date})`;
    const row = {
      source: 'restockd',
      game: 'pokemon',
      title,
      snippet: null,
      url: RESTOCKD_URL,
      retailer: normalizeRetailer(retailer),
      discovered_at: now,
      dedupe_key: hashText(`${name}|${retailer}|${price}|${date}`),
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
    count++;
  }
}

// HotStock (hotstock.io) — a real stock-finder app (hotstock.io/us, iOS
// app "HotStock - in-stock alerts") the user flagged (2026-10-05, same
// message as the TrackaLacker ask) as working better than anything else
// they've tried, alongside TrackaLacker. Its per-category page
// (hotstock.io/us/p/pokemon) is public, no-login, server-rendered, and
// lists IN STOCK / OUT OF STOCK across a wider retailer set than this
// project otherwise tracks (eBay, Amazon, Antonline, Sam's Club, Costco,
// alongside Walmart/Target/Best Buy/GameStop) — verified by fetching the
// page directly before writing this. Unlike Restockd's page, HotStock
// doesn't show a price or a "last checked" date per row, just a live
// in-stock/out-of-stock boolean per retailer right now — which is exactly
// what's surfaced: only the IN STOCK rows, timestamped with when THIS
// check observed them (not a claimed retailer-side timestamp that isn't
// actually on the page).
const HOTSTOCK_URL = 'https://www.hotstock.io/us/p/pokemon';
// Matches "<Retailer> <Product title...> IN STOCK" / "...OUT OF STOCK" —
// the retailer names HotStock's own page uses, immediately followed by a
// non-greedy product title and then the status that terminates the row.
const HOTSTOCK_ENTRY_RE = /(eBay|Amazon|Antonline|Best ?Buy|GameStop|Sam'?s ?[Cc]lub|Walmart|Target|Pok[ée]mon Center|Costco)\s+([^\n]{4,160}?)\s*(IN STOCK|OUT OF STOCK)/g;

async function checkHotstock(env) {
  let text;
  try {
    text = stripToText(await fetchText(HOTSTOCK_URL));
  } catch (err) {
    console.warn(`[headsup] fetch failed for hotstock: ${err.message}`);
    return;
  }
  const re = new RegExp(HOTSTOCK_ENTRY_RE.source, 'g');
  const now = new Date().toISOString();
  let match;
  let count = 0;
  while ((match = re.exec(text)) !== null && count < 20) {
    const [, retailer, rawName, status] = match;
    if (status !== 'IN STOCK') continue; // only the actionable signal, not every row HotStock tracks
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (name.length < 4) continue;
    const row = {
      source: 'hotstock',
      game: 'pokemon',
      title: `${name} — in stock at ${normalizeRetailer(retailer)}`,
      snippet: null,
      url: HOTSTOCK_URL,
      retailer: normalizeRetailer(retailer),
      discovered_at: now,
      dedupe_key: hashText(`${retailer}|${name}`),
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
    count++;
  }
}

// autoqueue.app keeps a public "last 90 days" log of Pokémon Center drop
// alerts it sent its own subscribers — exactly the "a drop happened at
// this time" signal needed here, and the closest thing to a real-time
// Pokémon Center status this project can read without defeating
// pokemoncenter.com's own Incapsula bot-protection (which this project
// won't do — see poll.js's retailerLabel comment / the PerimeterX
// write-up on Target's Redsky API for why). Explicit ask: "I just need
// to know so I can run to it" — a recent log entry here answers exactly
// that, even without the specific product.
const AUTOQUEUE_PC_URL = 'https://autoqueue.app/drops/pokemon-center';
// "Sep 30, 2026 | 11:59 AM | Browser alert sent and email alert accepted by provider"
const AUTOQUEUE_PC_ENTRY_RE = /([A-Z][a-z]{2}\s+\d{1,2},\s*\d{4})\s*\|\s*(\d{1,2}:\d{2}\s*[AP]M)\s*\|\s*([^\n|]{5,120}?)(?=[A-Z][a-z]{2}\s+\d{1,2},\s*\d{4}\s*\||$)/g;

async function checkAutoqueuePokemonCenter(env) {
  let text;
  try {
    text = stripToText(await fetchText(AUTOQUEUE_PC_URL));
  } catch (err) {
    console.warn(`[headsup] fetch failed for autoqueue-pc: ${err.message}`);
    return;
  }
  const re = new RegExp(AUTOQUEUE_PC_ENTRY_RE.source, 'g');
  let match;
  let count = 0;
  while ((match = re.exec(text)) !== null && count < 10) {
    const [, dateStr, timeStr, statusRaw] = match;
    const parsed = new Date(`${dateStr} ${timeStr}`);
    if (isNaN(parsed.getTime())) continue;
    // Only a genuinely recent entry is worth surfacing as "go now" — this
    // page's log goes back 90 days, and almost all of those rows are
    // stale history, not something to alert on.
    if (Date.now() - parsed.getTime() > 36 * 60 * 60 * 1000) continue;
    const status = statusRaw.trim().replace(/\s+/g, ' ');
    const row = {
      source: 'autoqueue-pc',
      game: 'pokemon',
      title: `Pokémon Center drop signal — ${dateStr} ${timeStr}`,
      snippet: status,
      // Points at Pokémon Center itself, not autoqueue's page — the
      // explicit ask was "clicking the alert opens the Pokémon Center
      // site so I can join the queue immediately." This log doesn't say
      // which product, so this links to the general shop rather than
      // guessing a specific (possibly wrong) product URL.
      url: 'https://www.pokemoncenter.com/',
      retailer: 'Pokémon Center',
      discovered_at: parsed.toISOString(),
      dedupe_key: `${dateStr}|${timeStr}`,
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
      retailer: normalizeRetailer((d.title.match(RETAILER_RE) || [])[0]),
      snippet: (d.selftext || '').slice(0, 300) || d.title,
      url: `https://www.reddit.com${d.permalink}`,
      discovered_at: new Date(d.created_utc * 1000).toISOString(),
      dedupe_key: d.id,
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew) await notifyHeadsUp(env, row);
  }
}

// Called from poll.js's tick.
//
// 2026-10-05: this used to check ONE source per call, rotated through a
// weighted list, on a tick gated to every HEADS_UP_EVERY_N_TICKS (default
// 5) ticks — so any single source (TrackaLacker, HotStock, etc.) only
// actually got re-checked every 20-45 minutes depending on how many
// rotation slots it had. That directly contradicts the entire point of
// this tier ("the point is to get the alert right away... one second
// late and the bots already beat me") — a 20+ minute-stale "early signal"
// isn't early. Every one of these fetches is a small, cheap HTML/JSON
// page read (same reasoning poll.js's top-of-file comment already gives
// for why the fast lane checks every Pokémon listing every tick instead
// of rotating: CPU time is actual compute, and awaiting fetch() is free,
// so running all of these concurrently costs ~nothing extra per tick
// compared to running one). So now every distinct source is checked on
// EVERY tick, concurrently — matching the fast lane's cadence. The
// weighted-rotation list is gone because weighting by repetition only
// meant something when sources took turns; once everything runs every
// tick, repeating a source in the list would just fetch the same URL
// twice in parallel for no reason.
//
// The real floor under all of this is Cloudflare's Cron Trigger
// granularity: `* * * * *` in wrangler.toml fires once a minute, and a
// Cron Trigger cannot fire more often than once a minute on any
// Cloudflare Workers plan — there's no faster schedule to move to. So
// "every tick" here means every ~60 seconds, which is as fast as this
// architecture can check at all.
const DISTINCT_CHECKERS = [
  (env) => checkWebSource(env, SOURCES[0]), // trackalacker
  (env) => checkWebSource(env, SOURCES[1]), // tcgdropradar
  (env) => checkWebSource(env, SOURCES[2]), // autoqueue blog
  (env) => checkRestockd(env),
  (env) => checkHotstock(env),
  (env) => checkReddit(env),
  (env) => checkAutoqueuePokemonCenter(env),
];

export async function runHeadsUpCheck(env) {
  const settled = await Promise.allSettled(DISTINCT_CHECKERS.map((fn) => fn(env)));
  for (const s of settled) {
    if (s.status === 'rejected') console.error('[headsup] source check rejected:', s.reason);
  }
}

// Kept exported for back-compat with anything still importing it, though
// runHeadsUpCheck no longer takes an index to mod against it.
export const HEADS_UP_CHECK_COUNT = DISTINCT_CHECKERS.length;
