// app.js — fetches data from the API, renders the grid, handles tab
// switching, and wires up push subscription. No frameworks, kept small
// on purpose since this whole app is one screen with three filtered views.

const REFRESH_MS = 20000; // in-app refresh; independent of the server's own poll tiers

// Static reference content carried over from the three Claude-hosted
// dashboards (see the project doc's "events & championships" and "restock
// alert services" tables — same one-time research, ~2026-09-27). This
// content doesn't change on its own the way live prices do, so it's
// hand-written here rather than pulled from the API. It'll drift out of
// date over time — update these two objects the same way you'd update
// anything else in this file, no server changes needed.
const EVENTS_BY_GAME = {
  pokemon: [
    { name: 'ME7: Aura Seeker (Japan)', when: 'Nov 27, 2026', where: 'Japan' },
    { name: 'ME7a: MEGA x MEGA Parade (Japan)', when: 'Feb 19, 2027', where: 'Japan' },
    { name: 'Pokémon World Championships', when: 'Aug 13–17, 2027', where: 'Singapore EXPO' },
    { name: 'North America International Championships', when: '2027 (TBA)', where: 'Chicago, IL' },
  ],
  mtg: [
    { name: 'Secret Lair Commander: Odds and Ends — launch', when: 'Sep 28, 2026, 9am PT', where: 'MagicSecretLair.com only' },
    { name: 'Reality Fracture Prerelease', when: 'Sep 25 – Oct 1, 2026', where: 'Local game stores (WPN)' },
    { name: 'Star Trek Prerelease', when: 'Nov 6–12, 2026', where: 'Local game stores (WPN)' },
    { name: 'MagicCon: Atlanta', when: 'Nov 13–15, 2026', where: 'Atlanta, GA' },
    { name: 'MagicCon: Detroit', when: 'Feb 26–28, 2027', where: 'Detroit, MI' },
    { name: 'MagicCon: Tokyo', when: 'May 14–16, 2027', where: 'Tokyo, Japan' },
  ],
  lorcana: [
    { name: 'Hyperia City Prerelease', when: 'Oct 16, 2026', where: 'Local game stores' },
    { name: 'Disney Lorcana Challenge — Bangkok', when: 'Oct 30 – Nov 1, 2026', where: 'Bangkok, Thailand' },
    { name: 'Disney Lorcana Challenge — London', when: 'Nov 13–15, 2026', where: 'London, UK' },
    { name: 'Disney Lorcana World Championship', when: 'Dec 4–6, 2026', where: 'Aulani, Hawaii' },
    { name: 'Disney Lorcana Challenge — Tampa', when: 'Dec 18–20, 2026', where: 'Tampa, FL' },
    { name: 'Disney Lorcana Challenge — Milwaukee', when: 'Feb 19–21, 2027', where: 'Milwaukee, WI' },
  ],
};

// Same idea as EVENTS_BY_GAME/ALERT_SERVICES above — this is the specific
// last-known-good research snapshot from the project doc (drawing price,
// exact confirmed window, item list, and the still-unconfirmed "next
// window" rumor), not something the scraper can produce on its own: it
// can tell you open/closed, but it can't research and write up a summary
// like this. Update this by hand when you have a fresher confirmed
// window — same as tcgplayer_ref, it's a snapshot, not a live feed.
const WALMART_DRAWING_REF = {
  itemName: '30th Celebration Elite Trainer Box',
  drawingPrice: 69.97,
  msrp: 49.99,
  lastWindow: 'Wed Sep 23, 2:00pm PT / 5:00pm ET — 6 items incl. this ETB, a Knock Out Collection 4-pack, Mystery Power Box: Vault Edition.',
  rumor: 'A Prismatic Evolutions double-drawing was rumored "in ~5 days" as of a Sep-26 social post — not independently confirmed, treat as tentative, not live.',
};

