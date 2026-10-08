// scrapers.js — Workers-compatible rewrite of server/scrapers.js.
//
// WHY THIS FILE IS DIFFERENT FROM THE NODE VERSION: Cloudflare Workers'
// free plan caps every invocation (including a Cron Trigger tick) at 10ms
// of CPU time. The Node version used `cheerio`, a full HTML/DOM parser —
// building a DOM tree for a several-hundred-KB retailer page is exactly
// the kind of CPU-heavy work that risks blowing that budget. This version
// does the same two-step extraction (JSON-LD first, text-heuristic
// fallback) using plain regexes over the raw HTML string instead of a DOM
// parser — no tree construction, much less CPU per page. It's a little
// more fragile than a real parser (a regex can't "understand" markup the
// way a DOM can), but it's the same class of extraction the Node version's
// own fallback path already used for the text heuristic, just extended to
// the JSON-LD step too.
//
// Same boundary as the Node version: this only ever reads pages. Nothing
// here adds to cart, logs in, or submits any form.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const BLOCK_PAGE_SIGNS = /(access .{0,20}denied|are you a human|verify you are (a )?human|pardon our interruption|unusual traffic|automat(ed|ion) (access|request|tools)|request could not be satisfied|captcha|robot check|bot detection|something went wrong.{0,40}try again)/i;

async function fetchHtml(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

// Cheap "visible text" approximation: drop script/style blocks (so we don't
// accidentally match JS/CSS source text), strip remaining tags, collapse
// whitespace. Not as accurate as a real DOM's .textContent, but plenty for
// regex price/stock/block-page detection, and orders of magnitude cheaper
// than parsing a DOM tree.
function stripToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pulls every <script type="application/ld+json">...</script> block out via
// regex (no DOM parse) and JSON.parses each, looking for a schema.org
// Product with an `offers` field — same target the Node version's cheerio
// pass looked for, just found without building a tree.
function extractJsonLdProduct(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch (_) {
      continue; // not valid JSON — skip, keep scanning other blocks
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed];
    for (const c of candidates) {
      const graph = c['@graph'] ? c['@graph'] : [c];
      for (const g of graph) {
        if (g && g['@type'] === 'Product' && g.offers) return g;
      }
    }
  }
  return null;
}

function priceFromText(text) {
  const m = text.match(/\$\s?([0-9]{1,4}(?:\.[0-9]{2})?)/);
  return m ? parseFloat(m[1]) : null;
}

// Pulls a product photo straight off the retailer's own page — no manual
// upload, no hand-maintained map, because these are live products that
// change/go out of print. Two ways in, cheapest first:
//  1. schema.org Product JSON-LD's own `image` field — already being
//     parsed for price/availability in extractJsonLdProduct below, so this
//     just reads one more field off the same object. `image` can be a
//     plain string, an array of strings, or (rarely) an array of
//     ImageObject records with a `.url` — handle all three.
//  2. <meta property="og:image" content="..."> — a near-universal fallback
//     for pages with no JSON-LD Product block at all. One regex over the
//     raw HTML, same cost profile as the rest of this file (no DOM parse).
// Returns null (not a guess) if neither is present — the frontend already
// has an honest "no photo yet" placeholder for exactly this case.
function imageFromJsonLdProduct(product) {
  if (!product || !product.image) return null;
  const img = Array.isArray(product.image) ? product.image[0] : product.image;
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (typeof img === 'object' && img.url) return img.url;
  return null;
}

function imageFromOgTag(html) {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? m[1] : null;
}

function stockFromText(text) {
  const t = text.toLowerCase();
  if (/sold out|out of stock|currently unavailable|no longer available/.test(t)) return { stock: 'oos', purchasable: false };
  if (/sign in to (buy|purchase)|account required|invite only|request access/.test(t)) return { stock: 'account_gated', purchasable: false };
  if (/add to cart|add to bag|ship it|buy now/.test(t)) return { stock: 'in_stock', purchasable: true };
  return { stock: 'unknown', purchasable: false };
}

