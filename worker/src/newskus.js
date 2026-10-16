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
import { insertHeadsUp } from './db.js';
import { notifyAll } from './push.js';

const GAMES = ['pokemon', 'mtg', 'lorcana'];
const GAME_NAME = { pokemon: 'Pokémon', mtg: 'MTG', lorcana: 'Lorcana' };

export async function checkNewWalmartSkus(env, runIndex) {
  const game = GAMES[runIndex % GAMES.length];
  const items = await walmartCatalog(env, game);
  const now = new Date().toISOString();

  const baseline = await env.DB.prepare(
    `SELECT 1 FROM heads_up WHERE source IN ('walmart-seen','walmart-new') AND game = ? LIMIT 1`
  ).bind(game).first();
  if (!baseline) {
    // Marker row: the baseline is taken even when Walmart sells nothing for
    // this game yet, so the FIRST item that appears later still alerts.
    await insertHeadsUp(env, { source: 'walmart-seen', game, title: `baseline ${game}`, url: null, retailer: 'Walmart', discovered_at: now, dedupe_key: `baseline-${game}` });
  }

  for (const it of items) {
    const known = await env.DB.prepare(
      `SELECT 1 FROM heads_up WHERE source IN ('walmart-seen','walmart-new') AND dedupe_key = ? LIMIT 1`
    ).bind(it.itemId).first();
    if (known) continue;
    const price = it.price != null ? ` — $${it.price}` : '';
    const row = {
      source: baseline ? 'walmart-new' : 'walmart-seen',
      game,
      title: `${it.title}${price}${it.inStock ? ' (in stock)' : ' (not in stock yet)'}`,
      snippet: null,
      url: it.url,
      retailer: 'Walmart',
      discovered_at: now,
      dedupe_key: it.itemId,
    };
    const isNew = await insertHeadsUp(env, row);
    if (isNew && baseline) {
      await notifyAll(env, {
        title: `🆕 New ${GAME_NAME[game]} item at Walmart`,
        body: row.title,
        url: it.url,
        tag: `walmart-new-${it.itemId}`,
      });
    }
  }
}