// Upcoming Pokémon releases (dated, from the project watchlist research).
// Past dates hide themselves automatically. A release whose product is
// tracked (productId) shows that product's photo and TRACK button.
const UPCOMING_RELEASES = [
  { name: "Deck Crafter's Collection", date: '2026-10-23', note: '$9.99 · Best Buy' },
  { name: 'Delta Reign — Elite Trainer Box', date: '2026-11-06', note: '$49.99', productId: 'pkm-delta-reign-etb' },
];

const EVENT_KIND_LABELS = { restock: 'Restock', good_price: 'Good Price', drawing_open: 'Drawing Open' };

const ALERT_SERVICES = [
  { name: 'Restockd', kind: 'App + Discord + X', price: 'Free tier', note: 'Mobile app (iOS/Android) — Pokémon cards, Pokémon Center queue activity, Walmart lottery/drawing windows, Target, GameStop, Dollar General', url: 'https://restockd.app/brands/pokemon' },
  { name: 'PokeNotify', kind: 'App + Discord', price: 'Free tier / $7.99/mo', note: 'Pokémon/MTG/Lorcana/One Piece/Yu-Gi-Oh across Walmart, Target, Costco, Best Buy, Pokémon Center, GameStop, Amazon', url: 'https://www.pokenotify.com/' },
  { name: 'PokeRestock', kind: 'App + Discord', price: 'Freemium', note: 'Pokémon-focused restock alerts', url: 'https://discord.com/invite/pkmnalerts' },
  { name: 'TCG Drop Radar', kind: 'Web + rankings', price: 'Free', note: 'Ranks the restock Discords, dedicated Walmart Pokémon page', url: 'https://tcgdropradar.com/' },
  { name: 'TrackaLacker — Walmart Draw Guide', kind: 'Web guide', price: 'Free', note: 'Clearest writeup of the drawing mechanics', url: 'https://www.trackalacker.com/articles/news/walmart-draw-system-guide' },
  { name: 'autoqueue.app', kind: 'Web', price: 'Freemium', note: 'Walmart Pokémon queue/drawing explainer', url: 'https://autoqueue.app/blog/how-walmart-pokemon-restock-queue-works' },
];

let state = {
  products: [],
  drawing: null,
  events: [],
  activeGame: 'pokemon',
  categoryFilter: 'all',
};

const els = {
  grid: document.getElementById('productGrid'),
  drawingHero: document.getElementById('drawingHero'),
  eventsList: document.getElementById('eventsList'),
  eventsUpcomingList: document.getElementById('eventsUpcomingList'),
  alertServicesList: document.getElementById('alertServicesList'),
  gameChip: document.getElementById('gameChip'),
  tabs: Array.from(document.querySelectorAll('.tab-btn')),
  hotSection: document.getElementById('hotSection'),
  hotGrid: document.getElementById('hotGrid'),
  categoryFilters: document.getElementById('categoryFilters'),
  marketTicker: document.getElementById('marketTicker'),
};

// "Shop by category" (2026-10-02, user request — see the comment in
// pokemon.html for why this is a filter bar, not icon art). Categories
// are derived from each product's own real name, never invented: this is
// just pattern-matching on text that's already true about the product,
// same spirit as the "no fake/static data" rule (2026-09-28) applied to
// a grouping instead of a number. Order matters — first match wins, most
// specific patterns first (e.g. "Elite Trainer Box" before the bare
// "Box" that would otherwise also match a Booster Box).
const CATEGORY_RULES = [
  [/elite\s*trainer\s*box|\betb\b/i, 'Elite Trainer Box'],
  [/premium\s*collection/i, 'Premium Collection'],
  [/build\s*(&|and)\s*battle/i, 'Build & Battle'],
  [/collection\s*box|\bcollection\b/i, 'Collection Box'],
  [/booster\s*bundle/i, 'Booster Bundle'],
  [/booster\s*box/i, 'Booster Box'],
  [/booster\s*pack|3[\s-]?pack|blister/i, 'Booster Pack'],
  [/\btin\b/i, 'Tin'],
  [/mini\s*portfolio|binder/i, 'Binder'],
];
function categorize(name) {
  for (const [re, label] of CATEGORY_RULES) {
    if (re.test(name)) return label;
  }
  return 'Other';
}

