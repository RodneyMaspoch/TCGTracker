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
    return {
      price,
      stock: purchasable ? 'in_stock' : (availability ? 'oos' : 'unknown'),
      purchasable,
      source: 'json-ld',
    };
  }

  const bodyText = stripToText(html);
  const price = priceFromText(bodyText);
  const { stock, purchasable } = stockFromText(bodyText);
  return { price, stock, purchasable, source: 'text-heuristic' };
}

// Walmart's Collectibles Drawing page is a listing page, not a single
// product page — same heuristic as the Node version, just via stripToText
// instead of cheerio.
export async function scrapeWalmartDrawing(url = 'https://www.walmart.com/shop/collectibles/draw') {
  const html = await fetchHtml(url);
  const bodyText = stripToText(html);

  const openSignal = /entries close|closes in|time remaining|enter now/i.test(bodyText);
  const closedOnly = /closed drawing/i.test(bodyText) && !openSignal;

  return {
    isOpen: openSignal && !closedOnly,
    rawSnippet: bodyText.slice(0, 600),
  };
}
