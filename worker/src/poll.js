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
// Fast lane: every Pokémon listing + the Walmart-drawing check, ALL
//   checked every single tick (every 1 min) — full coverage every ~60s,
//   not a ~5min rotation. This was changed specifically to compete with
//   (or beat) third-party restock-alert apps/services that check more
//   often than once-every-several-minutes per item.
// Slow lane: the 12 MTG + Lorcana listings, still staggered — one slot
//   advanced only every SLOW_LANE_EVERY_N_TICKS ticks, since there's no
//   reason those need Pokémon's level of urgency and keeping them
//   staggered leaves more subrequest/CPU headroom for the fast lane.
//
// Retune by changing SLOW_LANE_EVERY_N_TICKS (env var, see wrangler.toml)
// or by moving products between poll_tier 'fast'/'slow' — see
// /api/admin/set-tier in index.js. Moving more products into 'fast' adds
// more concurrent fetches to every tick (still well under the 50-
// subrequest-per-invocation limit at current tracked-product counts, but
// worth watching if the fast lane grows a lot).

import { scrapeGeneric, scrapeWalmartDrawing } from './scrapers.js';
import { notifyAll } from './push.js';
import { runHeadsUpCheck, HEADS_UP_CHECK_COUNT } from './headsup.js';
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

  await updateListing(env, {
    product_id: row.product_id,
    retailer: row.retailer,
    last_price: result.price,
    last_stock: suspicious ? 'unknown' : result.stock,
    last_purchasable: nowPurchasable ? 1 : 0,
    last_checked_at: now,
  });

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
  await Promise.all([
    ...fastListings.map((row) => pollOneListing(env, row)),
    pollWalmartDrawing(env),
  ]);
  const fastIdx = 0;

  const tickCount = state.tick_count + 1;

  // Slow lane: only advances every `slowEveryN` ticks, so a 12-listing lane
  // completes a full cycle roughly every (12 * slowEveryN) minutes.
  let slowIdx = state.slow_idx;
  if (slowListings.length > 0 && tickCount % slowEveryN === 0) {
    slowIdx = (state.slow_idx + 1) % slowListings.length;
    await pollOneListing(env, slowListings[slowIdx]);
  }

  // Heads-up (early signal) lane: one source every HEADS_UP_EVERY_N_TICKS
  // ticks, rotating through TrackaLacker/TCG Drop Radar/autoqueue/Reddit.
  // Stateless on purpose (derived from tick_count, no extra column) — see
  // headsup.js for why these are checked at all and how they're labeled.
  const headsUpEveryN = parseInt(env.HEADS_UP_EVERY_N_TICKS || '5', 10);
  if (tickCount % headsUpEveryN === 0) {
    const headsUpIdx = Math.floor(tickCount / headsUpEveryN) % HEADS_UP_CHECK_COUNT;
    await runHeadsUpCheck(env, headsUpIdx);
  }

  await setPollState(env, { fast_idx: fastIdx, slow_idx: slowIdx, tick_count: tickCount });
}
