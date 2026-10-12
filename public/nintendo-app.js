// nintendo-app.js — first non-TCG category page in this app (2026-10-08).
// Three jobs:
//  1. Render currently-tracked Nintendo products (same `.card`/`.artwell`/
//     `.pad` markup pokemon-app.js already uses — see styles.css).
//  2. 2026-10-10: a REAL searchable catalog, via GET /api/nintendo/search
//     (backed by nintendo.com's own public Algolia search index — see
//     worker/src/nintendo-algolia.js). This replaces "paste a URL you
//     found yourself" as the primary way to add a product — that
//     interim form was built when this project's own research tools
//     couldn't reach nintendo.com at all to verify a search mechanism
//     existed (see the project doc for the full DevTools-assisted trail
//     that found it). The paste-URL form is kept as a fallback under
//     "Advanced" for anything that doesn't turn up in search.
//  3. POST /api/admin/track-product to start tracking either a search
//     result or a pasted URL (see worker/src/index.js and db.js).

const trackedGrid = document.getElementById('nintendoGrid');
const searchForm = document.getElementById('nintSearchForm');
const searchInput = document.getElementById('nintSearchInput');
const searchBtn = document.getElementById('nintSearchBtn');
const searchMsgEl = document.getElementById('nintSearchMsg');
const searchResultsGrid = document.getElementById('nintSearchResults');

const addForm = document.getElementById('nintAddForm');
const urlInput = document.getElementById('nintAddUrl');
const nameInput = document.getElementById('nintAddName');
const addBtn = document.getElementById('nintAddBtn');
const addMsgEl = document.getElementById('nintAddMsg');

// Populated by loadProducts() — the set of retailer-listing URLs already
// being tracked, so search results can show "Tracked" instead of a
// clickable button for something already in the grid below.
let trackedUrls = new Set();

function setSearchMsg(text, kind) {
  searchMsgEl.textContent = text;
  searchMsgEl.className = 'nint-search-msg' + (kind ? ` ${kind}` : '');
}

function setAddMsg(text, kind) {
  addMsgEl.textContent = text;
  addMsgEl.className = 'nint-add-msg' + (kind ? ` ${kind}` : '');
}

function stockLabelFor(stockStatus, availability) {
  if (stockStatus === 'IN_STOCK') return 'IN STOCK';
  if (Array.isArray(availability) && availability.length) return availability[0].toUpperCase();
  if (stockStatus === 'OUT_OF_STOCK') return 'OUT OF STOCK';
  return 'STATUS UNKNOWN';
}

function renderTrackedCard(product, l) {
  const card = document.createElement('div');
  card.className = 'card';

  const art = document.createElement(l && l.url ? 'a' : 'div');
  art.className = 'artwell card-art';
  if (l && l.url) {
    art.href = l.url;
    art.target = '_blank';
    art.rel = 'noopener noreferrer';
  }
  const placeholderHtml = `<div class="mono">${product.name}<br>(official product photo — link out)</div>`;
  if (l && l.image_url) {
    const img = document.createElement('img');
    img.src = l.image_url;
    img.alt = '';
    img.loading = 'lazy';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    img.onerror = () => { art.innerHTML = placeholderHtml; };
    art.appendChild(img);
  } else {
    art.innerHTML = placeholderHtml;
  }
  if (l) {
    const chip = document.createElement('div');
    chip.className = 'chip tag-chip';
    chip.style.background = 'rgba(23,10,8,.8)';
    chip.style.color = 'var(--ink)';
    chip.innerHTML = `<span>${l.retailer}</span>`;
    art.appendChild(chip);
  }
  card.appendChild(art);

  const pad = document.createElement('div');
  pad.className = 'pad';

  const name = document.createElement('a');
  name.className = 'card-name card-name-link';
  name.textContent = product.name;
  if (l && l.url) { name.href = l.url; name.target = '_blank'; name.rel = 'noopener noreferrer'; }
  pad.appendChild(name);

  const stock = document.createElement('div');
  stock.className = 'card-stock';
  stock.textContent = !l
    ? 'No retailer link tracked yet for this product.'
    : (l.last_purchasable ? 'IN STOCK' : (!l.last_stock || l.last_stock === 'unknown' ? 'STATUS UNKNOWN' : l.last_stock === 'account_gated' ? 'ACCOUNT REQUIRED' : 'OUT OF STOCK'));
  pad.appendChild(stock);

  if (l && l.last_price != null) {
    const row = document.createElement('div');
    row.className = 'card-msrp-row';
    row.innerHTML = `<span class="num">$${Number(l.last_price).toFixed(2)}</span>`;
    pad.appendChild(row);
  }

  card.appendChild(pad);
  return card;
}

