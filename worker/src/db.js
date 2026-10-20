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
    `SELECT rl.*, p.name as product_name, p.msrp, p.tcgplayer_ref, p.game, p.muted
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

// 2026-10-15 — true if a restock event for this exact listing (product +
// retailer URL, which poll.js stores in data_json) was recorded in the
// last `minutes`. Fails open (returns false) so a DB hiccup can never
// swallow a real restock alert.
export async function hasRecentRestock(env, productId, url, minutes, kind = 'restock') {
  try {
    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const row = await env.DB.prepare(
      `SELECT 1 FROM events WHERE kind = ? AND product_id = ? AND created_at > ? AND data_json LIKE ? LIMIT 1`
    ).bind(kind, productId, since, `%${url}%`).first();
    return !!row;
  } catch (err) {
    console.warn(`[db] hasRecentRestock failed (alerting anyway): ${err.message}`);
    return false;
  }
}

export async function insertEvent(env, row) {
  await env.DB.prepare(
    `INSERT INTO events (created_at, kind, product_id, message, data_json) VALUES (?, ?, ?, ?, ?)`
  ).bind(row.created_at, row.kind, row.product_id ?? null, row.message, row.data_json ?? null).run();
}

// 2026-10-14 — `includeMuted` lets the full notification-history page (see
// public/notifications-app.js) show everything that ever happened,
// while every other caller (the top ticker, toasts, the unread badge)
// defaults to false so a muted product's events don't bug the user
// anywhere — see 0008_product_muted.sql for the full reasoning. A LEFT
// JOIN (not INNER) so an event whose product was later deleted, or that
// has no product_id at all (drawing_open/drawing_reminder are global, not
// per-product), still comes through rather than silently vanishing.
export async function getEvents(env, limit = 50, includeMuted = false) {
  const capped = Math.min(parseInt(limit, 10) || 50, 200);
  const sql = includeMuted
    ? `SELECT e.*, p.muted as product_muted FROM events e LEFT JOIN products p ON p.id = e.product_id ORDER BY e.id DESC LIMIT ?`
    : `SELECT e.*, p.muted as product_muted FROM events e LEFT JOIN products p ON p.id = e.product_id WHERE p.muted IS NULL OR p.muted = 0 ORDER BY e.id DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql).bind(capped).all();
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

// Powers the nav bell's unread-count badge (and the PWA app-icon Badging
// API where the browser supports it) — a cheap COUNT instead of fetching
// and re-filtering a full event list client-side on every page, on every
// poll interval. Same mute-aware filtering as getEvents's default (a
// muted product's restocks never bump this number).
export async function getEventsCountSince(env, sinceId) {
  const since = parseInt(sinceId, 10) || 0;
  const { results } = await env.DB.prepare(
    // 2026-10-20 — capped to the newest 200 events. With since_id=0 (never
    // opened Notifications) this used to COUNT the whole events table every
    // 30s per open tab — a main cause of hitting D1's free daily read limit.
    `SELECT COUNT(*) as n FROM events e LEFT JOIN products p ON p.id = e.product_id
     WHERE e.id > MAX(?, COALESCE((SELECT MAX(id) FROM events), 0) - 200) AND (p.muted IS NULL OR p.muted = 0)`
  ).bind(since).all();
  return results[0]?.n || 0;
}

export async function getDrawingState(env) {
  return env.DB.prepare('SELECT * FROM walmart_drawing_state WHERE id = 1').first();
}

