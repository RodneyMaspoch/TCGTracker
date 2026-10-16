// walmart-io.js — 2026-10-16. Walmart's OFFICIAL affiliate product feed
// (walmart.io), used instead of reading walmart.com pages (which block
// cloud servers). Only active once these Worker settings exist:
//   WALMART_CONSUMER_ID   (plain variable — shown in the walmart.io dashboard)
//   WALMART_KEY_VERSION   (plain variable — usually "1")
//   WALMART_PRIVATE_KEY   (SECRET — contents of WALMART_PRIVATE_KEY.pem)
// Without them, walmartConfigured() is false and poll.js keeps using the
// normal page check, exactly as before.
//
// Request signing (Walmart I/O standard): sign the string
//   consumerId + "\n" + timestampMs + "\n" + keyVersion + "\n"
// with RSA SHA-256 (PKCS#1 v1.5), base64, and send it with the headers below.

const BASE = 'https://developer.api.walmart.com/api-proxy/service/affil/product/v2';

export function walmartConfigured(env) {
  return !!(env.WALMART_CONSUMER_ID && env.WALMART_PRIVATE_KEY);
}

// walmart.com/ip/<slug>/<itemId>  →  itemId
export function extractWalmartItemId(url) {
  const m = String(url).match(/\/ip\/(?:[^/]+\/)?(\d{5,})/);
  return m ? m[1] : null;
}

let cachedKey = null;
async function importKey(pem) {
  if (cachedKey) return cachedKey;
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  cachedKey = await crypto.subtle.importKey(
    'pkcs8', der.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  return cachedKey;
}

async function signedHeaders(env) {
  const consumerId = env.WALMART_CONSUMER_ID;
  const keyVersion = env.WALMART_KEY_VERSION || '1';
  const ts = String(Date.now());
  const key = await importKey(env.WALMART_PRIVATE_KEY);
  const data = new TextEncoder().encode(`${consumerId}\n${ts}\n${keyVersion}\n`);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data));
  let bin = '';
  for (const b of sig) bin += String.fromCharCode(b);
  return {
    'WM_CONSUMER.ID': consumerId,
    'WM_CONSUMER.INTIMESTAMP': ts,
    'WM_SEC.KEY_VERSION': keyVersion,
    'WM_SEC.AUTH_SIGNATURE': btoa(bin),
    Accept: 'application/json',
  };
}

export function isSoldByWalmart(item) {
  if (item.marketplace === true) return false;
  const seller = String(item.sellerInfo || '').toLowerCase();
  return !seller || seller.startsWith('walmart');
}

// Product search (affiliate Search API) for the "search Walmart" box on the
// game pages. Only items SOLD BY WALMART are returned (user rule).
export async function walmartSearch(env, query) {
  const url = `${BASE}/search?query=${encodeURIComponent(query)}&numItems=25`;
  const res = await fetch(url, { headers: await signedHeaders(env) });
  if (!res.ok) throw new Error(`walmart.io search HTTP ${res.status}`);
  const body = await res.json();
  return (body.items || [])
    .filter(isSoldByWalmart)
    .map((it) => ({
      itemId: String(it.itemId),
      title: it.name,
      url: `https://www.walmart.com/ip/${it.itemId}`,
      image: it.largeImage || it.mediumImage || null,
      price: typeof it.salePrice === 'number' ? it.salePrice : null,
      msrp: typeof it.msrp === 'number' ? it.msrp : null,
      stock: it.stock || null,
      inStock: !!it.stock && !/not available|out of stock/i.test(it.stock) && it.availableOnline !== false,
    }));
}

// Raw item lookup — used by the /api/admin/walmart-test endpoint so we can
// SEE exactly what Walmart returns (does it include stock?) before relying on it.
export async function walmartLookupRaw(env, itemId) {
  const res = await fetch(`${BASE}/items/${itemId}`, { headers: await signedHeaders(env) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = text.slice(0, 2000); }
  return { status: res.status, body };
}

// Normalized check for poll.js. Returns null when Walmart's answer has no
// usable stock field — the caller then falls back to the page check, so this
// can never make things worse than today.
export async function checkWalmartItem(env, url) {
  const itemId = extractWalmartItemId(url);
  if (!itemId) return null;
  const { status, body } = await walmartLookupRaw(env, itemId);
  if (status !== 200 || !body || typeof body !== 'object') {
    throw new Error(`walmart.io HTTP ${status}`);
  }
  const item = Array.isArray(body.items) ? body.items[0] : body;
  if (!item) return null;
  const stock = typeof item.stock === 'string' ? item.stock.toLowerCase() : null;
  const hasSignal = stock != null || typeof item.availableOnline === 'boolean';
  if (!hasSignal) return null;
  const inStock = stock != null
    ? !/not available|out of stock/.test(stock) && (item.availableOnline !== false)
    : item.availableOnline === true;
  // 2026-10-16, user rule: ONLY "sold by Walmart" counts. A third-party
  // marketplace seller is never treated as purchasable (no badge, no alert).
  const soldByWalmart = isSoldByWalmart(item);
  const purchasable = inStock && soldByWalmart;
  const price = typeof item.salePrice === 'number' ? item.salePrice : null;
  // Walmart marketplace sellers (not Walmart itself) are flagged so they can
  // be recognised; the MSRP +20% rule in poll.js already filters reseller prices.
  return {
    price,
    stock: purchasable ? 'in_stock' : (inStock && !soldByWalmart ? 'third_party' : 'oos'),
    purchasable,
    image: item.largeImage || item.mediumImage || null,
    source: 'walmart-io',
    seller: item.sellerInfo || null,
  };
}

// 2026-10-16 — "load everything for this game" catalog for the game pages,
// so the user can just tap + instead of searching by hand. Runs a handful of
// preset searches in parallel, keeps only items SOLD BY WALMART whose name is
// really this game, de-duplicates, and caches the result for 30 minutes.
const CATALOG_QUERIES = {
  pokemon: ['pokemon trading card game elite trainer box', 'pokemon tcg booster bundle', 'pokemon tcg booster box',
    'pokemon tcg collection box', 'pokemon tcg premium collection', 'pokemon tcg tin', 'pokemon tcg blister pack'],
  mtg: ['magic the gathering booster box', 'magic the gathering collector booster', 'magic the gathering commander deck',
    'magic the gathering bundle', 'magic the gathering starter kit'],
  lorcana: ['disney lorcana booster box', 'disney lorcana illumineers trove', 'disney lorcana starter deck',
    'disney lorcana gift set', 'disney lorcana booster pack'],
};
const CATALOG_NAME_RE = { pokemon: /pok[eé]mon/i, mtg: /magic|mtg/i, lorcana: /lorcana/i };

export async function walmartCatalog(env, game) {
  const queries = CATALOG_QUERIES[game];
  if (!queries) return [];
  const settled = await Promise.allSettled(queries.map((q) => walmartSearch(env, q)));
  const seen = new Map();
  for (const s of settled) {
    if (s.status !== 'fulfilled') continue;
    for (const it of s.value) {
      if (!CATALOG_NAME_RE[game].test(it.title || '')) continue;
      if (!seen.has(it.itemId)) seen.set(it.itemId, it);
    }
  }
  // In-stock first, then by name.
  return [...seen.values()].sort((a, b) => (b.inStock - a.inStock) || String(a.title).localeCompare(String(b.title)));
}
