-- 0003_add_pokemon_center.sql — coverage-gap fix, 2026-09-30.
--
-- On 2026-09-30 the user got a real Pokémon Center restock alert from a
-- third-party app (Restokd) before this project said anything. Root cause:
-- the Pokémon Center-exclusive "30th Celebration Pokémon Center Elite
-- Trainer Box" (a different SKU from the general-retail 30th Celebration
-- ETB already tracked as pkm-30th-etb, sold only at pokemoncenter.com) was
-- never seeded as a tracked product at all — Pokémon Center wasn't in the
-- retailer list for anything. This adds it to the fast lane so it's
-- checked on the same ~5-minute rotation as the other Pokémon products.
--
-- Apply with: wrangler d1 execute tcgtracker-db --remote --file=migrations/0003_add_pokemon_center.sql
-- (drop --remote to apply to your local dev DB instead)

INSERT OR IGNORE INTO products (id, game, name, msrp, poll_tier, tcgplayer_ref, tcgplayer_ref_checked_at)
VALUES ('pkm-30th-etb-pokemoncenter', 'pokemon', '30th Celebration — Pokémon Center Elite Trainer Box', 59.99, 'fast', 310.50, '2026-09-30T16:00:00.000Z');

INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES ('pkm-30th-etb-pokemoncenter', 'pokemoncenter', 'https://www.pokemoncenter.com/product/10-10447-111/pokemon-tcg-30th-celebration-pokemon-center-elite-trainer-box');
