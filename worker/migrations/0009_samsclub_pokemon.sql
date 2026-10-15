-- 0009_samsclub_pokemon.sql — 2026-10-14, user request: track Sam's Club's
-- real online stock (see seed-data.js's matching comment above these same
-- 3 entries for the full reasoning — these are Sam's Club-exclusive SKUs,
-- verified via web search + a direct fetch confirming each page is real,
-- not the same products already tracked at Best Buy/GameStop, so they're
-- their own new products rather than a fabricated extra listing on an
-- unrelated one). msrp left NULL — no published MSRP was confirmed for
-- these club-exclusive items, only a live "current price" on one of them,
-- which the poller will capture for real rather than this migration
-- guessing at a number.
INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES (
  'samsclub-mew-etb',
  'pokemon',
  'Pokémon Mew Elite Trainer Box + 6 Bonus Cards (Sam''s Club exclusive)',
  NULL,
  'fast',
  NULL
);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES (
  'samsclub-mew-etb',
  'samsclub',
  'https://www.samsclub.com/p/pokemon-mew-elite-trainer-box-plus-6-bonus-cards/P03010032'
);

INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES (
  'samsclub-classic-box',
  'pokemon',
  'Pokémon TCG Classic Box Card Pack (Sam''s Club)',
  NULL,
  'fast',
  NULL
);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES (
  'samsclub-classic-box',
  'samsclub',
  'https://www.samsclub.com/p/pokemon-tcg-classic-box-card-pack/P990352990'
);

INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref)
VALUES (
  'samsclub-heavy-hitters',
  'pokemon',
  'Pokémon Heavy Hitters Premium Collection (Sam''s Club)',
  NULL,
  'fast',
  NULL
);
INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES (
  'samsclub-heavy-hitters',
  'samsclub',
  'https://www.samsclub.com/p/pokemon-heavy-hitters-premium-collection/P03010010'
);
