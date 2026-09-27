// poller.js — the actual "catch it fast" loop. Two tiers:
//   fast: every FAST_INTERVAL_MS (default 90s) — Pokémon products, per your
//         scoping choice to start narrow and avoid tripping rate limits.
//   slow: every SLOW_INTERVAL_MS (default 30min) — MTG + Lorcana, matching
//         roughly what the hourly Claude-based check already did, just
//         folded into this same server so the PWA has one data source.
// Also polls the Walmart Collectibles Drawing page on the fast tier,
// since a drawing opening is exactly the kind of event that needs to be
// caught quickly (even though, per the drawing's own rules, entering
// early vs. late within the window doesn't change your odds — knowing
// it's open at all is what matters and what's time-sensitive).

const db = require('./db');
const { scrapeGeneric, scrapeWalmartDrawing } = require('./scrapers');
const { notifyAll } = require('./push');

const FAST_INTERVAL_MS = parseInt(process.env.FAST_INTERVAL_MS || '90000', 10);   // 90s default
const SLOW_INTERVAL_MS = parseInt(process.env.SLOW_INTERVAL_MS || '1800000', 10); // 30min default

// Trigger 2b thresholds — see the long comment on pollOneListing below for
// why MSRP has to lead this comparison, not TCGPlayer.
const MIN_MARKUP_OVER_MSRP = parseFloat(process.env.GOOD_PRICE_MIN_MARKUP || '0.25');       // TCGPlayer must be >= 25% over MSRP
const MAX_RETAIL_PREMIUM_OVER_MSRP = parseFloat(process.env.GOOD_PRICE_MAX_PREMIUM || '0.10'); // retail price must be <= 10% over MSRP

const getListingsForTier = db.prepare(`
  SELECT rl.*, p.name as product_name, p.msrp, p.tcgplayer_ref, p.game
  FROM retailer_listings rl
  JOIN products p ON p.id = rl.product_id
  WHERE p.poll_tier = ?
`);

const updateListing = db.prepare(`
  UPDATE retailer_listings
  SET last_price = @last_price, last_stock = @last_stock, last_purchasable = @last_purchasable, last_checked_at = @last_checked_at
  WHERE product_id = @product_id AND retailer = @retailer
`);

const insertEvent = db.prepare(`
  INSERT INTO events (created_at, kind, product_id, message, data_json)
  VALUES (@created_at, @kind, @product_id, @message, @data_json)
`);

const updateDrawingState = db.prepare(`
  UPDATE walmart_drawing_state SET is_open=@is_open, items_json=@items_json, last_checked_at=@last_checked_at WHERE id=1
`);
const getDrawingState = db.prepare(`SELECT * FROM walmart_drawing_state WHERE id=1`);

