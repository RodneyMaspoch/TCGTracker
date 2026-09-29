-- 0001_init.sql — initial schema + seed data for TCGTracker on Cloudflare D1.
-- Generated from worker/src/seed-data.js — do not hand-edit the seed rows
-- below; regenerate via `node scripts/gen-migration.js` if seed-data.js
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
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('pkm-30th-etb', 'pokemon', '30th Celebration — Elite Trainer Box', 49.99, 'fast', 168.78, '2026-09-27T21:00:00.000Z');
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('pkm-30th-etb', 'bestbuy', 'https://www.bestbuy.com/product/pokemon-trading-card-game-30th-celebration-elite-trainer-box/JJG2TL8XCJ');
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('pkm-30th-etb', 'gamestop', 'https://www.gamestop.com/toys-games/trading-cards/products/pokemon-trading-card-game-30th-celebration-elite-trainer-box/20036324.html');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('pkm-30th-upc-day', 'pokemon', '30th Celebration — Ultra Premium Collection (Day)', 179.99, 'fast', 566.23, '2026-09-27T21:00:00.000Z');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('pkm-delta-reign-etb', 'pokemon', 'Delta Reign — Elite Trainer Box', 49.99, 'fast', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('pkm-delta-reign-etb', 'bestbuy', 'https://www.bestbuy.com/product/pokemon-trading-card-game-mega-evolution-delta-reign-elite-trainer-box/JJG2TL8QGY');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('pkm-prismatic-etb', 'pokemon', 'Prismatic Evolutions — Elite Trainer Box', 69.99, 'fast', 138.86, '2026-09-27T21:00:00.000Z');
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('pkm-prismatic-etb', 'bestbuy', 'https://www.bestbuy.com/product/pokemon-trading-card-game-scarlet-violet-prismatic-evolutions-elite-trainer-box/JJG2TLCW3L');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('hobbit-target', 'mtg', 'The Hobbit — Play Booster Display', 224.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('hobbit-target', 'target', 'https://www.target.com/p/magic-the-gathering-the-hobbit-play-booster-display/-/A-1012055693');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('hobbit-walmart', 'mtg', 'The Hobbit — Play Booster Display', 179.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('hobbit-walmart', 'walmart', 'https://www.walmart.com/ip/Magic-The-Gathering-The-Hobbit-Play-Booster-Display/20213053526');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('doom-prevails', 'mtg', 'Marvel Super Heroes Commander Deck — Doom Prevails', NULL, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('doom-prevails', 'bestbuy', 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-marvel-super-heroes-commander-deck-doom-prevails/JJ8VP7KSL7');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('reality-fracture-sld-target', 'mtg', 'Reality Fracture — Secret Lair Bundle', 89.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('reality-fracture-sld-target', 'target', 'https://www.target.com/p/magic-the-gathering-reality-fracture-secret-lair-bundle/-/A-1012055753');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('reality-fracture-sld-walmart', 'mtg', 'Reality Fracture — Secret Lair Bundle (3rd-party seller)', 89.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('reality-fracture-sld-walmart', 'walmart_marketplace', 'https://www.walmart.com/ip/MTG-REALITY-FRACTURE-SLD-BUNDLE/20843517878');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('motu-secretlair', 'mtg', 'Secret Lair × Masters of the Universe (per set)', 29.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('motu-secretlair', 'secretlair', 'https://secretlair.wizards.com/us/en/product/1254739/secret-lair-x-masters-of-the-universe-sold-separately');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('aotv-target', 'lorcana', 'Attack of the Vine! Booster Display', 143.76, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('aotv-target', 'target', 'https://www.target.com/p/lorcana-trading-card-game-attack-of-the-vine-booster-display/-/A-1011483405');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('aotv-walmart', 'lorcana', 'Attack of the Vine! Booster Box (3rd-party seller)', 143.76, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('aotv-walmart', 'walmart_marketplace', 'https://www.walmart.com/ip/Disney-Lorcana-Trading-Card-Game-Attack-of-the-Vine-Booster-Box-24-Packs/20663157247');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('aotv-bestbuy', 'lorcana', 'Attack of the Vine! Booster Box', 143.76, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('aotv-bestbuy', 'bestbuy', 'https://www.bestbuy.com/product/disney-lorcana-attack-of-the-vine-booster-box-24-packs/CJ6QGKYQT7/sku/6680144');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('hyperia-box-mm', 'lorcana', 'Hyperia City Booster Box (preorder)', 143.76, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('hyperia-box-mm', 'miniaturemarket', 'https://www.miniaturemarket.com/Lorcana-TCG-Hyperia-City-Booster-Box-24-Preorder/RVN11090098-BOX');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('hyperia-trove', 'lorcana', 'Hyperia City — Illumineer''s Trove', 49.99, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('hyperia-trove', 'disneylorcana', 'https://www.disneylorcana.com/en-US/product/hyperia-city');
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at) VALUES ('hunny-rescue', 'lorcana', 'Illumineer''s Quest: The Great Hunny Rescue', NULL, 'slow', NULL, NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES ('hunny-rescue', 'ravensburger', 'https://www.disneylorcana.com/en-GB/product/great-hunny-rescue');
