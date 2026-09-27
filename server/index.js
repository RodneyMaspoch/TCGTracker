require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db');
const { seed } = require('./seed');
const push = require('./push');
const poller = require('./poller');

seed(); // safe to re-run on every boot

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- Data for the PWA ----------
app.get('/api/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products').all();
  const listings = db.prepare('SELECT * FROM retailer_listings').all();
  const byProduct = {};
  for (const p of products) byProduct[p.id] = { ...p, listings: [] };
  for (const l of listings) if (byProduct[l.product_id]) byProduct[l.product_id].listings.push(l);
  res.json(Object.values(byProduct));
});

app.get('/api/walmart-drawing', (req, res) => {
  res.json(db.prepare('SELECT * FROM walmart_drawing_state WHERE id=1').get());
});

app.get('/api/events', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  res.json(db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit));
});

// ---------- Push subscription management ----------
app.get('/api/push/public-key', (req, res) => {
  res.json({ publicKey: push.PUBLIC_KEY || null, configured: push.configured });
});

app.post('/api/push/subscribe', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.endpoint) return res.status(400).json({ error: 'invalid subscription' });
  push.saveSubscription(sub);
  res.status(201).json({ ok: true });
});

app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) push.removeSubscription(endpoint);
  res.json({ ok: true });
});

app.post('/api/push/test', async (req, res) => {
  await push.notifyAll({ title: 'TCGTracker test', body: 'If you see this, push is wired up correctly.', url: '/' });
  res.json({ ok: true });
});

// ---------- Admin: change a product's poll tier ----------
app.post('/api/admin/set-tier', (req, res) => {
  const { product_id, tier } = req.body || {};
  if (!product_id || !['fast', 'slow'].includes(tier)) return res.status(400).json({ error: 'product_id and tier (fast|slow) required' });
  db.prepare('UPDATE products SET poll_tier = ? WHERE id = ?').run(tier, product_id);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] listening on :${PORT}`);
  poller.start();
});
