// db.js — D1 query helpers. D1's binding API (env.DB.prepare(...).bind(...))
// is async, unlike the synchronous better-sqlite3-style API the Node/Express
// version used (server/db.js) — every function here returns a Promise.
// Table shapes are identical to the Node version's schema (see
// migrations/0001_init.sql), so the JSON this sends to the frontend is
// unchanged and public/pwa-boot.js needs no changes.

export async function getAllProductsWithListings(env) {
  const products = (await env.DB.prepare('SELECT * FROM products').all()).results;
  const listings = (await env.DB.prepare('SELECT * FROM retailer_listings').all()).results;
  const byProduct = {};
  for (const p of products) byProduct[p.id] = { ...p, listings: [] };
  for (const l of listings) {
    if (byProduct[l.product_id]) byProduct[l.product_id].listings.push(l);
  }
  return Object.values(byProduct);
}

// Ordered by product_id, retailer so the rotation index in poll_state stays
// stable across ticks (D1/SQLite doesn't guarantee row order otherwise).
export async function getListingsForLane(env, tier) {
  const { results } = await env.DB.prepare(
    `SELECT rl.*, p.name as product_name, p.msrp, p.tcgplayer_ref, p.game
     FROM retailer_listings rl
     JOIN products p ON p.id = rl.product_id
     WHERE p.poll_tier = ?
     ORDER BY rl.product_id, rl.retailer`
  ).bind(tier).all();
  return results;
}

export async function updateListing(env, row) {
  // image_url uses COALESCE(new, existing): a poll that didn't find an
  // image this time (page layout hiccup, block page, retailer briefly has
  // none) should never erase a real photo found on a previous poll. It
  // only ever moves from empty -> a real URL, or real URL -> a newer real
  // URL — never back to empty while listing data otherwise keeps updating.
  await env.DB.prepare(
    `UPDATE retailer_listings
     SET last_price = ?, last_stock = ?, last_purchasable = ?, last_checked_at = ?,
         image_url = COALESCE(?, image_url)
     WHERE product_id = ? AND retailer = ?`
  ).bind(row.last_price, row.last_stock, row.last_purchasable, row.last_checked_at, row.image_url ?? null, row.product_id, row.retailer).run();
}

export async function insertEvent(env, row) {
  await env.DB.prepare(
    `INSERT INTO events (created_at, kind, product_id, message, data_json) VALUES (?, ?, ?, ?, ?)`
  ).bind(row.created_at, row.kind, row.product_id ?? null, row.message, row.data_json ?? null).run();
}

export async function getEvents(env, limit = 50) {
  const capped = Math.min(parseInt(limit, 10) || 50, 200);
  const { results } = await env.DB.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').bind(capped).all();
  // data_json is stored as a raw string; lift its `url` (the actual
  // retailer page the poller checked) up to a top-level field so the
  // frontend can render a real link without having to JSON.parse a blob
  // it was never guaranteed to understand the shape of.
  for (const row of results) {
    if (row.data_json) {
      try {
        const parsed = JSON.parse(row.data_json);
        if (parsed && parsed.url) row.url = parsed.url;
      } catch (_) { /* leave row.url unset if data_json isn't valid JSON */ }
    }
  }
  return results;
}

export async function getDrawingState(env) {
  return env.DB.prepare('SELECT * FROM walmart_drawing_state WHERE id = 1').first();
}

export async function updateDrawingState(env, { is_open, items_json, last_checked_at }) {
  await env.DB.prepare(
    'UPDATE walmart_drawing_state SET is_open = ?, items_json = ?, last_checked_at = ? WHERE id = 1'
  ).bind(is_open, items_json, last_checked_at).run();
}

// ---------------- poll_state (staggered rotation cursors) ----------------

export async function getPollState(env) {
  const row = await env.DB.prepare('SELECT * FROM poll_state WHERE id = 1').first();
  return row || { id: 1, fast_idx: -1, slow_idx: -1, tick_count: 0 };
}

export async function setPollState(env, { fast_idx, slow_idx, tick_count }) {
  await env.DB.prepare(
    'UPDATE poll_state SET fast_idx = ?, slow_idx = ?, tick_count = ? WHERE id = 1'
  ).bind(fast_idx, slow_idx, tick_count).run();
}

// ---------------- push subscriptions ----------------

export async function saveSubscription(env, sub) {
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (endpoint, subscription_json, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET subscription_json = excluded.subscription_json`
  ).bind(sub.endpoint, JSON.stringify(sub), new Date().toISOString()).run();
}

export async function removeSubscription(env, endpoint) {
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run();
}

export async function allSubscriptions(env) {
  const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions').all();
  return results.map((r) => JSON.parse(r.subscription_json));
}

export async function setProductTier(env, productId, tier) {
  await env.DB.prepare('UPDATE products SET poll_tier = ? WHERE id = ?').bind(tier, productId).run();
}

// ---------------- heads_up (early signal / unconfirmed tier) ----------------

// Returns true only if this was a genuinely NEW row (not a duplicate of an
// already-seen source+dedupe_key) — callers use this to decide whether to
// fire a push notification, so re-checking unchanged content doesn't spam.
export async function insertHeadsUp(env, row) {
  const { results } = await env.DB.prepare(
    `INSERT INTO heads_up (source, game, title, snippet, url, discovered_at, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, dedupe_key) DO NOTHING
     RETURNING id`
  ).bind(row.source, row.game ?? null, row.title, row.snippet ?? null, row.url ?? null, row.discovered_at, row.dedupe_key).all();
  return results.length > 0;
}

export async function getHeadsUp(env, limit = 50) {
  const capped = Math.min(parseInt(limit, 10) || 50, 200);
  const { results } = await env.DB.prepare('SELECT * FROM heads_up ORDER BY id DESC LIMIT ?').bind(capped).all();
  return results;
}