async function pollOneListing(row) {
  let result;
  try {
    result = await scrapeGeneric(row.url);
  } catch (err) {
    console.warn(`[poller] fetch failed for ${row.retailer}/${row.product_id}: ${err.message}`);
    return;
  }

  const now = new Date().toISOString();
  const wasPurchasable = !!row.last_purchasable;
  const nowPurchasable = !!result.purchasable;

  updateListing.run({
    product_id: row.product_id,
    retailer: row.retailer,
    last_price: result.price,
    last_stock: result.stock,
    last_purchasable: nowPurchasable ? 1 : 0,
    last_checked_at: now,
  });

  // Trigger 4 — restock: not purchasable -> purchasable.
  if (!wasPurchasable && nowPurchasable) {
    const msg = `RESTOCK: ${row.product_name} is now purchasable at ${row.retailer}` + (result.price ? ` — $${result.price}` : '');
    insertEvent.run({ created_at: now, kind: 'restock', product_id: row.product_id, message: msg, data_json: JSON.stringify(result) });
    await notifyAll({ title: '🟢 Restock', body: msg, url: '/', tag: `${row.product_id}-${row.retailer}` });
  }

  // Trigger 2b — good price, anchored to MSRP (not to TCGPlayer).
  //
  // The original version of this compared the live retail price directly
  // against TCGPlayer and fired whenever retail was >=15% under it. That's
  // backwards: TCGPlayer is the secondary/resale price, and for exactly the
  // kind of hyped sealed product this app tracks, TCGPlayer is almost
  // always well above MSRP. That means "retail price is well under
  // TCGPlayer" was true almost all the time, including for a scalped
  // third-party listing that's marked up 30-40% over MSRP but still
  // cheaper than TCGPlayer's ceiling — which is not a good price, it's
  // just a slightly-less-bad markup. Comparing to TCGPlayer alone can't
  // tell the difference between "this is basically MSRP" and "this is
  // marked up but still a relative bargain vs. resale."
  //
  // The fix: MSRP leads. Two conditions, both anchored to MSRP:
  //   1. TCGPlayer must sit meaningfully above MSRP (>= MIN_MARKUP_OVER_MSRP,
  //      default 25%) — this is what tells you the item has real resale
  //      demand worth caring about at all.
  //   2. The retail price you'd actually pay must be at or near MSRP
  //      (<= MAX_RETAIL_PREMIUM_OVER_MSRP over it, default 10%) — this is
  //      what tells you *this specific listing* isn't itself a marked-up
  //      scalper price just because it happens to undercut TCGPlayer.
  // Only when both hold is this "MSRP is $50, TCGPlayer has it at $200+,
  // and you can actually buy it near $50 right now" — the exact scenario
  // you described wanting flagged.
  if (nowPurchasable && result.price != null && row.tcgplayer_ref && row.msrp) {
    const markupOverMsrp = (row.tcgplayer_ref - row.msrp) / row.msrp;
    const retailPremiumOverMsrp = (result.price - row.msrp) / row.msrp;

    if (markupOverMsrp >= MIN_MARKUP_OVER_MSRP && retailPremiumOverMsrp <= MAX_RETAIL_PREMIUM_OVER_MSRP) {
      const msg = `GOOD PRICE: ${row.product_name} — MSRP $${row.msrp.toFixed(2)}, TCGPlayer $${row.tcgplayer_ref.toFixed(2)} (+${Math.round(markupOverMsrp * 100)}% over MSRP) — purchasable now at ${row.retailer} for $${result.price.toFixed(2)}`;
      insertEvent.run({
        created_at: now,
        kind: 'good_price',
        product_id: row.product_id,
        message: msg,
        data_json: JSON.stringify({ ...result, msrp: row.msrp, tcgplayer_ref: row.tcgplayer_ref, markupOverMsrp, retailPremiumOverMsrp }),
      });
      await notifyAll({ title: '💰 Good price vs. MSRP/TCGPlayer', body: msg, url: '/', tag: `${row.product_id}-goodprice` });
    }
  }
}

async function pollWalmartDrawing() {
  let result;
  try {
    result = await scrapeWalmartDrawing();
  } catch (err) {
    console.warn(`[poller] Walmart drawing fetch failed: ${err.message}`);
    return;
  }
  const prev = getDrawingState.get();
  const now = new Date().toISOString();
  updateDrawingState.run({ is_open: result.isOpen ? 1 : 0, items_json: JSON.stringify(result), last_checked_at: now });

  if (!prev.is_open && result.isOpen) {
    const msg = 'Walmart Collectibles Drawing just opened a new window — go enter (odds are equal all window, but the window is time-limited).';
    insertEvent.run({ created_at: now, kind: 'drawing_open', product_id: null, message: msg, data_json: JSON.stringify(result) });
    await notifyAll({ title: '🎟️ Walmart drawing OPEN', body: msg, url: 'https://www.walmart.com/shop/collectibles/draw', tag: 'walmart-drawing' });
  }
}

async function runTier(tier) {
  const rows = getListingsForTier.all(tier);
  // Sequential, not parallel — deliberately gentle on the retailers rather
  // than firing a burst of concurrent requests every cycle.
  for (const row of rows) {
    await pollOneListing(row);
  }
  if (tier === 'fast') {
    await pollWalmartDrawing();
  }
}

function start() {
  console.log(`[poller] fast tier every ${FAST_INTERVAL_MS / 1000}s, slow tier every ${SLOW_INTERVAL_MS / 1000}s`);
  runTier('fast').catch((e) => console.error('[poller] fast tier error', e));
  runTier('slow').catch((e) => console.error('[poller] slow tier error', e));
  setInterval(() => runTier('fast').catch((e) => console.error('[poller] fast tier error', e)), FAST_INTERVAL_MS);
  setInterval(() => runTier('slow').catch((e) => console.error('[poller] slow tier error', e)), SLOW_INTERVAL_MS);
}

module.exports = { start, runTier };
