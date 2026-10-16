// index.js — Cloudflare Workers entry point. Replaces server/index.js
// (Express) with a small Hono app for the same API surface, plus the
// `scheduled` export that Cron Triggers invoke instead of the Node
// version's setInterval loop (see poll.js). Static files (index.html,
// lorcana.html, pokemon.html, pwa-boot.js, etc.) are served straight from
// ../public by the Workers Static Assets binding configured in
// wrangler.toml — requests that don't match a file in there (like /api/*)
// fall through to this Worker.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  getAllProductsWithListings,
  getDrawingState,
  getEvents,
  getEventsCountSince,
  saveSubscription,
  removeSubscription,
  setProductTier,
  setProductMuted,
  setProductTarget,
  getHeadsUp,
  insertTrackedProduct,
} from './db.js';
import { notifyAll, pushConfigured } from './push.js';
import { Ticker } from './ticker-do.js';
import { checkSourcesReachable } from './headsup.js';
import { walmartConfigured, walmartLookupRaw, walmartSearch, walmartCatalog } from './walmart-io.js';
import { searchNintendoCatalog } from './nintendo-algolia.js';

// Durable Object classes must be exported from the main entry module (this
// file, per wrangler.toml's `main`) for Workers to find them — the actual
// implementation lives in ticker-do.js. See that file for why this exists:
// it's what gets this app checking every ~15s instead of waiting on Cron
// Triggers' once-a-minute floor.
export { Ticker };

const app = new Hono();
app.use('*', cors());

app.get('/api/products', async (c) => {
  const products = await getAllProductsWithListings(c.env);
  return c.json(products);
});

app.get('/api/walmart-drawing', async (c) => {
  const state = await getDrawingState(c.env);
  return c.json(state || { id: 1, is_open: 0, items_json: null, last_checked_at: null });
});

app.get('/api/events', async (c) => {
  const limit = c.req.query('limit') || '50';
  // 2026-10-14 — default (no param, or anything other than '1'/'true')
  // excludes events for a muted product, so the ticker/toasts/badge never
  // see them; the notification-history page passes include_muted=1 to see
  // the real, complete record regardless of mute state.
  const includeMuted = ['1', 'true'].includes((c.req.query('include_muted') || '').toLowerCase());
  const events = await getEvents(c.env, limit, includeMuted);
  return c.json(events);
});

// 2026-10-14 — powers the nav bell's unread badge. `since_id` is the
// highest event id the client has already seen (stored client-side in
// localStorage — this app has no accounts/auth, so there's nowhere
// server-side to keep a per-user read marker); returns how many NEWER,
// non-muted events exist. Cheap COUNT query, no event bodies transferred.
app.get('/api/events/unread-count', async (c) => {
  const sinceId = c.req.query('since_id') || '0';
  const count = await getEventsCountSince(c.env, sinceId);
  return c.json({ count });
});

app.get('/api/push/public-key', (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY || null, configured: pushConfigured(c.env) });
});

app.post('/api/push/subscribe', async (c) => {
  const sub = await c.req.json().catch(() => null);
  if (!sub || !sub.endpoint) return c.json({ error: 'invalid subscription' }, 400);
  await saveSubscription(c.env, sub);
  return c.json({ ok: true }, 201);
});

app.post('/api/push/unsubscribe', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (body.endpoint) await removeSubscription(c.env, body.endpoint);
  return c.json({ ok: true });
});

app.post('/api/push/test', async (c) => {
  await notifyAll(c.env, { title: 'TCGTracker test', body: 'If you see this, push is wired up correctly.', url: '/' });
  return c.json({ ok: true });
});

// Note: unlike the Node version, moving a product to 'fast' here changes
// which lane it rotates through, not its individual check frequency
// directly — see poll.js's header comment for the actual cadence math.
app.post('/api/admin/set-tier', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { product_id, tier } = body;
  if (!product_id || !['fast', 'slow'].includes(tier)) {
    return c.json({ error: 'product_id and tier (fast|slow) required' }, 400);
  }
  await setProductTier(c.env, product_id, tier);
  return c.json({ ok: true });
});

