// db.js — tiny SQLite state store. One file, no external database needed.
// On Railway: attach a Volume mounted at /data and set DB_PATH=/data/tcgtracker.db
// so state survives redeploys. Without a volume, the file lives in the
// container's ephemeral disk and resets on every deploy/restart.
//
// Uses Node's own built-in `node:sqlite` (DatabaseSync) rather than the
// `better-sqlite3` npm package. Same synchronous prepare/run/get/all API,
// but nothing to compile — better-sqlite3 is a native addon and needs a
// C++ toolchain (Visual Studio Build Tools on Windows, Xcode CLI tools on
// Mac) to install from source whenever a prebuilt binary isn't published
// yet for your exact Node version. node:sqlite ships inside Node itself,
// so `npm install` never touches node-gyp for the database at all. It's
// still marked "experimental" by Node (harmless warning on startup) but
// is fully functional for this use case.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'tcgtracker.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,            -- 'pokemon' | 'mtg' | 'lorcana'
  name TEXT NOT NULL,
  msrp REAL,
  poll_tier TEXT NOT NULL DEFAULT 'slow',  -- 'fast' (~90s) | 'slow' (~30min)
  tcgplayer_ref REAL,             -- last-known secondary market reference price
  tcgplayer_ref_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS retailer_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  retailer TEXT NOT NULL,         -- 'bestbuy' | 'target' | 'walmart' | 'pokemoncenter' | 'gamestop'
  url TEXT NOT NULL,
  last_price REAL,
  last_stock TEXT,                -- free text: 'in_stock' | 'oos' | 'unknown' | 'account_gated' etc.
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
  kind TEXT NOT NULL,              -- 'restock' | 'good_price' | 'drawing_open' | 'announcement'
  product_id TEXT,
  message TEXT NOT NULL,
  data_json TEXT
);
`);

module.exports = db;
