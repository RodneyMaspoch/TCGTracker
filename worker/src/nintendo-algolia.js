// nintendo-algolia.js — 2026-10-10, user request. Nintendo's own store
// search (nintendo.com/us/search) is powered by Algolia, not a custom
// Nintendo-built endpoint. Confirmed together with the user by inspecting
// the real site's own Network tab: the actual browser-sent request, its
// x-algolia-application-id/x-algolia-api-key headers, and a captured real
// response are all in the project doc's dated entry for this round. This
// is the same public, search-only credential nintendo.com ships to every
// visitor's browser to power the on-page search box — not a reverse-
// engineered internal endpoint like Target's Redsky, and not behind an
// anti-bot wall (PerimeterX, Incapsula) this project has otherwise
// declined to defeat. Same policy bucket as Best Buy's official developer
// API: a sanctioned, public-facing way in, not one this project had to
// fight past.
//
// IMPORTANT — three indexes were visible in the real captured traffic, and
// only one of them is actual product data:
//  - store_all_products_en_us  -> REAL products: price, stockStatus,
//    availability, productImage, sku, url. This is the only one this file
//    queries.
//  - store_explore_en_us -> despite the name, and despite being the one
//    called with the larger hitsPerPage (40) in the real traffic, this
//    index is Nintendo's NEWS/ARTICLE content hub (every hit has
//    `"recordType": "explore"` — blog posts, "Ask the Developer" pieces,
//    Splatfest announcements, etc.), not products. A first pass at this
//    file nearly used this index before a real sample response ruled it
//    out — left as a comment here specifically so no one re-makes that
//    mistake later.
//  - crawler_support_en_us -> support-article search. Also not products.
//
// env.NINTENDO_ALGOLIA_APP_ID / env.NINTENDO_ALGOLIA_API_KEY live as plain
// [vars] in wrangler.toml, not wrangler secrets — these are the literal
// values nintendo.com already sends to every browser on every page load,
// so there is nothing actually secret about them. They're read from env
// rather than hardcoded here only so a future key rotation is a one-line
// config change, not a code change.

const PRODUCT_INDEX = 'store_all_products_en_us';

async function algoliaQuery(env, requests) {
  if (!env.NINTENDO_ALGOLIA_APP_ID || !env.NINTENDO_ALGOLIA_API_KEY) {
    throw new Error('Nintendo Algolia credentials not configured (NINTENDO_ALGOLIA_APP_ID / NINTENDO_ALGOLIA_API_KEY)');
  }
  const host = `${env.NINTENDO_ALGOLIA_APP_ID.toLowerCase()}-dsn.algolia.net`;
  const url = `https://${host}/1/indexes/*/queries`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Algolia-Api-Key': env.NINTENDO_ALGOLIA_API_KEY,
        'X-Algolia-Application-Id': env.NINTENDO_ALGOLIA_APP_ID,
      },
      body: JSON.stringify({ requests }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Algolia HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// productImage comes back as a Cloudinary-style asset path (e.g.
// "ncom/My Nintendo Store/EN-US/.../121642-...-2000x2000"), not a full
// URL. assets.nintendo.com was the image host seen elsewhere in the same
// captured traffic (a support-article thumbnail used that exact host),
// so this builds a URL on that pattern — but it has NOT been independently
// verified to actually render a real product photo, since this sandbox
// can't reach nintendo.com or its asset CDN to confirm (see project doc).
// If this turns out wrong, the frontend's existing "no photo yet"
// placeholder already covers a broken/404'ing image URL — it never shows
// a fabricated image either way.
export function buildNintendoImageUrl(productImage) {
  if (!productImage) return null;
  return `https://assets.nintendo.com/image/upload/f_auto,q_auto/${productImage}`;
}

// Nintendo product URLs always end in "-<digits>/", where the digits are
// the product's own sku (== its Algolia objectID) — confirmed against two
// different real products' URL+sku pairs during this investigation. That
// means the sku can be recovered from the `url` already stored in
// retailer_listings, with no new column/migration needed.
export function extractNintendoSku(url) {
  const m = String(url || '').match(/-(\d+)\/?(?:[?#].*)?$/);
  return m ? m[1] : null;
}

function mapHit(hit) {
  if (!hit) return null;
  const price = hit.price || {};
  return {
    sku: hit.sku || hit.objectID || null,
    title: hit.title || null,
    url: hit.url ? `https://www.nintendo.com${hit.url}` : null,
    image: buildNintendoImageUrl(hit.productImage),
    price: typeof price.finalPrice === 'number' ? price.finalPrice : null,
    regPrice: typeof price.regPrice === 'number' ? price.regPrice : null,
    discounted: !!price.discounted,
    stockStatus: hit.stockStatus || null, // e.g. "IN_STOCK" / "OUT_OF_STOCK"
    availability: Array.isArray(hit.availability) ? hit.availability : [], // e.g. ["Coming soon"]
    platform: hit.platform || null,
    releaseDate: hit.releaseDate || null,
    category: hit.topLevelCategory || null,
  };
}

// Powers the catalog search box on the Nintendo page — GET
// /api/nintendo/search?q=... in index.js calls this directly.
export async function searchNintendoCatalog(env, query, hitsPerPage = 24) {
  const body = await algoliaQuery(env, [
    { indexName: PRODUCT_INDEX, query: query || '', params: `hitsPerPage=${hitsPerPage}` },
  ]);
  const hits = body?.results?.[0]?.hits || [];
  return hits.map(mapHit).filter(Boolean);
}

// Used by poll.js INSTEAD OF scrapeGeneric() for retailer === 'nintendo'.
// Looks the tracked product up by its own sku/objectID directly through
// the same public search endpoint, rather than fetching+regexing the
// rendered HTML page — real structured fields instead of a text
// heuristic, while still only ever reading, never defeating any
// protection (same boundary as every other scraper in this project).
export async function checkNintendoProduct(env, listingUrl) {
  const sku = extractNintendoSku(listingUrl);
  if (!sku) throw new Error(`could not extract a Nintendo sku from ${listingUrl}`);

  const body = await algoliaQuery(env, [
    { indexName: PRODUCT_INDEX, query: '', params: `filters=${encodeURIComponent(`objectID:${sku}`)}&hitsPerPage=1` },
  ]);
  const hit = body?.results?.[0]?.hits?.[0] || null;
  if (!hit) throw new Error(`no Algolia hit for Nintendo sku ${sku} — product may have been delisted, or the index/schema changed`);

  const mapped = mapHit(hit);
  const purchasable = mapped.stockStatus === 'IN_STOCK';
  return {
    price: mapped.price,
    stock: purchasable ? 'in_stock' : (mapped.stockStatus ? 'oos' : 'unknown'),
    purchasable,
    image: mapped.image,
    source: 'nintendo-algolia',
  };
}
