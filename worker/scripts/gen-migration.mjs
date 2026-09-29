import { PRODUCTS, REF_CHECKED_AT } from '../src/seed-data.js';

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

let out = `-- 0001_init.sql — initial schema + seed data for TCGTracker on Cloudflare D1.
-- Generated from worker/src/seed-data.js — do not hand-edit the seed rows
-- below; regenerate via \`node scripts/gen-migration.js\` if seed-data.js
-- changes before first deploy. After first deploy, treat this like any
-- other production migration: add a NEW migration file for changes, don't
-- edit this one (D1 tracks which migrations have already been applied).

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  msrp REAL,
  poll_tier TEXT NOT NULL DEFAULT 'slow',
  tcgplayer_ref REAL,
  tcgplayer_ref_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS retailer_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  retailer TEXT NOT NULL,
  url TEXT NOT NULL,
  last_price REAL,
  last_stock TEXT,
  last_purchasable INTEGER DEFAULT 0,
  last_checked_at TEXT,
  UNIQUE(product_id, retailer)
);

CREATE TABLE IF NOT EXISTS walmart_drawing_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  is_open INTEGER DEFAULT 0,
  items_json TEXT,
  last_checked_at TEXT
);
INSERT OR IGNORE INTO walmart_drawing_state (id, is_open) VALUES (1, 0);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  product_id TEXT,
  message TEXT NOT NULL,
  data_json TEXT
);

-- poll_state drives the staggered rotation (see src/poll.js): fast_idx and
-- slow_idx are cursors into each lane's ordered listing list, tick_count
-- counts every scheduled invocation so the slow lane can be gated to only
-- advance every SLOW_LANE_EVERY_N_TICKS ticks.
CREATE TABLE IF NOT EXISTS poll_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  fast_idx INTEGER NOT NULL DEFAULT -1,
  slow_idx INTEGER NOT NULL DEFAULT -1,
  tick_count INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO poll_state (id, fast_idx, slow_idx, tick_count) VALUES (1, -1, -1, 0);

-- ---------------- Seed data (generated from seed-data.js) ----------------
`;

for (const p of PRODUCTS) {
  const refCheckedAt = p.tcgplayer_ref != null ? REF_CHECKED_AT : null;
  out += `INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES (${sqlStr(p.id)}, ${sqlStr(p.game)}, ${sqlStr(p.name)}, ${sqlStr(p.msrp)}, ${sqlStr(p.poll_tier)}, ${sqlStr(p.tcgplayer_ref)}, ${sqlStr(refCheckedAt)});\n`;
  for (const l of p.listings || []) {
    out += `INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES (${sqlStr(p.id)}, ${sqlStr(l.retailer)}, ${sqlStr(l.url)});\n`;
  }
}

process.stdout.write(out);
