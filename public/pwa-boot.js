// pwa-boot.js — shared by index.html (MTG) and lorcana.html: registers the
// service worker (installability + push receiving) and patches each page's
// own data arrays in place with live price/stock from this app's backend,
// matched by URL.
//
// Standing rule (2026-09-28, user request): nothing on these pages may
// present a static/fabricated value as if it were current fact. Every
// number here is either (a) patched from a real scrape below, or (b) a
// known fixed fact (an MSRP, a product name) that isn't time-sensitive.
// A field with no live match yet shows an honest "not yet checked" state
// instead of a frozen old number — see refreshDeals/refreshHot/refreshWatch.
// This is intentionally the ONLY thing that changed about how these pages
// get their data — layout, copy, images, and interactions are untouched.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch((err) => {
    console.error('[pwa-boot] service worker registration failed', err);
  });
}

async function fetchListingByUrl() {
  const products = await fetch('/api/products').then((r) => r.json());
  const listingByUrl = {};
  for (const p of products) {
    for (const l of p.listings || []) listingByUrl[l.url] = l;
  }
  return listingByUrl;
}

function checkedLabel(lastCheckedAt) {
  return lastCheckedAt
    ? 'checked ' + new Date(lastCheckedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'not yet checked';
}

// ALL_DEALS ("Tracking Now" grid): price, stock, delta vs MSRP, ago, and a
// flat 10-point series (real 30-day history needs a price-tracking
// integration this doesn't have yet — a live snapshot isn't a trend, so
// this never fabricates a history graph, just repeats the live price so
// the sparkline math doesn't divide by zero).
function patchDeals(dealsArray, listingByUrl) {
  let changed = false;
  for (const d of dealsArray) {
    const l = listingByUrl[d.url];
    d.ago = checkedLabel(l && l.last_checked_at);
    if (!l || l.last_price == null) continue;

    const price = Number(l.last_price);
    const msrpNum = d.msrp ? parseFloat(String(d.msrp).replace(/[^0-9.]/g, '')) : null;

    d.price = '$' + price.toFixed(2);
    d.stock = l.last_purchasable
      ? 'IN STOCK'
      : l.last_stock === 'oos'
        ? 'OUT OF STOCK'
        : l.last_stock === 'account_gated'
          ? 'ACCOUNT REQUIRED'
          : 'STATUS UNKNOWN';
    d.under = msrpNum != null && price < msrpNum;
    // Only fills a currently-empty art slot (e.g. the Hobbit Play Booster
    // listings, which start with art:'' and an honest "no verified photo
    // yet" slotHint) from a live-scraped photo — never overwrites an
    // already-curated image already in the page's own data.
    if (!d.art && l.image_url) d.art = l.image_url;

    if (msrpNum != null && msrpNum > 0) {
      const pct = Math.round(((price - msrpNum) / msrpNum) * 100);
      d.delta = pct === 0
        ? 'AT MSRP'
        : pct < 0
          ? Math.abs(pct) + '% OFF MSRP · SAVE $' + (msrpNum - price).toFixed(2)
          : '+' + pct + '% OVER MSRP';
    }

    d.series = Array(10).fill(price);
    changed = true;
  }
  return changed;
}

// HOT_ITEMS ("Signal Check" cards): heat (purchasable/stock status) + price
// + ago, all from the real scrape. No "buzz" percentage here — there's no
// real signal-strength data behind one, so that field was removed rather
// than left fabricated (see the comment on HOT_ITEMS itself).
function patchHot(hotItems, listingByUrl) {
  let changed = false;
  for (const h of hotItems) {
    const l = listingByUrl[h.url];
    h.ago = checkedLabel(l && l.last_checked_at);
    if (!l) continue;

    h.heat = l.last_purchasable
      ? 'IN STOCK'
      : l.last_stock === 'oos'
        ? 'OUT OF STOCK'
        : l.last_stock === 'account_gated'
          ? 'ACCOUNT REQUIRED'
          : 'STATUS UNKNOWN';
    if (l.last_price != null) h.price = '$' + Number(l.last_price).toFixed(2);
    if (!h.art && l.image_url) h.art = l.image_url;
    changed = true;
  }
  return changed;
}

// WATCH_ITEMS ("Recently released, price watch" bar): now + a REAL
// now-vs-MSRP percentage (was is a known fixed MSRP, not fabricated), + ago.
function patchWatch(watchItems, listingByUrl) {
  let changed = false;
  for (const w of watchItems) {
    const l = listingByUrl[w.url];
    w.ago = checkedLabel(l && l.last_checked_at);
    if (!l || l.last_price == null) continue;

    const price = Number(l.last_price);
    const msrpNum = w.was ? parseFloat(String(w.was).replace(/[^0-9.]/g, '')) : null;
    w.now = '$' + price.toFixed(2);
    w.pct = msrpNum != null && msrpNum > 0 ? Math.round(((price - msrpNum) / msrpNum) * 100) : null;
    if (!w.art && l.image_url) w.art = l.image_url;
    changed = true;
  }
  return changed;
}

window.TCGLiveData = {
  // Back-compat name used by the existing componentDidMount calls.
  async refresh(dealsArray, onChanged) {
    let listingByUrl;
    try {
      listingByUrl = await fetchListingByUrl();
    } catch (err) {
      console.error('[pwa-boot] live data fetch failed', err);
      return;
    }
    if (patchDeals(dealsArray, listingByUrl) && typeof onChanged === 'function') onChanged();
  },

  // Preferred entry point going forward: patches all three data shapes off
  // a single fetch instead of one network round-trip per array.
  async refreshAll({ deals, hot, watch }, onChanged) {
    let listingByUrl;
    try {
      listingByUrl = await fetchListingByUrl();
    } catch (err) {
      console.error('[pwa-boot] live data fetch failed', err);
      return;
    }
    let changed = false;
    if (deals) changed = patchDeals(deals, listingByUrl) || changed;
    if (hot) changed = patchHot(hot, listingByUrl) || changed;
    if (watch) changed = patchWatch(watch, listingByUrl) || changed;
    if (changed && typeof onChanged === 'function') onChanged();
  },
};
