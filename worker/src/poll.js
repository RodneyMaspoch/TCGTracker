// poll.js — the staggered rotation that replaces the Node version's
// setInterval-based poller.js. Why staggered instead of "check the whole
// tier every tick": Cloudflare Workers' free plan caps a single Cron
// Trigger invocation at 10ms of CPU time. Looping through all ~16 tracked
// listings and parsing each page in one tick (the Node version's design)
// risks blowing that budget in one invocation. Instead, this Worker fires
// every minute and checks only ONE (sometimes two) listing per tick,
// rotating through a fixed order — same total coverage, spread out over
// time instead of bursted into one invocation.
//
// Fast lane: the 4 Pokémon listings + a Walmart-drawing check, one slot
//   advanced every tick (every 1 min) — full cycle every ~5 minutes.
// Slow lane: the 12 MTG + Lorcana listings, one slot advanced only every
//   SLOW_LANE_EVERY_N_TICKS ticks — at the default of 3, a full cycle is
//   ~36 minutes, in the same ballpark as the Node version's 30min tier.
//
// Retune by changing SLOW_LANE_EVERY_N_TICKS (env var, see wrangler.toml)
// or by moving products between poll_tier 'fast'/'slow' — see
// /api/admin/set-tier in index.js. Moving more products into 'fast'
// lengthens the fast lane's own full-cycle time in exchange for reacting
// to unlisted products sooner; there's no free way to check everything
// every 90s on the free plan, this is the real tradeoff being made.

import { scrapeGeneric, scrapeWalmartDrawing, checkTargetRedsky, extractTargetTcin } from './scrapers.js';
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

// Target listings: prefer the Redsky API for purchasable/stock (see the
// long comment on checkTargetRedsky in scrapers.js for why — it's Target's
// own intentionally-public fulfillment endpoint, more reliable than HTML
// scraping and much less likely to hit a bot-block). Redsky doesn't return
// price, so price still comes from the generic scrape when available.
// Falls back to generic-scrape-only (the old behavior) if Redsky fails
// for any reason — same "degrade, don't break" posture as every other
// retailer here.
async function resolveListingResult(row) {
  if (row.retailer !== 'target') {
    return scrapeGeneric(row.url);
  }

  const tcin = extractTargetTcin(row.url);
  if (!tcin) {
    console.warn(`[poll] target listing ${row.product_id} has no TCIN in its URL (${row.url}) — falling back to generic scrape`);
    return scrapeGeneric(row.url);
  }

  let redsky;
  try {
    redsky = await checkTargetRedsky(tcin);
  } catch (err) {
    console.warn(`[poll] Redsky check failed for ${row.product_id} (tcin ${tcin}): ${err.message} — falling back to generic scrape`);
    return scrapeGeneric(row.url);
  }

  // Redsky succeeded — it's authoritative for stock/purchasable. Still try
  // the generic scrape too, just for price; a failure there shouldn't
  // throw away the Redsky result, it just means no price this cycle.
  // Keep `source` as whatever the generic scrape's own price extraction
  // used ('json-ld' or 'text-heuristic') rather than a Target-specific
  // label — pollOneListing's suspicious-price sanity check below keys off
  // `source === 'text-heuristic'` and still needs to catch a garbage
  // text-heuristic price here too, even though Redsky (not this price)
  // decides purchasable.
  let price = null;
  let source = 'redsky-no-price';
  try {
    const generic = await scrapeGeneric(row.url);
    if (generic.price != null) {
      price = generic.price;
      source = generic.source;
    }
  } catch (err) {
    console.warn(`[poll] generic scrape for price failed for ${row.product_id} (Redsky stock check still used): ${err.message}`);
  }

  return { price, stock: redsky.stock, purchasable: redsky.purchasable, source };
}

async function pollOneListing(env, row) {
  let result;
  try {
    result = await resolveListingResult(row);
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
    const msg = `RESTOCK: ${row.product_name} is now purchasable at ${row.retailer}` + (result.price ? ` — $${result.price}` : '');
    await insertEvent(env, { created_at: now, kind: 'restock', product_id: row.product_id, message: msg, data_json: JSON.stringify(result) });
    await notifyAll(env, { title: '🟢 Restock', body: msg, url: '/', tag: `${row.product_id}-${row.retailer}` });
  }

  // Trigger 2b — good price, anchored to MSRP (see poller.js's original
  // long comment in the Node version's git history for why MSRP has to
  // lead this comparison rather than TCGPlayer).
  if (nowPurchasable && result.price != null && row.tcgplayer_ref && row.msrp) {
    const markupOverMsrp = (row.tcgplayer_ref - row.msrp) / row.msrp;
    const retailPremiumOverMsrp = (result.price - row.msrp) / row.msrp;

    if (markupOverMsrp >= MIN_MARKUP_OVER_MSRP && retailPremiumOverMsrp <= MAX_RETAIL_PREMIUM_OVER_MSRP) {
      const msg = `GOOD PRICE: ${row.product_name} — MSRP $${row.msrp.toFixed(2)}, TCGPlayer $${row.tcgplayer_ref.toFixed(2)} (+${Math.round(markupOverMsrp * 100)}% over MSRP) — purchasable now at ${row.retailer} for $${result.price.toFixed(2)}`;
      await insertEvent(env, {
        created_at: now,
        kind: 'good_price',
        product_id: row.product_id,
        message: msg,
        data_json: JSON.stringify({ ...result, msrp: row.msrp, tcgplayer_ref: row.tcgplayer_ref, markupOverMsrp, retailPremiumOverMsrp }),
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

  // Fast lane: fastListings.length real listings + 1 pseudo-slot for the
  // Walmart drawing check, advanced every single tick.
  const fastLaneLength = fastListings.length + 1;
  const fastIdx = fastLaneLength > 0 ? (state.fast_idx + 1) % fastLaneLength : -1;
  if (fastIdx >= 0 && fastIdx < fastListings.length) {
    await pollOneListing(env, fastListings[fastIdx]);
  } else if (fastIdx === fastListings.length) {
    await pollWalmartDrawing(env);
  }

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
