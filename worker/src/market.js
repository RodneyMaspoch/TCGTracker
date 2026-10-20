// market.js — 2026-10-20. REAL TCGplayer market prices (user: "you HAVE TO
// find real pricing from TCGplayer — that is a MUST").
//
// TCGplayer stopped giving out new API keys ("We are no longer granting new
// API access at this time" — docs.tcgplayer.com). TCGCSV (tcgcsv.com) is a
// free, public daily copy of TCGplayer's own catalog + prices, including
// SEALED products (boxes, ETBs, bundles), with marketPrice = TCGplayer
// Market Price. Its rules, followed here:
//   • updated once a day — check last-updated.txt, re-sync only when newer
//   • custom User-Agent, ~100 ms between requests, well under 10k/day
//   • server-side only (never from the browser)
//
// How it runs: the 15 s ticker calls stepMarketSync() — a few requests per
// tick (Workers limit subrequests per run), so a full sync of recent sets for
// Pokémon, Magic and Lorcana takes a few minutes, once a day. The result is a
// compact list of SEALED products + market prices per game, saved as ONE row
// per game in a tiny key-value table (3 rows to read, not thousands), and the
// matched market price is written to each tracked product's tcgplayer_ref.

const BASE = 'https://tcgcsv.com/tcgplayer';
const UA = { 'User-Agent': 'TCGTracker/1.0 (personal restock tracker)', Accept: 'application/json' };
const GAMES = [
  { game: 'pokemon', match: /^pok[eé]mon$/i, maxGroups: 45 },
  { game: 'mtg', match: /^magic/i, maxGroups: 60 },
  { game: 'lorcana', match: /lorcana/i, maxGroups: 25 },
];
const RECENT_MONTHS = 30;
const PER_TICK = 6; // requests per tick

async function getJson(url) {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`tcgcsv HTTP ${res.status} for ${url}`);
  return res.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function ensureKv(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT)').run();
}
export async function readKv(env, k) {
  const row = await env.DB.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
  return row ? JSON.parse(row.v) : null;
}
async function writeKv(env, k, v) {
  await env.DB.prepare('INSERT INTO kv (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at')
    .bind(k, JSON.stringify(v), new Date().toISOString()).run();
}

// A product is "sealed" when TCGplayer gives it no card number / rarity.
function isSealed(p) {
  const ext = p.extendedData || [];
  if (ext.some((e) => /^(Number|Rarity)$/i.test(e.name))) return false;
  if (/code card|digital|online code/i.test(p.name)) return false;
  return true;
}

// ---------------- incremental sync (runs inside the ticker) ----------------
let job = null;          // { stamp, queue: [{game, catId, groupId, groupName}], out: {game: [...]}, started }
let lastStamp = null;    // last-updated.txt value we finished syncing
let lastCheck = 0;