// Generic parser used for every retailer listing — tries JSON-LD first,
// falls back to text heuristics. Mirrors server/scrapers.js's scrapeGeneric.
export async function scrapeGeneric(url) {
  const html = await fetchHtml(url);
  const bodyTextForBlockCheck = stripToText(html).slice(0, 4000);
  if (BLOCK_PAGE_SIGNS.test(bodyTextForBlockCheck)) {
    throw new Error('page looks like a bot-check/interstitial page, not the real product page — skipping this cycle');
  }

  const product = extractJsonLdProduct(html);
  if (product) {
    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    const price = offers && offers.price ? parseFloat(offers.price) : null;
    const availability = (offers && offers.availability || '').toLowerCase();
    const purchasable = availability.includes('instock');
    const image = imageFromJsonLdProduct(product) || imageFromOgTag(html);
    return {
      price,
      stock: purchasable ? 'in_stock' : (availability ? 'oos' : 'unknown'),
      purchasable,
      image,
      source: 'json-ld',
    };
  }

  const bodyText = stripToText(html);
  const price = priceFromText(bodyText);
  const { stock, purchasable } = stockFromText(bodyText);
  const image = imageFromOgTag(html);
  return { price, stock, purchasable, image, source: 'text-heuristic' };
}

// ---------------------------------------------------------------------
// Target "Redsky" API — added 2026-09-30, per the user's explicit ask to
// actually build this instead of just leaving it as a suggestion in the
// project doc.
//
// Why this exists instead of just scraping Target's HTML like everything
// else: Target itself confirmed (per public reporting — see the project
// doc's "Retailer coverage gap" section) that this JSON endpoint is
// intentionally open, not a scraped/reverse-engineered internal API. It
// returns real fulfillment status directly — no HTML to parse, no risk of
// a block-page or a JSON-LD block silently going missing, and it's a much
// lighter request than fetching and stripping a several-hundred-KB page.
// This is the "quicker API check" upgrade referenced when Pokémon Center
// was added — implemented now rather than left as a note.
//
// This does NOT replace scrapeGeneric for Target — it only answers "is it
// purchasable" (shipping availability). Price still comes from the
// generic scrape (Redsky's fulfillment endpoint doesn't return price), so
// poll.js calls both and merges: Redsky for stock/purchasable, generic
// scrape for price. If Redsky fails for any reason (blocked, schema
// change, network error), the caller falls back to generic scraping
// alone — same failure posture as every other retailer here.
//
// The `key` below is the same one documented in public writeups of this
// endpoint (see project doc) as a static value embedded in Target's own
// frontend — Target's own engineers have described it as intentionally
// public, not a secret extracted by reverse engineering. store_id/zip/
// lat/long are a fixed reference location (not the user's own) since this
// only checks SHIP-TO-HOME availability, which isn't store-specific — the
// store-pickup fields in the response are logged for visibility but not
// used to decide purchasable, since pickup at one arbitrary store isn't a
// meaningful signal for "can anyone buy this online."
const REDSKY_KEY = 'ff457966e64d5e877fdbad070f276d18ecec4a01';
const REDSKY_REF_LOCATION = {
  store_id: '1859',
  zip: '98801',
  state: 'WA',
  latitude: '47.430',
  longitude: '-120.320',
};

// Target product URLs always embed the TCIN (Target's item id) as
// ".../A-<digits>" — e.g. ".../-/A-1012055693" → tcin "1012055693". This
// means no schema change / no extra column is needed to use Redsky: the
// tcin is derived from the same `url` already stored in retailer_listings.
export function extractTargetTcin(url) {
  const m = url.match(/\/A-(\d+)/);
  return m ? m[1] : null;
}

