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
  saveSubscription,
  removeSubscription,
  setProductTier,
  getHeadsUp,
} from './db.js';
import { notifyAll, pushConfigured } from './push.js';
import { tick } from './poll.js';

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
  const events = await getEvents(c.env, limit);
  return c.json(events);
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

// Early-signal / unconfirmed tier — see worker/src/headsup.js for why this
// is a separate table and endpoint from /api/events (confirmed alerts).
app.get('/api/heads-up', async (c) => {
  const limit = c.req.query('limit') || '50';
  const rows = await getHeadsUp(c.env, limit);
  return c.json(rows);
});

app.get('/api/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env));
  },
};
