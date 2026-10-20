-- 0013_seen_items.sql — 2026-10-20. Database budget fix.
-- "Already seen" store item IDs (for "new item" alerts) move out of heads_up
-- into their own small table, and old history is trimmed, so the pages read
-- far fewer rows. Safe to run more than once.
CREATE TABLE IF NOT EXISTS seen_items (
  store TEXT NOT NULL,
  item_key TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  PRIMARY KEY (store, item_key)
);
INSERT OR IGNORE INTO seen_items (store, item_key, first_seen)
  SELECT CASE WHEN source LIKE 'nintendo%' THEN 'nintendo' ELSE 'walmart-' || game END, dedupe_key, discovered_at
  FROM heads_up WHERE source IN ('walmart-seen', 'walmart-new', 'nintendo-seen', 'nintendo-new');
DELETE FROM heads_up WHERE source IN ('walmart-seen', 'nintendo-seen');
-- the "good price" alert used to be saved every 15s (bug, fixed in v21):
-- keep only the newest one per product
DELETE FROM events WHERE kind = 'good_price' AND id NOT IN (SELECT MAX(id) FROM events WHERE kind = 'good_price' GROUP BY product_id);
-- (alert history is kept — only the duplicate spam above is removed)
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id);