export async function stepMarketSync(env) {
  const now = Date.now();
  if (!job) {
    if (now - lastCheck < 60 * 60 * 1000) return; // look for a new TCGCSV day once an hour
    lastCheck = now;
    await ensureKv(env);
    const stampRes = await fetch('https://tcgcsv.com/last-updated.txt', { headers: UA });
    const stamp = stampRes.ok ? (await stampRes.text()).trim() : String(new Date().toISOString().slice(0, 10));
    if (!lastStamp) {
      const meta = await readKv(env, 'market:meta').catch(() => null);
      lastStamp = meta && meta.stamp;
    }
    if (stamp && stamp === lastStamp) return; // already have today's prices
    // Build the work queue: categories → recent groups (sets) per game.
    const cats = (await getJson(`${BASE}/categories`)).results || [];
    const queue = [];
    for (const g of GAMES) {
      const cat = cats.find((c) => g.match.test(c.displayName || c.name || ''));
      if (!cat) continue;
      await sleep(100);
      const groups = ((await getJson(`${BASE}/${cat.categoryId}/groups`)).results || [])
        .filter((gr) => !gr.publishedOn || new Date(gr.publishedOn) > new Date(now - RECENT_MONTHS * 30 * 86400000))
        .sort((a, b) => new Date(b.publishedOn || 0) - new Date(a.publishedOn || 0))
        .slice(0, g.maxGroups);
      for (const gr of groups) queue.push({ game: g.game, catId: cat.categoryId, groupId: gr.groupId, groupName: gr.name });
    }
    job = { stamp, queue, out: { pokemon: [], mtg: [], lorcana: [] }, started: now };
    console.log(`[market] TCGCSV sync started: ${queue.length} sets`);
    return;
  }

  // Work through a few sets per tick (2 requests each: products + prices).
  for (let i = 0; i < PER_TICK / 2 && job.queue.length; i++) {
    const g = job.queue.shift();
    try {
      const products = (await getJson(`${BASE}/${g.catId}/${g.groupId}/products`)).results || [];
      await sleep(100);
      const prices = (await getJson(`${BASE}/${g.catId}/${g.groupId}/prices`)).results || [];
      await sleep(100);
      const priceById = new Map();
      for (const p of prices) {
        const v = p.marketPrice ?? p.midPrice ?? null;
        if (v == null) continue;
        const prev = priceById.get(p.productId);
        if (prev == null || (p.subTypeName === 'Normal')) priceById.set(p.productId, v);
      }
      for (const p of products) {
        if (!isSealed(p)) continue;
        const market = priceById.get(p.productId);
        if (market == null) continue;
        job.out[g.game].push({ id: p.productId, n: p.name, s: g.groupName, m: Math.round(market * 100) / 100, u: p.url || `https://www.tcgplayer.com/product/${p.productId}`, i: p.imageUrl || null });
      }
    } catch (err) {
      console.warn(`[market] set ${g.groupName} failed: ${err.message}`);
    }
  }
  if (job.queue.length) return;

  // Done: save one row per game, then update tracked products.
  for (const [game, list] of Object.entries(job.out)) {
    if (list.length) await writeKv(env, `market:${game}`, list);
  }
  await writeKv(env, 'market:meta', { stamp: job.stamp, at: new Date().toISOString(), counts: Object.fromEntries(Object.entries(job.out).map(([k, v]) => [k, v.length])) });
  await updateTrackedRefs(env, job.out);
  console.log('[market] TCGCSV sync done', Object.fromEntries(Object.entries(job.out).map(([k, v]) => [k, v.length])));
  lastStamp = job.stamp;
  job = null;
}

async function updateTrackedRefs(env, index) {
  const { results } = await env.DB.prepare("SELECT id, game, name, tcgplayer_ref FROM products WHERE game IN ('pokemon','mtg','lorcana')").all();
  const now = new Date().toISOString();
  const stmts = [];
  for (const p of results) {
    const hit = bestMatch(p.name, index[p.game] || []);
    if (!hit || hit.m === p.tcgplayer_ref) continue;
    stmts.push(env.DB.prepare('UPDATE products SET tcgplayer_ref = ?, tcgplayer_ref_checked_at = ? WHERE id = ?').bind(hit.m, now, p.id));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

// ---------------- name matching ----------------
const STOP = new Set(['the', 'a', 'of', 'and', 'tcg', 'trading', 'card', 'game', 'pokemon', 'pokémon', 'magic', 'gathering', 'disney', 'lorcana', 'mtg', 'x', 'preorder', 'party', '3rd', 'seller', 'walmart', 'target', 'exclusive', 'with', 'for', 'sealed', 'new']);
const SYN = { etb: ['elite', 'trainer', 'box'], upc: ['ultra', 'premium', 'collection'], display: ['box'], booster_display: ['booster', 'box'] };
function words(s) {
  const out = [];
  for (const w of String(s).toLowerCase().replace(/[’']/g, '').replace(/&/g, ' ').replace(/[^a-z0-9é ]+/g, ' ').split(/\s+/)) {
    if (!w || STOP.has(w)) continue;
    if (SYN[w]) out.push(...SYN[w]); else out.push(w === 'display' ? 'box' : w);
  }
  return out;
}
// Every meaningful word of OUR name must appear in TCGplayer's name+set; among
// hits, the one with the fewest extra words wins (so "Elite Trainer Box" won't
// match the "Pokemon Center Elite Trainer Box" or an 8-box case).
export function bestMatch(name, list) {
  const need = words(name);
  if (!need.length) return null;
  const wantsPC = /pok[eé]mon center/i.test(name);
  const wantsCase = /\bcase\b/i.test(name);
  let best = null; let bestExtra = Infinity;
  for (const it of list) {
    if (!wantsPC && /pokemon center/i.test(it.n)) continue;
    if (!wantsCase && /\bcase\b/i.test(it.n)) continue;
    const have = new Set(words(`${it.n} ${it.s}`));
    if (!need.every((w) => have.has(w) || have.has(w.replace(/s$/, '')) || have.has(`${w}s`))) continue;
    const extra = words(it.n).filter((w) => !need.includes(w)).length;
    if (extra < bestExtra) { best = it; bestExtra = extra; }
  }
  return best;
}