// 2026-10-14 — per-product mute, the user's own counter-proposal to a
// backend restock-cooldown (see 0008_product_muted.sql for the full
// reasoning: a cooldown risks swallowing a genuine second restock inside
// its window; muting a specific product the user doesn't care about
// doesn't touch anything else's alert fidelity).
app.post('/api/admin/set-muted', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { product_id, muted } = body;
  if (!product_id || typeof muted !== 'boolean') {
    return c.json({ error: 'product_id and muted (boolean) required' }, 400);
  }
  await setProductMuted(c.env, product_id, muted);
  return c.json({ ok: true });
});

// 2026-10-16 — search Walmart (sold-by-Walmart items only) for the game pages.
app.get('/api/walmart/search', async (c) => {
  if (!walmartConfigured(c.env)) return c.json({ error: 'Walmart feed not configured' }, 400);
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ results: [] });
  try {
    return c.json({ results: await walmartSearch(c.env, q) });
  } catch (err) {
    return c.json({ error: err.message }, 502);
  }
});

// 2026-10-16 — every sold-by-Walmart product for one game (cached 30 min).
app.get('/api/walmart/catalog', async (c) => {
  if (!walmartConfigured(c.env)) return c.json({ error: 'Walmart feed not configured' }, 400);
  const game = c.req.query('game') || 'pokemon';
  const cacheKey = new Request(`https://cache.internal/walmart-catalog/${game}`);
  const cache = caches.default;
  const hit = await cache.match(cacheKey);
  if (hit) return hit;
  try {
    const results = await walmartCatalog(c.env, game);
    const res = new Response(JSON.stringify({ results, cachedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=1800' },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return c.json({ error: err.message }, 502);
  }
});

// 2026-10-16 — which alert sources can the Worker reach right now?
app.get('/api/admin/sources-check', async (c) => c.json(await checkSourcesReachable()));

// 2026-10-16 — one-off test of the Walmart official feed. Open in a browser:
//   /api/admin/walmart-test?item=20908222947
// Shows Walmart's raw answer so we can confirm it includes stock.
app.get('/api/admin/walmart-test', async (c) => {
  if (!walmartConfigured(c.env)) {
    return c.json({ ok: false, error: 'Walmart not set up yet: add WALMART_CONSUMER_ID, WALMART_KEY_VERSION and the WALMART_PRIVATE_KEY secret in Cloudflare.' }, 400);
  }
  const item = c.req.query('item') || '20908222947';
  try {
    const { status, body } = await walmartLookupRaw(c.env, item);
    const it = body && typeof body === 'object' ? (Array.isArray(body.items) ? body.items[0] : body) : null;
    return c.json({ ok: status === 200, status, stock: it?.stock ?? null, availableOnline: it?.availableOnline ?? null, salePrice: it?.salePrice ?? null, name: it?.name ?? null, raw: body });
  } catch (err) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

// 2026-10-15 — per-product price alert. target_price: number > 0, or null to clear.
app.post('/api/admin/set-target', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { product_id } = body;
  const target = body.target_price === null ? null : Number(body.target_price);
  if (!product_id || (target !== null && !(target > 0))) {
    return c.json({ error: 'product_id and target_price (positive number or null) required' }, 400);
  }
  await setProductTarget(c.env, product_id, target);
  return c.json({ ok: true });
});

// 2026-10-08, user request: lets the frontend (so far just the new
// Nintendo page — see public/nintendo-app.js) add a product+listing to
// track at runtime, instead of every tracked item needing a committed
// migration file first. No auth — same posture as /api/admin/set-tier
// above, which already has none; this app has always assumed a single
// trusted user, not a public multi-tenant deployment.
app.post('/api/admin/track-product', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const { game, name, url, retailer, poll_tier, msrp } = body;
  if (!game || !name || !url || !retailer) {
    return c.json({ error: 'game, name, url, and retailer are required' }, 400);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    return c.json({ error: 'url is not a valid URL' }, 400);
  }
  if (parsed.protocol !== 'https:') {
    return c.json({ error: 'url must be https' }, 400);
  }

  // Derive a stable, human-debuggable id from the game + URL's final path
  // segment, rather than requiring the frontend to invent one — collisions
  // just mean "this exact product is already tracked," which INSERT OR
  // IGNORE in insertTrackedProduct() already treats as a harmless no-op.
  const lastSegment = parsed.pathname.split('/').filter(Boolean).pop() || 'item';
  const id = `${game}-${lastSegment}`.toLowerCase().slice(0, 80);

  try {
    await insertTrackedProduct(c.env, {
      id,
      game,
      name,
      msrp: typeof msrp === 'number' ? msrp : null,
      poll_tier: ['fast', 'slow'].includes(poll_tier) ? poll_tier : 'slow',
      retailer,
      url,
    });
    return c.json({ ok: true, id }, 201);
  } catch (err) {
    console.error('[api/admin/track-product] insert failed', err);
    return c.json({ error: 'insert_failed', message: String(err && err.message || err) }, 500);
  }
});

// 2026-10-10, user request: real catalog search for the Nintendo page,
// replacing "paste a URL you found yourself" as the primary way to add a
// product. Backed by nintendo.com's own public Algolia search index — see
// worker/src/nintendo-algolia.js's header comment for the full story and
// worker/wrangler.toml for the (non-secret) credentials.
app.get('/api/nintendo/search', async (c) => {
  const q = (c.req.query('q') || '').trim();
  if (!q) return c.json({ error: 'q query param is required' }, 400);
  try {
    const results = await searchNintendoCatalog(c.env, q);
    return c.json({ query: q, results });
  } catch (err) {
    console.error('[api/nintendo/search] failed', err);
    return c.json({ error: 'search_failed', message: String(err && err.message || err) }, 500);
  }
});

// Early-signal / unconfirmed tier — see worker/src/headsup.js for why this
// is a separate table and endpoint from /api/events (confirmed alerts).
app.get('/api/heads-up', async (c) => {
  const limit = c.req.query('limit') || '50';
  try {
    const rows = await getHeadsUp(c.env, limit);
    return c.json(rows);
  } catch (err) {
    // Most likely cause: migration 0002_heads_up.sql hasn't been applied
    // to this D1 database yet, so the `heads_up` table doesn't exist.
    // Returning a clear JSON error (instead of letting D1's raw error
    // bubble up as an opaque 500) means the frontend can actually show
    // the person something useful instead of a silent blank page.
    console.error('[api/heads-up] query failed', err);
    return c.json({ error: 'heads_up_query_failed', message: String(err && err.message || err) }, 500);
  }
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    // 2026-10-05: tick() itself no longer runs from here. The real loop
    // now lives in the Ticker Durable Object's self-re-arming alarm (see
    // ticker-do.js), running every ~15s — far faster than this Cron
    // Trigger could ever fire on its own (Cloudflare's floor is once a
    // minute, `* * * * *`, on every plan). This once-a-minute trigger is
    // kept as a cheap watchdog instead: it pings the Ticker DO, which only
    // re-arms its alarm if one isn't already scheduled. Normally that's a
    // no-op — the 15s loop is already running — but if that loop ever
    // stops (an error before the DO's re-arm, an eviction, etc.), this
    // catches it within 60 seconds instead of it staying broken silently
    // and permanently, the same "always have a fallback" principle as the
    // try/catch layers already in poll.js.
    ctx.waitUntil(
      (async () => {
        try {
          const id = env.TICKER.idFromName('singleton');
          const stub = env.TICKER.get(id);
          await stub.fetch('https://ticker.internal/heartbeat');
        } catch (err) {
          console.error('[scheduled] ticker heartbeat failed:', err);
        }
      })()
    );
  },
};
