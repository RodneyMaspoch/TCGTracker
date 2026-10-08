-- 0006_walmart_drawing_schedule.sql — 2026-10-08, user request: fire alerts
-- ahead of a Walmart Collectibles Drawing (day-before / 1h-before /
-- 15m-before / at-go-live), not just when it's already detected as open.
-- That requires remembering the next announced drawing's start time
-- between ticks, and which lead-time reminders have already been sent for
-- it (so a reminder fires once, not every ~15s tick until the next one) —
-- see scrapeWalmartDrawing()'s new schedule-parsing step in scrapers.js and
-- the reminder logic in poll.js's pollWalmartDrawing().
ALTER TABLE walmart_drawing_state ADD COLUMN next_drawing_at TEXT;
ALTER TABLE walmart_drawing_state ADD COLUMN reminders_sent_json TEXT DEFAULT '{}';
