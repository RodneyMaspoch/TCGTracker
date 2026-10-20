// newskus.js — 2026-10-16. "Catch it the moment Walmart adds it."
// Instead of waiting for another app to report a new product, this asks
// Walmart's official product feed directly (walmart-io.js) what Pokémon /
// MTG / Lorcana items exist, SOLD BY WALMART only, and alerts on any item
// ID it has never seen before — even before it is in stock.
//
// Rotates one game per run so the API call volume stays modest.
// Seen item IDs are kept in heads_up (source 'walmart-seen' for the
// silent first-run baseline, 'walmart-new' for real new finds; both hidden
// /shown by getHeadsUp accordingly) — no migration needed.

import { walmartCatalog } from './walmart-io.js';
import { nintendoCatalog } from './nintendo-algolia.js';
import { insertHeadsUp } from './db.js';
import { notifyAll } from './push.js';

const GAMES = ['pokemon', 'mtg', 'lorcana'];
const GAME_NAME = { pokemon: 'Pokémon', mtg: 'MTG', lorcana: 'Lorcana' };

// 2026-10-20 — "seen" item IDs now live in their own small table
// (seen_items, migration 0013) plus an in-memory copy, instead of hundreds of
// hidden rows in heads_up that every Heads-Up / ticker request had to scan
// past. If the table doesn't exist yet, these checks simply don't run.
const seenCache = new Map(); // store -> Set of keys
async function loadSeen(env, store) {
  if (seenCache.has(store)) return seenCache.get(store);
  const { results } = await env.DB.prepare('SELECT item_key FROM seen_items WHERE store = ?').bind(store).all();
  const set = new Set(results.map((r) => r.item_key));
  seenCache.set(store, set);
  return set;
}
async function markSeen(env, store, keys) {
  if (!keys.length) return;
  const now = new Date().toISOString();
  const stmts = keys.map((k) => env.DB.prepare('INSERT OR IGNORE INTO seen_items (store, item_key, first_seen) VALUES (?, ?, ?)').bind(store, k, now));
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  const set = seenCache.get(store);
  for (const k of keys) set.add(k);
}

export async function checkNewWalmartSkus(env, runIndex) {
  const game = GAMES[runIndex % GAMES.length];
  const store = `walmart-${game}`;
  const seen = await loadSeen(env, store);
  const items = await walmartCatalog(env, game);
  const baseline = seen.size > 0;
  const fresh = items.filter((it) => !seen.has(String(it.itemId)));
  const now = new Date().toISOString();
  await markSeen(env, store, baseline ? fresh.map((it) => String(it.itemId)) : ['_baseline', ...fresh.map((it) => String(it.itemId))]);
  if (!baseline) return; // first run: just remember what exists
  for (const it of fresh) {
    const price = it.price != null ? ` — $${it.price}` : '';
    const row = {
      source: 'walmart-new', game,
      title: `${it.title}${price}${it.inStock ? ' (in stock)' : ' (not in stock yet)'}`,
      snippet: null, url: it.url, retailer: 'Walmart', discovered_at: now, dedupe_key: String(it.itemId),
    };
    if (await insertHeadsUp(env, row)) {
      await notifyAll(env, { title: `🆕 New ${GAME_NAME[game]} item at Walmart`, body: row.title, url: it.url, tag: `walmart-new-${it.itemId}` });
    }
  }
}

// Same idea for the Nintendo Store → "🆕 New at Nintendo Store".
export async function checkNewNintendoItems(env) {
  const seen = await loadSeen(env, 'nintendo');
  const items = await nintendoCatalog(env);
  if (!items.length) return;
  const baseline = seen.size > 0;
  const fresh = items.filter((it) => !seen.has(String(it.sku)));
  const now = new Date().toISOString();
  await markSeen(env, 'nintendo', fresh.map((it) => String(it.sku)));
  if (!baseline) return;
  for (const it of fresh) {
    const price = it.price != null ? ` — $${it.price}` : '';
    const status = it.stockStatus === 'IN_STOCK' ? ' (in stock)' : (it.availability || [])[0] ? ` (${it.availability[0]})` : '';
    const row = {
      source: 'nintendo-new', game: 'nintendo', title: `${it.title}${price}${status}`, snippet: null,
      url: it.url, retailer: 'Nintendo Store', discovered_at: now, dedupe_key: String(it.sku),
    };
    if (await insertHeadsUp(env, row)) {
      await notifyAll(env, { title: '🆕 New at Nintendo Store', body: row.title, url: it.url, tag: `nintendo-new-${it.sku}` });
    }
  }
}
