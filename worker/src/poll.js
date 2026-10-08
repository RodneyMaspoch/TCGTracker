// poll.js — staggered rotation for the slow lane, parallel full-sweep for
// the fast lane. Cloudflare Workers' free plan caps a single Cron Trigger
// invocation at 10ms of CPU TIME — but CPU time is actual compute, not
// wall-clock: time spent awaiting fetch() doesn't count against it. That
// means running every fast-lane listing's fetch concurrently (Promise.all)
// and doing their (cheap, regex-only) parsing afterward comfortably fits
// the budget, since 5-6 small HTML parses add up to a fraction of a
// millisecond of real CPU work — it's the SEQUENTIAL "one every tick"
// rotation that was wasting most of the available speed, not a CPU limit.
//
// 2026-10-05: "a tick" no longer means "once a minute." tick() (this
// file's export) is now called every ~15s by the Ticker Durable Object's
// self-re-arming alarm (see ticker-do.js) instead of directly by a Cron
// Trigger — Cron Triggers can't fire faster than once a minute on any
// Workers plan, which was the actual ceiling on alert speed before. All
// the "every tick" / "every N ticks" language below is still accurate,
// just ~4x faster in wall-clock terms than when it was written.
//
// Fast lane: every Pokémon listing + the Walmart-drawing check, ALL
//   checked every single tick (every ~15s) — full coverage every ~15s,
//   not a ~5min rotation. This was changed specifically to compete with
//   (or beat) third-party restock-alert apps/services that check more
//   often than once-every-several-minutes per item. Trade-off: this also
//   means ~4x more HTTP requests/day land on the actual retailer pages
//   being scraped — if any retailer's bot-detection starts reacting
//   differently (CAPTCHAs, 403s), TICK_INTERVAL_MS in ticker-do.js is the
//   first thing to turn back up.
// Slow lane: the 12 MTG + Lorcana listings, still staggered — one slot
//   advanced only every SLOW_LANE_EVERY_N_TICKS ticks, since there's no
//   reason those need Pokémon's level of urgency and keeping them
//   staggered leaves more subrequest/CPU headroom for the fast lane. A
//   full 12-listing cycle is now ~(12 * SLOW_LANE_EVERY_N_TICKS * 15s),
//   not ...* 60s — e.g. the default of 3 means a ~9min full cycle now,
//   down from ~36min.
//
// Retune by changing SLOW_LANE_EVERY_N_TICKS (env var, see wrangler.toml)
// or by moving products between poll_tier 'fast'/'slow' — see
// /api/admin/set-tier in index.js. Moving more products into 'fast' adds
// more concurrent fetches to every tick (still well under the 50-
// subrequest-per-invocation limit at current tracked-product counts, but
// worth watching if the fast lane grows a lot).

import { scrapeGeneric, scrapeWalmartDrawing } from './scrapers.js';
import { notifyAll } from './push.js';
import { runHeadsUpCheck } from './headsup.js';
import {
  getListingsForLane,
  updateListing,
  insertEvent,
  getDrawingState,
  updateDrawingState,
  getPollState,
  setPollState,
} from './db.js';

const MIN_MARKUP_OVER_MSRP = 0.25; // TCGPlayer must be >= 25% over MSRP
const MAX_RETAIL_PREMIUM_OVER_MSRP = 0.10; // retail price must be <= 10% over MSRP

// Retailer slugs (see seed-data.js) are DB/URL-safe identifiers —
// 'target', 'walmart_marketplace', 'bestbuy' — never meant to be shown to
// a person. Every event message was interpolating the raw slug directly
// ("...purchasable at target"), which is why it never capitalized. This
// is the one place that turns a slug into the name a person should see.
const RETAILER_LABELS = {
  target: 'Target',
  walmart: 'Walmart',
  walmart_marketplace: 'Walmart Marketplace',
  bestbuy: 'Best Buy',
  gamestop: 'GameStop',
  secretlair: 'Secret Lair',
  miniaturemarket: 'Miniature Market',
  disneylorcana: 'Disney Lorcana',
  ravensburger: 'Ravensburger',
  pokemoncenter: 'Pokémon Center',
  nintendo: 'Nintendo Official Store',
};
function retailerLabel(slug) {
  return RETAILER_LABELS[slug] || slug;
}