// Search-result cards use the live Algolia fields directly (price,
// stockStatus, availability, image) rather than anything from our own DB —
// these haven't been tracked/polled yet, so there's nothing in our DB to
// show for them.
function renderSearchCard(item) {
  const card = document.createElement('div');
  card.className = 'card';

  const art = document.createElement('a');
  art.className = 'artwell card-art';
  art.href = item.url;
  art.target = '_blank';
  art.rel = 'noopener noreferrer';
  const placeholderHtml = `<div class="mono">${item.title}<br>(official product photo — link out)</div>`;
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block';
    img.onerror = () => { art.innerHTML = placeholderHtml; };
    art.appendChild(img);
  } else {
    art.innerHTML = placeholderHtml;
  }
  const chip = document.createElement('div');
  chip.className = 'chip tag-chip';
  chip.style.background = 'rgba(23,10,8,.8)';
  chip.style.color = 'var(--ink)';
  chip.innerHTML = `<span>nintendo</span>`;
  art.appendChild(chip);
  card.appendChild(art);

  const pad = document.createElement('div');
  pad.className = 'pad';

  const name = document.createElement('a');
  name.className = 'card-name card-name-link';
  name.textContent = item.title;
  name.href = item.url;
  name.target = '_blank';
  name.rel = 'noopener noreferrer';
  pad.appendChild(name);

  const stock = document.createElement('div');
  stock.className = 'card-stock';
  stock.textContent = stockLabelFor(item.stockStatus, item.availability);
  pad.appendChild(stock);

  if (item.price != null) {
    const row = document.createElement('div');
    row.className = 'card-msrp-row';
    row.innerHTML = `<span class="num">$${Number(item.price).toFixed(2)}</span>`;
    pad.appendChild(row);
  }

  const trackBtn = document.createElement('button');
  trackBtn.type = 'button';
  trackBtn.className = 'nint-track-btn';
  const alreadyTracked = trackedUrls.has(item.url);
  trackBtn.textContent = alreadyTracked ? 'Tracked' : '+ Track this';
  if (alreadyTracked) {
    trackBtn.disabled = true;
    trackBtn.classList.add('is-tracked');
  }
  trackBtn.addEventListener('click', async () => {
    trackBtn.disabled = true;
    trackBtn.textContent = 'Adding…';
    try {
      const res = await fetch('/api/admin/track-product', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          game: 'nintendo',
          name: item.title,
          retailer: 'nintendo',
          url: item.url,
          poll_tier: 'fast',
          msrp: typeof item.regPrice === 'number' ? item.regPrice : null,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
      trackedUrls.add(item.url);
      trackBtn.textContent = 'Tracked';
      trackBtn.classList.add('is-tracked');
      await loadProducts();
    } catch (err) {
      trackBtn.disabled = false;
      trackBtn.textContent = '+ Track this';
      setSearchMsg(`Couldn't track "${item.title}": ${err.message}`, 'err');
    }
  });
  pad.appendChild(trackBtn);

  card.appendChild(pad);
  return card;
}

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const all = await res.json();
    const nintendo = all.filter((p) => p.game === 'nintendo');

    trackedUrls = new Set();
    for (const product of nintendo) {
      for (const l of product.listings || []) trackedUrls.add(l.url);
    }

    trackedGrid.innerHTML = '';
    if (nintendo.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nothing tracked here yet — search above to find a Nintendo Store product.';
      trackedGrid.appendChild(empty);
      return;
    }
    for (const product of nintendo) {
      const listing = (product.listings || [])[0] || null;
      trackedGrid.appendChild(renderTrackedCard(product, listing));
    }
  } catch (err) {
    console.error('[nintendo] load failed', err);
    trackedGrid.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    errBox.textContent = `Couldn't load tracked products (${err.message || 'unknown error'}).`;
    trackedGrid.appendChild(errBox);
  }
}

async function runSearch(query) {
  searchBtn.disabled = true;
  setSearchMsg('Searching…');
  searchResultsGrid.innerHTML = '';
  try {
    const res = await fetch(`/api/nintendo/search?q=${encodeURIComponent(query)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    const results = body.results || [];
    if (results.length === 0) {
      setSearchMsg(`No results for "${query}".`, 'err');
      return;
    }
    setSearchMsg(`${results.length} result${results.length === 1 ? '' : 's'} for "${query}" — tap Track on anything you want alerts for.`, 'ok');
    for (const item of results) searchResultsGrid.appendChild(renderSearchCard(item));
  } catch (err) {
    setSearchMsg(`Search failed: ${err.message}`, 'err');
  } finally {
    searchBtn.disabled = false;
  }
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  runSearch(q);
});

addForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  const name = nameInput.value.trim();
  if (!url || !name) return;
  if (!/^https:\/\/www\.nintendo\.com\//i.test(url)) {
    setAddMsg('That doesn\'t look like a nintendo.com product URL — paste the full product page link.', 'err');
    return;
  }

  addBtn.disabled = true;
  setAddMsg('Adding…');
  try {
    const res = await fetch('/api/admin/track-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'nintendo', name, retailer: 'nintendo', url, poll_tier: 'fast' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    setAddMsg('Added — it\'ll be checked on the next poll cycle (within ~15s).', 'ok');
    urlInput.value = '';
    nameInput.value = '';
    await loadProducts();
  } catch (err) {
    setAddMsg(`Couldn't add that product: ${err.message}`, 'err');
  } finally {
    addBtn.disabled = false;
  }
});

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (err) { console.error('[nintendo] sw register failed', err); }
  }
  await loadProducts();
  setInterval(loadProducts, 30000);
})();
