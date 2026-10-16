-- 0010_price_target.sql — 2026-10-15
-- Per-product price alert ("tell me when it's at or below $X"), set from
-- the "Where to buy" sheet on any game page. NULL = no price alert.
-- Apply in the Cloudflare D1 Console like the earlier migrations.
ALTER TABLE products ADD COLUMN target_price REAL;
