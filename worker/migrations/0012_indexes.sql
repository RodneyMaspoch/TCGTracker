-- 0012_indexes.sql — 2026-10-17. Speeds up the queries that run every
-- minute (reminders, alerts list, heads-up feed) so they read a few rows
-- instead of scanning whole tables. Safe to run more than once.
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id);
CREATE INDEX IF NOT EXISTS idx_heads_up_dedupe ON heads_up(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_listings_product ON retailer_listings(product_id);
