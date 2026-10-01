-- 0003_pokemon_center.sql — adds Pokémon Center as a tracked retailer.
-- Real product page found via web search (not fabricated): Pokémon
-- Center sells a separate "Pokémon Center Elite Trainer Box" variant of
-- the 30th Celebration set (different SKU/promo from the general-retail
-- ETB already tracked at Best Buy/GameStop) — attached here to the same
-- product_id for simplicity rather than creating a whole second product
-- entry, since the thing that matters for alerting is "is there a new
-- 30th Celebration PC item to buy," not keeping two nearly-identical
-- product rows in sync.
--
-- HONEST CAVEAT: pokemoncenter.com runs Incapsula bot-protection (a
-- dedicated anti-automation WAF, confirmed by fetching the page directly
-- and getting an Incapsula challenge response instead of product
-- content). There is a real chance this listing returns blocked/unknown
-- status even once deployed on Cloudflare's own IPs — needs the same
-- live verification every other source in this project has needed.

INSERT OR IGNORE INTO retailer_listings (product_id, retailer, url)
VALUES (
  'pkm-30th-etb',
  'pokemoncenter',
  'https://www.pokemoncenter.com/product/10-10447-111/pokemon-tcg-30th-celebration-pokemon-center-elite-trainer-box'
);
