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
-- keep 30 days of alert history (older rows only slowed every query down)
DELETE FROM events WHERE created_at < datetime('now', '-30 days');
DELETE FROM heads_up WHERE discovered_at < datetime('now', '-30 days');
CREATE INDEX IF NOT EXISTS idx_events_kind_created ON events(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_events_product ON events(product_id);