// next_drawing_at / reminders_sent_json (migration 0006) are optional
// params — callers that don't pass them (if any existed) would leave the
// existing stored value untouched via COALESCE, same pattern as
// updateListing's image_url handling.
export async function updateDrawingState(env, { is_open, items_json, last_checked_at, next_drawing_at, reminders_sent_json }) {
  await env.DB.prepare(
    'UPDATE walmart_drawing_state SET is_open = ?, items_json = ?, last_checked_at = ?, ' +
    'next_drawing_at = COALESCE(?, next_drawing_at), ' +
    'reminders_sent_json = COALESCE(?, reminders_sent_json) WHERE id = 1'
  ).bind(is_open, items_json, last_checked_at, next_drawing_at ?? null, reminders_sent_json ?? null).run();
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

// 2026-10-14 — per-product mute (see 0008_product_muted.sql). Does not
// touch poll_tier — a muted product keeps being checked at its normal
// cadence, it just stops pushing/toasting/badging the user when it fires.
// 2026-10-15 — per-product price alert (migration 0010). null clears it.
export async function setProductTarget(env, productId, target) {
  await env.DB.prepare('UPDATE products SET target_price = ? WHERE id = ?').bind(target, productId).run();
}

// Read separately (and fail-soft) so the poller keeps working even before
// migration 0010 has been applied — then simply no price alerts fire.
export async function getTargetPrices(env) {
  try {
    const { results } = await env.DB.prepare('SELECT id, target_price FROM products WHERE target_price IS NOT NULL').all();
    return Object.fromEntries(results.map((r) => [r.id, r.target_price]));
  } catch (err) {
    console.warn(`[db] target prices unavailable (migration 0010 not applied?): ${err.message}`);
    return {};
  }
}

export async function setProductMuted(env, productId, muted) {
  await env.DB.prepare('UPDATE products SET muted = ? WHERE id = ?').bind(muted ? 1 : 0, productId).run();
}

// 2026-10-08, user request: lets a product+listing be added at RUNTIME
// (from the new Nintendo page's "track a product" form, see
// POST /api/admin/track-product in index.js) instead of only ever through
// a committed migration file — every other product in this app so far
// came from seed-data.js + a migration, which works for a curated list
// this project builds ahead of time, but not for "the user finds a new
// item and wants it tracked right now." `id` is derived from the URL
// (stable, collision-resistant, human-debuggable) rather than requiring
// the caller to invent one. `INSERT OR IGNORE` on both tables means
// calling this twice with the same URL is a harmless no-op, not a
// duplicate/crash — same defensive posture as every seed migration here.
export async function insertTrackedProduct(env, { id, game, name, msrp, poll_tier, retailer, url }) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref) VALUES (?, ?, ?, ?, ?, NULL)'
  ).bind(id, game, name, msrp ?? null, poll_tier || 'slow').run();
  await env.DB.prepare(
    'INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES (?, ?, ?)'
  ).bind(id, retailer, url).run();
}

// 2026-10-16 — "watch before it's listed" (TrackaLacker/TYPA style): a product
// row with NO store listing yet. The poller looks for it on Walmart and adds
// the listing (and alerts) the moment Walmart itself lists it.
export async function insertWatchProduct(env, { id, game, name, msrp }) {
  await env.DB.prepare(
    'INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref) VALUES (?, ?, ?, ?, ?, NULL)'
  ).bind(id, game, name, msrp ?? null, game === 'pokemon' ? 'fast' : 'slow').run();
  // A watched product must be tracked (alerts on), even if it existed muted.
  await env.DB.prepare('UPDATE products SET muted = 0 WHERE id = ?').bind(id).run().catch(() => {});
}

// Products (alerts on) that don't have a Walmart listing yet.
export async function getUnlistedWatchProducts(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.game, p.name, p.msrp FROM products p
     WHERE p.game IN ('pokemon','mtg','lorcana')
       AND COALESCE(p.muted, 0) = 0
       AND NOT EXISTS (SELECT 1 FROM retailer_listings rl WHERE rl.product_id = p.id AND rl.retailer LIKE 'walmart%')
     ORDER BY p.id`
  ).all();
  return results;
}

export async function addListing(env, productId, retailer, url) {
  const { meta } = await env.DB.prepare(
    'INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES (?, ?, ?)'
  ).bind(productId, retailer, url).run();
  return (meta && meta.changes) > 0;
}

// ---------------- heads_up (early signal / unconfirmed tier) ----------------

// Returns true only if this was a genuinely NEW row (not a duplicate of an
// already-seen source+dedupe_key) — callers use this to decide whether to
// fire a push notification, so re-checking unchanged content doesn't spam.
export async function insertHeadsUp(env, row) {
  const { results } = await env.DB.prepare(
    `INSERT INTO heads_up (source, game, title, snippet, url, discovered_at, dedupe_key, retailer)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source, dedupe_key) DO NOTHING
     RETURNING id`
  ).bind(row.source, row.game ?? null, row.title, row.snippet ?? null, row.url ?? null, row.discovered_at, row.dedupe_key, row.retailer ?? null).all();
  return results.length > 0;
}

export async function getHeadsUp(env, limit = 50) {
  const capped = Math.min(parseInt(limit, 10) || 50, 200);
  const { results } = await env.DB.prepare("SELECT * FROM heads_up WHERE source NOT IN ('walmart-seen','nintendo-seen') ORDER BY id DESC LIMIT ?").bind(capped).all();
  return results;
}