function renderCategoryFilters() {
  const wrap = els.categoryFilters;
  if (!wrap) return;
  const products = state.products.filter((p) => p.game === state.activeGame);
  const cats = Array.from(new Set(products.map((p) => categorize(p.name)))).sort();
  if (cats.length <= 1) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = '';
  const allBtn = document.createElement('div');
  allBtn.className = 'cat-filter' + (state.categoryFilter === 'all' ? ' active' : '');
  allBtn.textContent = 'ALL';
  allBtn.addEventListener('click', () => { state.categoryFilter = 'all'; render(); });
  wrap.appendChild(allBtn);
  for (const cat of cats) {
    const btn = document.createElement('div');
    btn.className = 'cat-filter' + (state.categoryFilter === cat ? ' active' : '');
    btn.textContent = cat.toUpperCase();
    btn.addEventListener('click', () => { state.categoryFilter = cat; render(); });
    wrap.appendChild(btn);
  }
}

const GAME_LABELS = { pokemon: 'POKÉMON', mtg: 'MTG', lorcana: 'LORCANA' };

// ---------- Data loading ----------
async function loadAll() {
  try {
    const [products, drawing, events] = await Promise.all([
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/walmart-drawing').then((r) => r.json()),
      fetch('/api/events?limit=100').then((r) => r.json()),
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
  if (els.gameChip) els.gameChip.innerHTML = `<span>${GAME_LABELS[state.activeGame] || state.activeGame}</span>`;
  renderTabs();
  renderDrawingHero();
  renderTicker();
  renderHot();
  renderCategoryFilters();
  renderGrid();
  renderEvents();
  renderComingUp();
  renderUpcomingEvents();
  renderAlertServices();
}

// Decorative market ticker (2026-10-02 request — see the comment on
// .mkt-ticker-wrap in styles.css). Built fresh each render from the exact
// same real signals renderHot() uses (good-price listings, restocks in
// the last 24h) plus the Walmart Drawing actually being open right now —
// hides itself entirely when none of that currently applies, rather than
// showing an empty or invented bar.
function renderTicker() {
  const wrap = els.marketTicker;
  if (!wrap) return;
  const track = wrap.querySelector('.mkt-ticker-track');

  const items = [];
  if (state.drawing && state.drawing.is_open) {
    items.push({ glyph: '🎟️', label: 'WALMART COLLECTIBLES DRAWING OPEN RIGHT NOW — ENTER →', url: 'https://www.walmart.com/shop/collectibles/draw' });
  }
  const recentRestockProductIds = new Set(
    state.events
      .filter((ev) => ev.kind === 'restock' && Date.now() - new Date(ev.created_at).getTime() <= HOT_RESTOCK_WINDOW_MS)
      .map((ev) => ev.product_id)
      .filter(Boolean)
  );
  for (const product of state.products.filter((p) => p.game === 'pokemon')) {
    for (const l of product.listings || []) {
      if (isGoodPriceListing(product, l)) {
        items.push({ glyph: '💰', label: `${product.name.toUpperCase()} — GOOD PRICE AT ${(l.retailer || '').toUpperCase()}`, url: l.url });
      } else if (l.last_purchasable && recentRestockProductIds.has(product.id)) {
        items.push({ glyph: '🟢', label: `${product.name.toUpperCase()} RESTOCKED — ${(l.retailer || '').toUpperCase()}`, url: l.url });
      }
    }
  }

  if (items.length === 0) {
    wrap.hidden = true;
    track.innerHTML = '';
    return;
  }
  wrap.hidden = false;
  track.innerHTML = '';
  for (let lap = 0; lap < 2; lap++) {
    const lapEl = document.createElement('div');
    lapEl.className = 'mkt-ticker-lap';
    for (const item of items) {
      const a = document.createElement('a');
      a.className = 'mkt-ticker-item';
      if (item.url) { a.href = item.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      a.innerHTML = `<span>${item.glyph}</span><span>${item.label}</span>`;
      lapEl.appendChild(a);
    }
    track.appendChild(lapEl);
  }
}

// "What's hot" / signal-check strip (2026-10-02, user request for section
// parity with index.html's/lorcana.html's own "What's Hot" section): real
// derived signal, not a separate data source — a card qualifies if it's
// already flagged isGoodPriceListing() below, or if a real restock event
// for that product fired in the last 24h (state.events, same feed
// "Recent alerts" renders from). Capped at 8 cards so it reads as a
// highlights strip, not a second copy of the full grid.
const HOT_RESTOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
function renderHot() {
  const section = els.hotSection;
  const grid = els.hotGrid;
  if (!section || !grid) return;
  const live = state.products
    .filter((p) => p.game === state.activeGame)
    .filter((p) => (p.listings || []).some((l) => l.last_purchasable));
  section.hidden = live.length === 0;
  grid.innerHTML = '';
  for (const product of live.slice(0, 8)) grid.appendChild(renderCard(product));
}

// One-time-ish static content — game-filtered like everything else, so
// switching tabs shows each game's own events. Rebuilding this on every
// render() is cheap (a handful of DOM nodes), so it just piggybacks on
// the same render cycle as the live data instead of needing its own path.
// "Coming up": one strip mixing upcoming releases, the next Walmart
// drawing, and events/championships, soonest first. Image when we have
// one, otherwise a big date block. No paragraphs — date + name + one line.
function parseWhen(str) {
  const m = String(str).match(/([A-Z][a-z]{2})[a-z]*\.? (\d{1,2})(?:[–-]\d{1,2})?,? (\d{4})/);
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
  return isNaN(d) ? null : d;
}
function renderComingUp() {
  const wrap = document.getElementById('tlComing');
  if (!wrap) return;
  wrap.innerHTML = '';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const items = [];
  if (state.drawing) {
    const next = state.drawing.next_drawing_at ? new Date(state.drawing.next_drawing_at) : null;
    items.push({
      kind: 'LOTTERY', name: 'Walmart Collectibles Drawing',
      date: state.drawing.is_open ? new Date() : next,
      line: state.drawing.is_open ? 'OPEN NOW — enter' : (next ? 'Entries open' : 'Next date not announced'),
      url: 'https://www.walmart.com/shop/collectibles/draw', productId: 'pkm-30th-etb', hot: !!state.drawing.is_open,
    });
  }
  for (const r of UPCOMING_RELEASES) {
    const d = new Date(r.date + 'T12:00:00');
    if (d >= today) items.push({ kind: 'RELEASE', name: r.name, date: d, line: r.note, productId: r.productId });
  }
  for (const ev of EVENTS_BY_GAME[state.activeGame] || []) {
    const d = parseWhen(ev.when);
    if (!d || d >= today) items.push({ kind: 'EVENT', name: ev.name, date: d, line: ev.where, whenText: d ? null : ev.when });
  }
  items.sort((a, b) => (a.hot ? -1 : 0) - (b.hot ? -1 : 0) || (a.date ? a.date.getTime() : 9e15) - (b.date ? b.date.getTime() : 9e15));

  for (const it of items) {
    const tile = document.createElement(it.url ? 'a' : 'div');
    tile.className = 'tl-tile tl-cu' + (it.hot ? ' hot' : '');
    if (it.url) { tile.href = it.url; tile.target = '_blank'; tile.rel = 'noopener noreferrer'; }
    const product = it.productId && state.products.find((p) => p.id === it.productId);
    let photo;
    if (product) {
      photo = buildPhoto(product, 'tl-photo');
      if (it.kind === 'RELEASE') photo.appendChild(buildTrackPill(product));
    } else {
      photo = document.createElement('div');
      photo.className = 'tl-photo tl-datebox';
      if (it.date) {
        photo.innerHTML = `<span class="tl-dmon">${it.date.toLocaleString('en-US', { month: 'short' })}</span><span class="tl-dday">${it.date.getDate()}</span>`;
      } else {
        photo.innerHTML = `<span class="tl-dmon">${it.whenText || 'TBA'}</span>`;
      }
    }
    const tag = document.createElement('span');
    tag.className = 'tl-badge kind-' + it.kind.toLowerCase();
    tag.textContent = it.kind;
    photo.appendChild(tag);
    tile.appendChild(photo);
    const name = document.createElement('div');
    name.className = 'tl-name';
    name.textContent = it.name;
    tile.appendChild(name);
    const line = document.createElement('div');
    line.className = 'tl-price tl-cu-line';
    const when = it.date && !it.hot ? it.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' : '';
    line.textContent = when + it.line;
    tile.appendChild(line);
    wrap.appendChild(tile);
  }
}

function renderUpcomingEvents() {
  const wrap = els.eventsUpcomingList;
  if (!wrap) return;
  wrap.innerHTML = '';
  const items = EVENTS_BY_GAME[state.activeGame] || [];
  for (const ev of items) {
    const row = document.createElement('div');
    row.className = 'info-row';
    row.innerHTML = `<div class="info-row-main"><strong>${ev.name}</strong><span class="info-row-sub">${ev.where}</span></div><div class="info-row-when">${ev.when}</div>`;
    wrap.appendChild(row);
  }
}

function renderAlertServices() {
  const wrap = els.alertServicesList;
  if (!wrap) return;
  if (wrap.dataset.rendered) return; // game-agnostic list, only needs building once
  wrap.innerHTML = '';
  for (const svc of ALERT_SERVICES) {
    const a = document.createElement('a');
    a.className = 'info-row info-row-link';
    a.href = svc.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.innerHTML = `<div class="info-row-main"><strong>${svc.name}</strong><span class="info-row-sub">${svc.note}</span></div><div class="info-row-when">${svc.kind} · ${svc.price}</div>`;
    wrap.appendChild(a);
  }
  wrap.dataset.rendered = '1';
}

function renderTabs() {
  for (const btn of els.tabs) {
    btn.classList.toggle('active', btn.dataset.game === state.activeGame);
  }
}

// Pokémon's "big live moment" — same role as MTG's Reality Fracture
// countdown or Lorcana's Hyperia City hero: a full-bleed hero band using
// the SAME .hero-band/.hero-headline/.hero-panel classes those pages use
// (see styles.css), built around the Walmart Collectibles Drawing status
// instead of a set-release countdown, since that's this game's real
// time-sensitive event. Only shown on the Pokémon tab.
function renderDrawingHero() {
  const el = els.drawingHero;
  if (!el) return;
  if (!state.drawing) { el.hidden = true; return; }
  el.hidden = false;
  const isOpen = !!state.drawing.is_open;
  el.innerHTML = `<a class="tl-drawing${isOpen ? ' open' : ''}" href="https://www.walmart.com/shop/collectibles/draw" target="_blank" rel="noopener noreferrer">
    <span class="tl-drawing-dot"></span>${isOpen ? 'Walmart drawing is OPEN — enter now →' : 'Walmart drawing: closed · we\'ll alert you when it opens'}</a>`;
}

// 2026-10-15 — simplified, trackalacker-style: ONE card per product (not
// one per store), with a real photo and a short list of stores underneath,
// each showing a colored status dot, price and a direct link. The old
// per-card checkout checklist, separate mute button and "ALERT ≤ $"
// input (which was never wired to the server) were removed; alerts are
// controlled by the single bell on the photo, which maps to the real
// server-side per-product mute.
const MIN_MARKUP_OVER_MSRP = 0.25;        // TCGPlayer must be >= 25% over MSRP
const MAX_RETAIL_PREMIUM_OVER_MSRP = 0.10; // retail price must be <= 10% over MSRP

function isGoodPriceListing(product, l) {
  if (!product.tcgplayer_ref || !product.msrp || !l.last_purchasable || l.last_price == null) return false;
  const markupOverMsrp = (product.tcgplayer_ref - product.msrp) / product.msrp;
  if (markupOverMsrp < MIN_MARKUP_OVER_MSRP) return false;
  const retailPremiumOverMsrp = (l.last_price - product.msrp) / product.msrp;
  return retailPremiumOverMsrp <= MAX_RETAIL_PREMIUM_OVER_MSRP;
}

// Photos: the live photo scraped off a store page always wins. Because
// most big stores block the scraper, each tracked product also has one
// verified box-art photo as a backup (real product images, found
// 2026-10-15 on retailer listings — not mockups). A product with neither
// shows a clean placeholder instead of a broken image.
const PRODUCT_IMAGES = {
  'pkm-30th-etb': 'https://thehobbybin.com/cdn/shop/files/30th-Celebration-Elite-Trainer-Box.png?v=1782833098&width=800',
  'pkm-30th-etb-pokemoncenter': 'https://thehobbybin.com/cdn/shop/files/30th-Celebration-Pokemon-Center-Elite-Trainer-Box.png?v=1782833098&width=800',
  'pkm-30th-upc-day': 'https://cdn.shopify.com/s/files/1/0713/8007/4695/files/704190.jpg?v=1785248463',
  'pkm-delta-reign-etb': 'https://cdn.shopify.com/s/files/1/0727/7553/2770/files/712102.jpg?v=1787705571',
  'pkm-prismatic-etb': 'https://cdn.shopify.com/s/files/1/0689/9397/4463/files/593355.jpg?v=1748918714',
};
function productImageCandidates(product, listings) {
  const out = [];
  for (const l of listings || []) if (l.image_url) out.push(l.image_url);
  if (PRODUCT_IMAGES[product.id]) out.push(PRODUCT_IMAGES[product.id]);
  return [...new Set(out)];
}

const RETAILER_NAMES = {
  target: 'Target', walmart: 'Walmart', walmart_marketplace: 'Walmart (3rd party)', bestbuy: 'Best Buy',
  gamestop: 'GameStop', pokemoncenter: 'Pokémon Center', samsclub: "Sam's Club", costco: 'Costco', amazon: 'Amazon',
};
const retailerName = (slug) => RETAILER_NAMES[slug] || slug;

function storeState(l) {
  if (l.last_purchasable) return ['in', 'In stock'];
  if (l.last_stock === 'account_gated') return ['gated', 'Account req.'];
  if (l.last_stock && l.last_stock !== 'unknown') return ['out', 'Sold out'];
  return ['unknown', 'Checking'];
}

function timeAgo(iso) {
  if (!iso) return 'not checked yet';
  const sec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.round(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.round(sec / 3600)} hr ago`;
  return `${Math.round(sec / 86400)} days ago`;
}

// ---- TrackaLacker-style browse rows (2026-10-15 v2) ----
// One row per category: a label on the left, a horizontal strip of small
// square product tiles on the right. Each tile = photo, a TRACK pill
// (the real per-product alert switch: tracked = alerts on, i.e. not
// muted), name, price. Tapping a tile opens a sheet listing every store.
function lowestPrice(product) {
  const live = (product.listings || []).filter((l) => l.last_purchasable && l.last_price != null);
  if (live.length) return Math.min(...live.map((l) => Number(l.last_price)));
  return null;
}

async function setTracked(product, tracked) {
  const res = await fetch('/api/admin/set-muted', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ product_id: product.id, muted: !tracked }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  product.muted = tracked ? 0 : 1;
  if (tracked && window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
}

function buildTrackPill(product) {
  const btn = document.createElement('button');
  btn.type = 'button';
  const paint = () => {
    const tracked = !product.muted;
    btn.className = 'tl-track' + (tracked ? ' on' : '');
    btn.textContent = tracked ? '✓ TRACKING' : '+ TRACK';
  };
  paint();
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    btn.disabled = true;
    try { await setTracked(product, !!product.muted); paint(); render(); }
    catch (err) { console.error('[pokemon] track toggle failed', err); }
    finally { btn.disabled = false; }
  });
  return btn;
}

function buildPhoto(product, cls) {
  const wrap = document.createElement('div');
  wrap.className = cls;
  const candidates = productImageCandidates(product, product.listings);
  const fallback = () => {
    wrap.querySelector('img')?.remove();
    const ph = document.createElement('div');
    ph.className = 'tl-ph';
    ph.innerHTML = '<img src="/icons/pokemon.png" alt="">';
    wrap.prepend(ph);
  };
  if (!candidates.length) { fallback(); return wrap; }
  let i = 0;
  const img = document.createElement('img');
  img.alt = product.name;
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  img.src = candidates[0];
  img.onerror = () => { i += 1; if (i < candidates.length) img.src = candidates[i]; else fallback(); };
  wrap.appendChild(img);
  return wrap;
}

function renderCard(product) {
  const listings = product.listings || [];
  const live = listings.some((l) => l.last_purchasable);
  const good = listings.some((l) => isGoodPriceListing(product, l));

  const tile = document.createElement('div');
  tile.className = 'tl-tile';
  tile.tabIndex = 0;
  tile.addEventListener('click', () => openSheet(product));
  tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSheet(product); });

  const photo = buildPhoto(product, 'tl-photo');
  if (live || good) {
    const badge = document.createElement('span');
    badge.className = 'tl-badge' + (good ? ' good' : '');
    badge.textContent = good ? '$ Good price' : '● In stock';
    photo.appendChild(badge);
  }
  photo.appendChild(buildTrackPill(product));
  tile.appendChild(photo);

  const name = document.createElement('div');
  name.className = 'tl-name';
  name.textContent = product.name;
  tile.appendChild(name);

  const price = document.createElement('div');
  price.className = 'tl-price';
  const low = lowestPrice(product);
  price.textContent = low != null ? `$${low.toFixed(2)}` : (product.msrp ? `$${Number(product.msrp).toFixed(2)}` : '—');
  tile.appendChild(price);
  return tile;
}

function renderGrid() {
  const root = document.getElementById('tlRows');
  if (!root) return;
  root.innerHTML = '';
  const products = state.products.filter((p) => p.game === state.activeGame);
  if (!products.length) { root.innerHTML = '<div class="empty-state">No tracked products yet.</div>'; return; }
  const groups = new Map();
  for (const p of products) {
    const c = categorize(p.name);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c).push(p);
  }
  for (const [cat, list] of groups) {
    list.sort((a, b) => ((b.listings || []).some((l) => l.last_purchasable) - (a.listings || []).some((l) => l.last_purchasable)) || a.name.localeCompare(b.name));
    const row = document.createElement('div');
    row.className = 'tl-row';
    const label = document.createElement('div');
    label.className = 'tl-row-label';
    label.innerHTML = `<span class="tl-row-kicker">Pokémon</span><span class="tl-row-name"></span><span class="tl-row-count">${list.length} tracked</span>`;
    label.querySelector('.tl-row-name').textContent = cat;
    row.appendChild(label);
    const strip = document.createElement('div');
    strip.className = 'tl-strip';
    for (const p of list) strip.appendChild(renderCard(p));
    row.appendChild(strip);
    root.appendChild(row);
  }
}

// Product sheet: every store for one product, with status + direct link.
function openSheet(product) {
  const sheet = document.getElementById('tlSheet');
  if (!sheet) return;
  const listings = [...(product.listings || [])].sort((a, b) => (b.last_purchasable || 0) - (a.last_purchasable || 0));
  sheet.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'tl-panel';
  const close = document.createElement('button');
  close.className = 'tl-close'; close.type = 'button'; close.textContent = '✕';
  close.addEventListener('click', () => { sheet.hidden = true; });
  panel.appendChild(close);
  const top = document.createElement('div');
  top.className = 'tl-panel-top';
  top.appendChild(buildPhoto(product, 'tl-panel-photo'));
  const info = document.createElement('div');
  const meta = [];
  if (product.msrp) meta.push(`MSRP $${Number(product.msrp).toFixed(2)}`);
  if (product.tcgplayer_ref) meta.push(`TCGplayer $${Number(product.tcgplayer_ref).toFixed(2)}`);
  info.innerHTML = `<div class="tl-panel-name"></div><div class="tl-panel-meta">${meta.join(' · ')}</div>`;
  info.querySelector('.tl-panel-name').textContent = product.name;
  info.appendChild(buildTrackPill(product));
  top.appendChild(info);
  panel.appendChild(top);

  const head = document.createElement('div');
  head.className = 'tl-where';
  head.textContent = 'Where to buy';
  panel.appendChild(head);
  if (!listings.length) {
    const none = document.createElement('div');
    none.className = 'tl-store'; none.textContent = 'No store tracked yet.';
    panel.appendChild(none);
  }
  for (const l of listings) {
    const [key, label] = storeState(l);
    const a = document.createElement('a');
    a.className = 'tl-store'; a.dataset.s = key;
    a.href = l.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    const price = l.last_price != null && key !== 'unknown' ? `$${Number(l.last_price).toFixed(2)}` : '';
    a.innerHTML = `<span class="tl-store-name"></span><span class="tl-store-status">${label}</span><span class="tl-store-price">${price}</span><span class="tl-store-go">VIEW →</span><span class="tl-store-time">Checked ${timeAgo(l.last_checked_at)}</span>`;
    a.querySelector('.tl-store-name').textContent = retailerName(l.retailer);
    panel.appendChild(a);
  }
  sheet.appendChild(panel);
  sheet.hidden = false;
  sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const s = document.getElementById('tlSheet'); if (s) s.hidden = true; } });

// 2026-10-15 — grouped: one row per product + store (latest time shown,
// with "×N" when it fired more than once), capped at 12 rows. The full,
// ungrouped history lives on the Notifications page.
function renderEvents() {
  const wrap = els.eventsList;
  wrap.innerHTML = '';
  const groups = new Map();
  for (const ev of state.events) {
    const key = `${ev.kind}|${ev.product_id || ''}|${ev.url || ev.message}`;
    const g = groups.get(key);
    if (g) g.count += 1; else groups.set(key, { ev, count: 1 });
  }
  if (groups.size === 0) { wrap.innerHTML = '<div class="empty-state">No restocks yet — they’ll show up here.</div>'; return; }
  for (const { ev, count } of [...groups.values()].slice(0, 10)) {
    const product = state.products.find((p) => p.id === ev.product_id) || { id: ev.product_id, name: '', listings: [] };
    const card = document.createElement('div');
    card.className = 'tl-deal';
    card.appendChild(buildPhoto(product, 'tl-deal-photo'));
    const name = document.createElement('div');
    name.className = 'tl-deal-name';
    name.textContent = product.name || ev.message;
    card.appendChild(name);
    const m = ev.message.match(/at (.+?)(?: — \$([\d.]+))?$/);
    const price = document.createElement('div');
    price.className = 'tl-deal-price';
    price.textContent = m && m[2] ? `$${Number(m[2]).toFixed(2)}` : '';
    card.appendChild(price);
    const btn = document.createElement(ev.url ? 'a' : 'div');
    btn.className = 'tl-deal-btn';
    if (ev.url) { btn.href = ev.url; btn.target = '_blank'; btn.rel = 'noopener noreferrer'; }
    btn.textContent = `VIEW AT ${(m ? m[1] : 'STORE').toUpperCase()}`;
    card.appendChild(btn);
    const t = document.createElement('div');
    t.className = 'tl-deal-time';
    t.textContent = `${EVENT_KIND_LABELS[ev.kind] || ev.kind} · ${timeAgo(ev.created_at)}${count > 1 ? ` · ×${count}` : ''}`;
    card.appendChild(t);
    wrap.appendChild(card);
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
// Handled by push-client.js, shared with index.html and lorcana.html —
// see that file. Previously this page had its own copy of this logic;
// consolidated to one place so a future fix only needs to happen once.

// ---------- Boot ----------
(async function init() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (err) {
      console.error('[app] service worker registration failed', err);
    }
  }
  await loadAll();
  setInterval(loadAll, REFRESH_MS);
})();
