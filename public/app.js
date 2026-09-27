// app.js — fetches data from the API, renders the grid, handles tab
// switching, and wires up push subscription. No frameworks, kept small
// on purpose since this whole app is one screen with three filtered views.

const REFRESH_MS = 20000; // in-app refresh; independent of the server's own poll tiers

let state = {
  products: [],
  drawing: null,
  events: [],
  activeGame: 'pokemon',
};

const els = {
  grid: document.getElementById('productGrid'),
  drawingBanner: document.getElementById('drawingBanner'),
  eventsList: document.getElementById('eventsList'),
  notifyBtn: document.getElementById('notifyBtn'),
  tabs: Array.from(document.querySelectorAll('.tab-btn')),
};

// ---------- Data loading ----------
async function loadAll() {
  try {
    const [products, drawing, events] = await Promise.all([
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/walmart-drawing').then((r) => r.json()),
      fetch('/api/events?limit=30').then((r) => r.json()),
    ]);
    state.products = products;
    state.drawing = drawing;
    state.events = events;
    render();
  } catch (err) {
    console.error('[app] failed to load data', err);
  }
}

// ---------- Rendering ----------
function render() {
  document.body.setAttribute('data-game', state.activeGame);
  renderTabs();
  renderDrawingBanner();
  renderGrid();
  renderEvents();
}

function renderTabs() {
  for (const btn of els.tabs) {
    btn.classList.toggle('active', btn.dataset.game === state.activeGame);
  }
}

function renderDrawingBanner() {
  const el = els.drawingBanner;
  if (!state.drawing) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const isOpen = !!state.drawing.is_open;
  el.dataset.state = isOpen ? 'open' : 'closed';
  el.innerHTML = '';

  const text = document.createElement('span');
  if (isOpen) {
    text.innerHTML = '<strong>Walmart Collectibles Drawing is OPEN</strong> — entries are open right now.';
  } else {
    const checked = state.drawing.last_checked_at
      ? new Date(state.drawing.last_checked_at).toLocaleString()
      : 'unknown';
    text.innerHTML = `Walmart Collectibles Drawing: <strong>CLOSED</strong> — last checked ${checked}.`;
  }
  el.appendChild(text);

  const link = document.createElement('a');
  link.className = 'cta';
  link.href = 'https://www.walmart.com/shop/collectibles/draw';
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = isOpen ? 'Enter now →' : 'View page →';
  el.appendChild(link);
}

function renderGrid() {
  const grid = els.grid;
  grid.innerHTML = '';
  const items = state.products.filter((p) => p.game === state.activeGame);

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tracked products for this game yet.';
    grid.appendChild(empty);
    return;
  }

  for (const product of items) {
    grid.appendChild(renderCard(product));
  }
}

function bestGoodPriceListing(product) {
  if (!product.tcgplayer_ref) return null;
  let best = null;
  for (const l of product.listings || []) {
    if (!l.last_purchasable || l.last_price == null) continue;
    const gap = product.tcgplayer_ref - l.last_price;
    const pct = gap / product.tcgplayer_ref;
    if (gap > 0 && pct >= 0.15 && (!best || pct > best.pct)) {
      best = { listing: l, gap, pct };
    }
  }
  return best;
}

function renderCard(product) {
  const card = document.createElement('div');
  const good = bestGoodPriceListing(product);
  card.className = 'card' + (good ? ' good-price' : '');

  const head = document.createElement('div');
  head.className = 'card-head';
  const name = document.createElement('div');
  name.className = 'card-name';
  name.textContent = product.name;
  head.appendChild(name);
  if (product.msrp) {
    const msrp = document.createElement('div');
    msrp.className = 'card-msrp';
    msrp.textContent = `MSRP $${product.msrp.toFixed(2)}`;
    head.appendChild(msrp);
  }
  card.appendChild(head);

  if (product.tcgplayer_ref) {
    const ref = document.createElement('div');
    ref.className = 'ref-price';
    ref.textContent = `TCGPlayer ref: $${product.tcgplayer_ref.toFixed(2)}`;
    card.appendChild(ref);
  }

  if (good) {
    const badge = document.createElement('div');
    badge.className = 'good-price-badge';
    badge.textContent = `💰 ${Math.round(good.pct * 100)}% under TCGPlayer at ${good.listing.retailer}`;
    card.appendChild(badge);
  }

  const listingsWrap = document.createElement('div');
  listingsWrap.className = 'listings';

  if (!product.listings || product.listings.length === 0) {
    const none = document.createElement('div');
    none.className = 'no-listings';
    none.textContent = 'No retailer links tracked yet for this product.';
    listingsWrap.appendChild(none);
  } else {
    for (const l of product.listings) {
      listingsWrap.appendChild(renderListing(l));
    }
  }
  card.appendChild(listingsWrap);

  return card;
}