async function pollOneListing(env, row) {
  let result;
  try {
    result = await scrapeGeneric(row.url);
  } catch (err) {
    console.warn(`[poll] fetch failed for ${row.retailer}/${row.product_id}: ${err.message}`);
    return;
  }

  const now = new Date().toISOString();
  const wasPurchasable = !!row.last_purchasable;
  let nowPurchasable = !!result.purchasable;

  // Same sanity check as the Node version: a text-heuristic result (no
  // JSON-LD found) with a price wildly outside the product's MSRP range is
  // more likely a mis-parsed page than a real price — don't act on it.
  let suspicious = false;
  if (result.source === 'text-heuristic' && nowPurchasable && row.msrp && result.price != null) {
    const ratio = result.price / row.msrp;
    if (ratio < 0.3 || ratio > 8) {
      suspicious = true;
      nowPurchasable = false;
      console.warn(`[poll] suspicious result for ${row.retailer}/${row.product_id}: price $${result.price} vs MSRP $${row.msrp} (ratio ${ratio.toFixed(2)}) via text-heuristic — ignoring`);
    }
  }

  // 2026-10-02: this was an unguarded `await` — if the DB write throws for
  // ANY reason (the most likely one in practice: migration 0004, which
  // added the `image_url` column this query writes to, hasn't been run
  // yet against the live D1 database), the exception aborted this
  // function right here, before the restock/good-price checks below ever
  // ran. Since this call happens on every listing on every tick, that
  // meant a single un-applied migration could silently zero out the
  // ENTIRE alert pipeline — no restock alert, no good-price alert, for
  // ANY product — while looking, from the outside, exactly like "alerts
  // just never fire." The trigger checks below only need `row`/`result`,
  // not a successful write, so a DB failure here is now logged and
  // swallowed instead of skipping the checks that actually matter.
  try {
    await updateListing(env, {
      product_id: row.product_id,
      retailer: row.retailer,
      last_price: result.price,
      last_stock: suspicious ? 'unknown' : result.stock,
      last_purchasable: nowPurchasable ? 1 : 0,
      last_checked_at: now,
      image_url: result.image ?? null,
    });
  } catch (err) {
    console.error(`[poll] updateListing failed for ${row.retailer}/${row.product_id} (continuing to trigger checks anyway): ${err.message}`);
  }

  if (suspicious) return;

  // Trigger 4 — restock.
  if (!wasPurchasable && nowPurchasable) {
    const msg = `RESTOCK: ${row.product_name} is now purchasable at ${retailerLabel(row.retailer)}` + (result.price ? ` — $${result.price}` : '');
    // row.url is the actual retailer product page being polled — it was
    // never carried into data_json before, so the "Recent Alerts" list
    // had a real restock event but nothing to link out to (the user
    // asked for these to be clickable, same as the restock alert
    // services list already is).
    await insertEvent(env, { created_at: now, kind: 'restock', product_id: row.product_id, message: msg, data_json: JSON.stringify({ ...result, url: row.url }) });
    await notifyAll(env, { title: '🟢 Restock', body: msg, url: '/', tag: `${row.product_id}-${row.retailer}` });
  }

  // Trigger 2b — good price, anchored to MSRP (see poller.js's original
  // long comment in the Node version's git history for why MSRP has to
  // lead this comparison rather than TCGPlayer).
  if (nowPurchasable && result.price != null && row.tcgplayer_ref && row.msrp) {
    const markupOverMsrp = (row.tcgplayer_ref - row.msrp) / row.msrp;
    const retailPremiumOverMsrp = (result.price - row.msrp) / row.msrp;

    if (markupOverMsrp >= MIN_MARKUP_OVER_MSRP && retailPremiumOverMsrp <= MAX_RETAIL_PREMIUM_OVER_MSRP) {
      const msg = `GOOD PRICE: ${row.product_name} — MSRP $${row.msrp.toFixed(2)}, TCGPlayer $${row.tcgplayer_ref.toFixed(2)} (+${Math.round(markupOverMsrp * 100)}% over MSRP) — purchasable now at ${retailerLabel(row.retailer)} for $${result.price.toFixed(2)}`;
      await insertEvent(env, {
        created_at: now,
        kind: 'good_price',
        product_id: row.product_id,
        message: msg,
        data_json: JSON.stringify({ ...result, url: row.url, msrp: row.msrp, tcgplayer_ref: row.tcgplayer_ref, markupOverMsrp, retailPremiumOverMsrp }),
      });
      await notifyAll(env, { title: '💰 Good price vs. MSRP/TCGPlayer', body: msg, url: '/', tag: `${row.product_id}-goodprice` });
    }
  }
}

