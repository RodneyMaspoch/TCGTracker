-- 0002_heads_up.sql — adds the "heads up" early-signal tier: upcoming
-- drops/lotteries/restocks mentioned on reference sites or Reddit before
-- they're confirmed on an official retailer page. Separate table from
-- `events` (which is for confirmed restock/good-price triggers) so the
-- frontend can clearly label these as unconfirmed/early signal, never
-- mixed in with confirmed alerts.

CREATE TABLE IF NOT EXISTS heads_up (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,          -- 'trackalacker' | 'tcgdropradar' | 'autoqueue' | 'reddit'
  game TEXT,                     -- 'pokemon' | 'mtg' | 'lorcana' | NULL (unclear/general)
  title TEXT NOT NULL,
  snippet TEXT,                  -- surrounding text/context, for a human to read and judge
  url TEXT,
  discovered_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,      -- content hash/post id — prevents re-alerting on unchanged content every poll
  UNIQUE(source, dedupe_key)
);