function renderListing(l) {
  const a = document.createElement('a');
  a.className = 'listing';
  a.href = l.url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  // Defensive fallback in case the anchor's default navigation is ever
  // blocked by an overlay — always force the tab open on click too.
  a.addEventListener('click', (e) => {
    if (!l.url) e.preventDefault();
  });

  const left = document.createElement('div');
  left.className = 'listing-left';
  const retailer = document.createElement('span');
  retailer.className = 'retailer-name';
  retailer.textContent = l.retailer;
  left.appendChild(retailer);

  const pill = document.createElement('span');
  pill.className = 'stock-pill';
  const ok = l.last_purchasable ? '1' : (l.last_stock ? '0' : 'unknown');
  pill.dataset.ok = ok;
  pill.textContent = l.last_purchasable ? 'In stock' : (l.last_stock === 'unknown' || !l.last_stock ? 'Unknown' : 'Out of stock');
  left.appendChild(pill);
  a.appendChild(left);

  const price = document.createElement('span');
  price.className = 'listing-price';
  price.textContent = l.last_price != null ? `$${Number(l.last_price).toFixed(2)}` : '—';
  a.appendChild(price);

  return a;
}

function renderEvents() {
  const wrap = els.eventsList;
  wrap.innerHTML = '';
  if (state.events.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No alerts yet.';
    wrap.appendChild(empty);
    return;
  }
  for (const ev of state.events) {
    const row = document.createElement('div');
    row.className = 'event';
    row.dataset.kind = ev.kind;
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = document.createElement('span');
    msg.textContent = ev.message;
    row.appendChild(time);
    row.appendChild(msg);
    wrap.appendChild(row);
  }
}

// ---------- Tab switching ----------
for (const btn of els.tabs) {
  btn.addEventListener('click', () => {
    state.activeGame = btn.dataset.game;
    render();
  });
}

// ---------- Push subscription ----------
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

function setNotifyState(stateName, label) {
  els.notifyBtn.dataset.state = stateName;
  els.notifyBtn.textContent = label;
}

async function refreshNotifyButton() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    setNotifyState('unsupported', 'Alerts unsupported');
    els.notifyBtn.disabled = true;
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      setNotifyState('on', 'Alerts on');
    } else {
      setNotifyState('off', 'Enable alerts');
    }
  } catch (_) {
    setNotifyState('off', 'Enable alerts');
  }
}

async function subscribeToPush() {
  const keyRes = await fetch('/api/push/public-key').then((r) => r.json());
  if (!keyRes.configured || !keyRes.publicKey) {
    alert('Push isn’t configured on the server yet (missing VAPID keys). See the README for the one-time `npm run generate-vapid` step.');
    return;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    setNotifyState('off', 'Enable alerts');
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
  });
  await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub),
  });
  setNotifyState('on', 'Alerts on');
}

async function unsubscribeFromPush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await fetch('/api/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    });
    await sub.unsubscribe();
  }
  setNotifyState('off', 'Enable alerts');
}

els.notifyBtn.addEventListener('click', async () => {
  if (els.notifyBtn.disabled) return;
  try {
    if (els.notifyBtn.dataset.state === 'on') {
      await unsubscribeFromPush();
    } else {
      await subscribeToPush();
    }
  } catch (err) {
    console.error('[app] push toggle failed', err);
    alert('Something went wrong enabling alerts. Check the console for details.');
  }
});

// ---------- Boot ----------
(async function init() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.error('[app] service worker registration failed', err);
    }
  }
  await refreshNotifyButton();
  await loadAll();
  setInterval(loadAll, REFRESH_MS);
})();
