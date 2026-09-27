// scrapers.js — best-effort HTML scraping for retailer product pages.
//
// IMPORTANT — read this before you deploy:
// Retailer pages change their markup often, and I (Claude) built this
// without being able to load the live page in a real browser from the
// deploy environment to verify selectors against *your* current session.
// So this file is written to be resilient rather than exact:
//   1. It looks first for schema.org JSON-LD (<script type="application/
//      ld+json"> containing "@type":"Product") — most big retailers embed
//      this for SEO, and it's far more stable than CSS class names.
//   2. If that's missing, it falls back to regex/text heuristics.
// If a retailer stops matching, check what index.js logs for that fetch
// (it logs a snippet of the raw HTML on parse failure) and adjust the
// relevant function below — the parsing logic is intentionally kept in
// one small file for exactly that reason.
//
// This also respects the same boundary as the Claude-based version: it
// only ever reads pages. Nothing here adds to cart, logs in, or submits
// any form.

const fetch = require('node-fetch');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    timeout: 15000,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function extractJsonLdProduct($) {
  let found = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const parsed = JSON.parse($(el).contents().text());
      const candidates = Array.isArray(parsed) ? parsed : [parsed];
      for (const c of candidates) {
        const graph = c['@graph'] ? c['@graph'] : [c];
        for (const g of graph) {
          if (g['@type'] === 'Product' && g.offers) {
            found = g;
            return;
          }
        }
      }
    } catch (_) { /* not valid JSON-LD, skip */ }
  });
  return found;
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

// Generic parser used by Best Buy / Target / GameStop / Pokemon Center —
// tries JSON-LD first, falls back to whole-page text heuristics.
async function scrapeGeneric(url) {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const product = extractJsonLdProduct($);

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

  // Fallback: scan visible body text.
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const price = priceFromText(bodyText);
  const { stock, purchasable } = stockFromText(bodyText);
  return { price, stock, purchasable, source: 'text-heuristic' };
}

// Walmart's Collectibles Drawing page is a listing page, not a single
// product page — it lists currently-open drawings (or says none are
// open) plus a list of recently-closed ones. We just need: is anything
// open right now, and if so what items + when does entry close.
async function scrapeWalmartDrawing(url = 'https://www.walmart.com/shop/collectibles/draw') {
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);
  const bodyText = $('body').text().replace(/\s+/g, ' ');

  // Heuristic: the page says something like "closes in" / "ends" with a
  // countdown for an open drawing, versus "Closed Drawings" / "ended" for
  // finished ones. Look for an active countdown/time-remaining pattern.
  const openSignal = /entries close|closes in|time remaining|enter now/i.test(bodyText);
  const closedOnly = /closed drawing/i.test(bodyText) && !openSignal;

  return {
    isOpen: openSignal && !closedOnly,
    rawSnippet: bodyText.slice(0, 600), // logged for debugging if this drifts
  };
}

module.exports = { scrapeGeneric, scrapeWalmartDrawing, fetchHtml };
