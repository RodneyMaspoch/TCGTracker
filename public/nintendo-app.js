// nintendo-app.js — 2026-10-08, user request. First non-TCG category page
// in this app. Two jobs:
//  1. Render currently-tracked Nintendo products (same `.card`/`.artwell`/
//     `.pad` markup pokemon-app.js already uses, so this gets the same
//     look without new CSS — see styles.css).
//  2. Let the user ADD a new product to track by pasting its Nintendo
//     Store URL, via the new POST /api/admin/track-product endpoint (see
//     worker/src/index.js and db.js). This is the honest interim for "pick
//     from a list of Nintendo's products" — a true searchable catalog
//     browser needs to know Nintendo's real search URL/page structure,
//     and every attempt to load nintendo.com from this project's own
//     research tools failed (see the project doc) — turned out to be an
//     environment-wide block on retail sites generally, not something
//     specific to Nintendo, but it still means this was never verified
//     against the real page. Pasting a URL you found yourself sidesteps
//     that entirely: it reuses scrapeGeneric(), the same scraper already
//     used for every other retailer here, which fails safe (never
//     invents a price/stock status) if a page can't be read.

const grid = document.getElementById('nintendoGrid');
const form = document.getElementById('nintAddForm');
const urlInput = document.getElementById('nintAddUrl');
const nameInput = document.getElementById('nintAddName');
const addBtn = document.getElementById('nintAddBtn');
const msgEl = document.getElementById('nintAddMsg');

function setMsg(text, kind) {
  msgEl.textContent = text;
  msgEl.className = 'nint-add-msg' + (kind ? ` ${kind}` : '');
}

function renderCard(product, l) {
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

async function loadProducts() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`API returned ${res.status}`);
    const all = await res.json();
    const nintendo = all.filter((p) => p.game === 'nintendo');
    grid.innerHTML = '';
    if (nintendo.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'Nothing tracked here yet — add a Nintendo Store product above to get started.';
      grid.appendChild(empty);
      return;
    }
    for (const product of nintendo) {
      const listing = (product.listings || [])[0] || null;
      grid.appendChild(renderCard(product, listing));
    }
  } catch (err) {
    console.error('[nintendo] load failed', err);
    grid.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    errBox.textContent = `Couldn't load tracked products (${err.message || 'unknown error'}).`;
    grid.appendChild(errBox);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  const name = nameInput.value.trim();
  if (!url || !name) return;
  if (!/^https:\/\/www\.nintendo\.com\//i.test(url)) {
    setMsg('That doesn\'t look like a nintendo.com product URL — paste the full product page link.', 'err');
    return;
  }

  addBtn.disabled = true;
  setMsg('Adding…');
  try {
    const res = await fetch('/api/admin/track-product', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game: 'nintendo', name, retailer: 'nintendo', url, poll_tier: 'fast' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || body.error || `HTTP ${res.status}`);
    setMsg('Added — it\'ll be checked on the next poll cycle (within ~15s).', 'ok');
    urlInput.value = '';
    nameInput.value = '';
    await loadProducts();
  } catch (err) {
    setMsg(`Couldn't add that product: ${err.message}`, 'err');
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