// 2026-10-08 — user request: alert ahead of time, not just when the
// drawing is already open. Four lead-time tiers, each fired at most once
// per announced drawing (see REMINDER_TIERS below). A tier only fires
// inside a short grace window after its target moment — this does two
// things: (1) keeps a single ~15s tick from ever double-firing the same
// tier, since reminders_sent_json is checked and updated together, and
// (2) means a drawing first discovered close to go-live (e.g. spotted
// only 2 hours ahead) does NOT fire the "day before" tier late — that
// tier's window has already passed by the time we saw it, so it's marked
// sent-without-notifying rather than firing a stale/confusing reminder.
const REMINDER_TIERS = [
  { key: 'day_before', leadMs: 24 * 3600 * 1000, label: 'Tomorrow' },
  { key: 'hour_before', leadMs: 60 * 60 * 1000, label: 'In 1 hour' },
  { key: 'fifteen_before', leadMs: 15 * 60 * 1000, label: 'In 15 minutes' },
  { key: 'go_live', leadMs: 0, label: 'Now' },
];
const REMINDER_GRACE_MS = 5 * 60 * 1000; // 5min window to actually fire a tier

async function checkDrawingReminders(env, prev, nextDrawingAt, nowMs, nowIso) {
  if (!nextDrawingAt) return;
  const drawingMs = new Date(nextDrawingAt).getTime();
  if (isNaN(drawingMs)) return;

  // A new/changed drawing time resets which tiers have already fired —
  // otherwise the first tick after Walmart posts a NEW drawing would see
  // the old reminders_sent flags and (for a tier whose window happens to
  // already be open) silently skip sending anything for the new one.
  const prevNextAt = prev?.next_drawing_at || null;
  let sent = {};
  if (prevNextAt === nextDrawingAt) {
    try {
      sent = prev?.reminders_sent_json ? JSON.parse(prev.reminders_sent_json) : {};
    } catch (_) {
      sent = {};
    }
  }

  for (const tier of REMINDER_TIERS) {
    if (sent[tier.key]) continue;
    const targetMs = drawingMs - tier.leadMs;
    if (nowMs < targetMs) continue; // too early for this tier still
    sent[tier.key] = true; // mark handled either way — fired now, or too late to fire meaningfully
    if (nowMs > targetMs + REMINDER_GRACE_MS) {
      console.warn(`[poll] Walmart drawing reminder tier '${tier.key}' window already passed when first seen — skipping, not sending late`);
      continue;
    }
    const msg = tier.key === 'go_live'
      ? 'Walmart Collectibles Drawing should be opening right about now — go check (odds are equal all window, but it\'s time-limited).'
      : `Walmart Collectibles Drawing opens ${tier.label.toLowerCase()} (${new Date(nextDrawingAt).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' })} ET).`;
    await insertEvent(env, { created_at: nowIso, kind: 'drawing_reminder', product_id: null, message: msg, data_json: JSON.stringify({ tier: tier.key, nextDrawingAt }) });
    await notifyAll(env, { title: `⏰ Walmart drawing — ${tier.label}`, body: msg, url: 'https://www.walmart.com/shop/collectibles/draw', tag: `walmart-drawing-${tier.key}` });
  }

  await updateDrawingState(env, {
    is_open: prev?.is_open ?? 0,
    items_json: prev?.items_json ?? null,
    last_checked_at: nowIso,
    next_drawing_at: nextDrawingAt,
    reminders_sent_json: JSON.stringify(sent),
  });
}