export async function checkTargetRedsky(tcin) {
  const p = new URLSearchParams({
    key: REDSKY_KEY,
    tcin,
    store_id: REDSKY_REF_LOCATION.store_id,
    store_positions_store_id: REDSKY_REF_LOCATION.store_id,
    has_store_positions_store_id: 'true',
    zip: REDSKY_REF_LOCATION.zip,
    state: REDSKY_REF_LOCATION.state,
    latitude: REDSKY_REF_LOCATION.latitude,
    longitude: REDSKY_REF_LOCATION.longitude,
    pricing_store_id: REDSKY_REF_LOCATION.store_id,
    has_pricing_store_id: 'true',
    is_bot: 'false',
  });
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_fulfillment_v1?${p.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': UA,
        'Origin': 'https://www.target.com',
        'Referer': 'https://www.target.com/',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Redsky HTTP ${res.status}`);
    const json = await res.json();
    const fulfillment = json?.data?.product?.fulfillment;
    if (!fulfillment) throw new Error('Redsky response missing fulfillment data — schema may have changed');

    const shipStatus = fulfillment.shipping_options?.availability_status;
    const shipQty = fulfillment.shipping_options?.available_to_promise_quantity ?? 0;
    const purchasable = shipStatus === 'IN_STOCK' && shipQty > 0;

    return {
      purchasable,
      stock: purchasable ? 'in_stock' : 'oos',
      source: 'redsky',
    };
  } finally {
    clearTimeout(timeout);
  }
}

// 2026-10-08 — user request: alert ahead of a drawing opening (day-before /
// 1h-before / 15m-before / at-go-live), not just when it's already open.
// That means we also need to know WHEN the next drawing starts, not just
// whether one is open right now. Per community trackers (autoqueue.app's
// own Walmart drops guide), Walmart's collectibles draw page itself lists
// upcoming drawings with their own date/time before entries open — this
// is a best-effort extraction of that text, NOT a verified-against-the-
// live-page regex (a direct fetch of walmart.com from here was blocked by
// a provenance/consent check, so this couldn't be tuned against real page
// copy before shipping — see the project doc). It deliberately returns
// null rather than guessing when nothing confidently matches, same
// policy as every other "don't fabricate data" heuristic in this file —
// a missed/garbled schedule just means no reminder fires for that cycle,
// not a wrong one. Flag for retuning once real page text can be checked.
const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DRAWING_SCHEDULE_RE = new RegExp(
  `(?:drawing|entries?|entry window)[^.]{0,40}?(?:opens?|starts?|begins?)[^.]{0,20}?` +
  `(?:on\\s+)?((?:${MONTH_NAMES})\\.?\\s+\\d{1,2})(?:,?\\s*(\\d{4}))?` +
  `[^.]{0,20}?(?:at\\s+)?(\\d{1,2}:\\d{2}\\s*(?:am|pm)?)\\s*(ET|EST|EDT|PT|PST|PDT|CT|CST|CDT)?`,
  'i'
);
const TZ_OFFSET_HOURS = { ET: -4, EDT: -4, EST: -5, PT: -7, PDT: -7, PST: -8, CT: -5, CDT: -5, CST: -6 };

function parseUpcomingDrawingTime(bodyText, now = new Date()) {
  const m = bodyText.match(DRAWING_SCHEDULE_RE);
  if (!m) return null;
  const [, monthDay, yearStr, timeStr, tzStr] = m;
  const year = yearStr ? parseInt(yearStr, 10) : now.getUTCFullYear();
  const tz = (tzStr || 'ET').toUpperCase();
  const offsetHours = TZ_OFFSET_HOURS[tz] ?? -4; // default to Eastern — Walmart's own timezone for these

  // Build an ISO-ish string and let Date parse month-name + day + year, then
  // layer the time + fixed offset on top (Date can't parse "3:00pm ET"
  // directly, so time/timezone are handled separately from the date part).
  const dateOnly = new Date(`${monthDay} ${year} UTC`);
  if (isNaN(dateOnly.getTime())) return null;

  const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!timeMatch) return null;
  let [, hh, mm, ampm] = timeMatch;
  hh = parseInt(hh, 10);
  mm = parseInt(mm, 10);
  if (ampm) {
    const isPm = /pm/i.test(ampm);
    if (isPm && hh !== 12) hh += 12;
    if (!isPm && hh === 12) hh = 0;
  }

  const target = new Date(Date.UTC(
    dateOnly.getUTCFullYear(),
    dateOnly.getUTCMonth(),
    dateOnly.getUTCDate(),
    hh - offsetHours,
    mm
  ));
  if (isNaN(target.getTime())) return null;

  // If this parsed to a time already more than a day in the past, it's
  // almost certainly last cycle's drawing still mentioned somewhere on the
  // page (e.g. a "recent drawings" section) rather than the upcoming one —
  // don't surface a stale date as if it were the next drawing.
  if (target.getTime() < now.getTime() - 24 * 3600 * 1000) return null;

  return target.toISOString();
}

// Walmart's Collectibles Drawing page is a listing page, not a single
// product page — same heuristic as the Node version, just via stripToText
// instead of cheerio.
export async function scrapeWalmartDrawing(url = 'https://www.walmart.com/shop/collectibles/draw') {
  const html = await fetchHtml(url);
  const bodyText = stripToText(html);

  const openSignal = /entries close|closes in|time remaining|enter now/i.test(bodyText);
  const closedOnly = /closed drawing/i.test(bodyText) && !openSignal;
  const nextDrawingAt = parseUpcomingDrawingTime(bodyText);

  return {
    isOpen: openSignal && !closedOnly,
    nextDrawingAt, // ISO string, or null if no confident upcoming-schedule match
    rawSnippet: bodyText.slice(0, 600),
  };
}
