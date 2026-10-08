-- 0007_nintendo_pro_controller_stand.sql — 2026-10-08, user request: track
-- the Switch 2 Pro Controller + Display Stand (Zelda 40th Anniversary
-- Edition) on Nintendo's own store. First non-TCG product/retailer in
-- this app — see seed-data.js's comment above this entry and the project
-- doc for the open question on where it surfaces in the frontend (no
-- existing page's game-tab filter matches 'nintendo' yet, so this starts
-- out alert-only: push notifications + /api/events, no themed product
-- card until that's decided).
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES (
  'switch2-zelda40-pro-controller-stand',
  'nintendo',
  'Switch 2 Pro Controller + Display Stand — The Legend of Zelda 40th Anniversary Edition',
  NULL,
  'fast',
  NULL
);

INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES (
  'switch2-zelda40-pro-controller-stand',
  'nintendo',
  'https://www.nintendo.com/us/store/products/nintendo-switch-2-pro-controller-display-stand-the-legend-of-zelda-40th-anniversary-edition-127076/'
);