async function pollWalmartDrawing(env) {
  let result;
  try {
    result = await scrapeWalmartDrawing();
  } catch (err) {
    console.warn(`[poll] Walmart drawing fetch failed: ${err.message}`);
    return;
  }
  const prev = await getDrawingState(env);
  const now = new Date().toISOString();
  await updateDrawingState(env, { is_open: result.isOpen ? 1 : 0, items_json: JSON.stringify(result), last_checked_at: now });

  if (!prev?.is_open && result.isOpen) {
    const msg = 'Walmart Collectibles Drawing just opened a new window — go enter (odds are equal all window, but the window is time-limited).';
    await insertEvent(env, { created_at: now, kind: 'drawing_open', product_id: null, message: msg, data_json: JSON.stringify(result) });
    await notifyAll(env, { title: '🎟️ Walmart drawing OPEN', body: msg, url: 'https://www.walmart.com/shop/collectibles/draw', tag: 'walmart-drawing' });
  }

  // Lead-time reminders (day-before/1h/15m/go-live) — separate from the
  // is_open-transition alert above, which only fires once Walmart's page
  // actually confirms entries are open. This fires on the CLOCK reaching
  // the announced time, which can be a useful few-seconds-earlier signal
  // than waiting for the next scrape to re-confirm isOpen, especially
  // right at go-live when every second counts.
  try {
    await checkDrawingReminders(env, prev, result.nextDrawingAt, Date.now(), now);
  } catch (err) {
    console.error('[poll] Walmart drawing reminder check failed:', err);
  }
}

export async function tick(env) {
  const slowEveryN = parseInt(env.SLOW_LANE_EVERY_N_TICKS || '3', 10);

  const fastListings = await getListingsForLane(env, 'fast');
  const slowListings = await getListingsForLane(env, 'slow');
  const state = await getPollState(env);

  // Fast lane: EVERY listing (not one-at-a-time) checked concurrently,
  // every tick — see the top-of-file comment for why this is safe under
  // the 10ms CPU budget (fetch() wait time is free; it's sequential
  // rotation that was slow, not a CPU ceiling). fast_idx is no longer
  // used to pick a slot, but is still written back as 0 so the
  // poll_state row's schema/shape doesn't need a migration.
  // allSettled, not all — a single listing throwing (bad scrape, DB error,
  // whatever) must never take the rest of the tick down with it. With
  // Promise.all, one rejection here would skip EVERYTHING after this
  // block for the rest of the tick, including setPollState at the bottom
  // — which would freeze tick_count forever and, with it, the slow-lane
  // rotation and the heads-up rotation (both keyed off tick_count). That's
  // a second, independent way the alert pipeline could go silently dark
  // besides the missing-migration bug fixed in pollOneListing above, so
  // this is defended the same way: isolate failures, log them, keep going.
  const settled = await Promise.allSettled([
    ...fastListings.map((row) => pollOneListing(env, row)),
    pollWalmartDrawing(env),
  ]);
  for (const s of settled) {
    if (s.status === 'rejected') console.error('[poll] fast-lane task rejected:', s.reason);
  }
  const fastIdx = 0;

  const tickCount = state.tick_count + 1;

  // Slow lane: only advances every `slowEveryN` ticks, so a 12-listing lane
  // completes a full cycle roughly every (12 * slowEveryN) ticks — ticks
  // are now ~15s apart (see top-of-file comment), not 1 minute.
  let slowIdx = state.slow_idx;
  if (slowListings.length > 0 && tickCount % slowEveryN === 0) {
    slowIdx = (state.slow_idx + 1) % slowListings.length;
    try {
      await pollOneListing(env, slowListings[slowIdx]);
    } catch (err) {
      console.error('[poll] slow-lane task rejected:', err);
    }
  }

  // Heads-up (early signal) lane: 2026-10-05 — was one source rotated in
  // every HEADS_UP_EVERY_N_TICKS ticks (default 5), so with 7 sources any
  // single one was only re-checked roughly every 35 ticks (originally ~35
  // min, back when a tick was 1 minute) in the worst case. "The point is
  // to get the alert right away" means that gap defeats the whole
  // feature, so every source now runs concurrently on every tick instead
  // — same CPU-time-vs-fetch-time reasoning as the fast lane above
  // (runHeadsUpCheck itself uses Promise.allSettled across all sources,
  // see headsup.js). Combined with ticks themselves now firing every
  // ~15s via the Ticker Durable Object (see ticker-do.js) instead of once
  // a minute via Cron Trigger, every heads-up source is effectively
  // re-checked every ~15s now, not just every tick — the real floor is
  // now TICK_INTERVAL_MS in ticker-do.js, not Cron Triggers' once-a-minute
  // limit (that limit still applies to the plain Cron Trigger itself,
  // which is why the loop was moved onto a Durable Object alarm instead).
  try {
    await runHeadsUpCheck(env);
  } catch (err) {
    console.error('[poll] heads-up check rejected:', err);
  }

  await setPollState(env, { fast_idx: fastIdx, slow_idx: slowIdx, tick_count: tickCount });
}
