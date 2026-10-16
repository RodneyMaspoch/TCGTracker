-- 0011_watchlist_products.sql — 2026-10-16
-- Adds the watchlist products that were only ever on the old Claude-hosted
-- dashboards and never in the app's database, so they get real stock checks,
-- alerts and tiles. URLs are the exact store pages recorded in the project
-- watchlist (claude/watchlist-config.md). INSERT OR IGNORE = safe to re-run.

-- MTG
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES ('rf-cbb', 'mtg', 'Reality Fracture — Collector Booster Box', 323.88, 'slow', 512.12);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES
  ('rf-cbb', 'bestbuy', 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-reality-fracture-collector-booster-box-12-packs/JJ8VP7ZRYS'),
  ('rf-cbb', 'gamestop', 'https://www.gamestop.com/toys-games/trading-cards/products/magic-the-gathering-reality-fracture-collector-booster-box/20035129.html');

INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES ('rf-play-box', 'mtg', 'Reality Fracture — Play Booster Box', 164.70, 'slow', NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES
  ('rf-play-box', 'walmart', 'https://www.walmart.com/ip/Magic-The-Gathering-Reality-Fracture-Play-Booster-Box/20908222947');

INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES ('startrek-cbb', 'mtg', 'Star Trek — Collector Booster Box', 479.99, 'slow', NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES
  ('startrek-cbb', 'bestbuy', 'https://www.bestbuy.com/product/wizards-of-the-coast-magic-the-gathering-star-trek-collector-booster-box-12-packs/JJ8VP7ZYQC');

-- Lorcana (older sets — mostly sold out; tracked for restocks at MSRP)
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref) VALUES
  ('wilds-unknown-box', 'lorcana', 'Wilds Unknown — Booster Box', 143.76, 'slow', 241.21),
  ('winterspell-box', 'lorcana', 'Winterspell — Booster Box', 143.76, 'slow', 265.99),
  ('whispers-well-box', 'lorcana', 'Whispers in the Well — Booster Box', 143.76, 'slow', 223.55),
  ('fabled-box', 'lorcana', 'Fabled — Booster Box', 143.76, 'slow', 822.47);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES
  ('wilds-unknown-box', 'bestbuy', 'https://www.bestbuy.com/product/disney-lorcana-wilds-unknown-booster-box-24-packs/CJ6QGKQGXV/sku/12646788'),
  ('winterspell-box', 'bestbuy', 'https://www.bestbuy.com/product/disney-lorcana-winterspell-booster-box-24-packs/CJ6QGKQGC9'),
  ('whispers-well-box', 'bestbuy', 'https://www.bestbuy.com/product/disney-lorcana-whispers-in-the-well-booster-box-24-packs-288-lorcana-cards/CJ6QGKQ87J'),
  ('fabled-box', 'bestbuy', 'https://www.bestbuy.com/product/disney-lorcana-fabled-booster-box-24-packs-288-lorcana-cards/CJ6QGKQ23V');

-- Pokémon
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES ('pkm-deck-crafter', 'pokemon', 'Deck Crafter''s Collection', 9.99, 'fast', NULL);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url) VALUES
  ('pkm-deck-crafter', 'bestbuy', 'https://www.bestbuy.com/product/pokemon-deck-crafters-collection-2026/JJG2TL87Q5');
