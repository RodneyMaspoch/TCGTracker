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
};

const els = {
  grid: document.getElementById('productGrid'),
  drawingHero: document.getElementById('drawingHero'),
  eventsList: document.getElementById('eventsList'),
  eventsUpcomingList: document.getElementById('eventsUpcomingList'),
  alertServicesList: document.getElementById('alertServicesList'),
  gameChip: document.getElementById('gameChip'),
  tabs: Array.from(document.querySelectorAll('.tab-btn')),
};

const GAME_LABELS = { pokemon: 'POKÉMON', mtg: 'MTG', lorcana: 'LORCANA' };

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
  if (els.gameChip) els.gameChip.innerHTML = `<span>${GAME_LABELS[state.activeGame] || state.activeGame}</span>`;
  renderTabs();
  renderDrawingHero();
  renderGrid();
  renderEvents();
  renderUpcomingEvents();
  renderAlertServices();
}

// One-time-ish static content — game-filtered like everything else, so
// switching tabs shows each game's own events. Rebuilding this on every
// render() is cheap (a handful of DOM nodes), so it just piggybacks on
// the same render cycle as the live data instead of needing its own path.
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
  if (state.activeGame !== 'pokemon' || !state.drawing) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const isOpen = !!state.drawing.is_open;
  el.dataset.state = isOpen ? 'open' : 'closed';
  const checked = state.drawing.last_checked_at
    ? new Date(state.drawing.last_checked_at).toLocaleString()
    : 'not yet checked';

  el.innerHTML = `
    <div class="hero-band-bg"></div>
    <div class="hero-band-inner">
      <div>
        <div class="hero-badge"><span class="dotpulse"></span><span>${isOpen ? 'DRAWING OPEN RIGHT NOW' : 'NO DRAWING OPEN RIGHT NOW'}</span></div>
        <div class="hero-headline">Skip the refresh.<br><span class="hl">${isOpen ? 'Enter' : 'Wait for'}</span> the drawing${isOpen ? ' instead' : ''}.</div>
        <p class="hero-sub">Walmart sells its hottest Pokémon sealed product through a free-to-enter drawing, not a first-come race: sign in, pick an eligible item, submit before the window closes, and Walmart auto-charges and ships if you're randomly selected. No advantage to fast fingers. ${isOpen ? '<strong>A window is open right now.</strong>' : '<strong>Nothing is open to enter right now</strong> — this updates the moment a window opens.'}</p>
        <div class="hero-cta-row">
          <a class="btn hero-cta-secondary" href="https://www.walmart.com/shop/collectibles/draw" target="_blank" rel="noopener noreferrer">OPEN THE DRAWING PAGE →</a>
        </div>
      </div>
      <div class="hero-panel">
        <div class="artwell cut-sm">
          <div class="mono">${WALMART_DRAWING_REF.itemName}<br>(official product photo — link out)</div>
        </div>
        <div class="hero-panel-body">
          <div class="hero-panel-title">${WALMART_DRAWING_REF.itemName} (last drawing price)</div>
          <div class="hero-panel-prices">
            <div><div class="label mono">Drawing price</div><div class="num" style="color:#fff">$${WALMART_DRAWING_REF.drawingPrice.toFixed(2)}</div></div>
            <div><div class="label mono">General MSRP</div><div class="num" style="color:var(--dim)">$${WALMART_DRAWING_REF.msrp.toFixed(2)}</div></div>
          </div>
          <div class="hero-panel-status">${isOpen ? 'OPEN · ENTRIES BEING ACCEPTED NOW' : 'CLOSED · ENTRIES NO LONGER ACCEPTED FOR THIS WINDOW'}</div>
          <div class="hero-panel-footnote">Last confirmed window (re-verified directly against the drawing page): ${WALMART_DRAWING_REF.lastWindow} ${WALMART_DRAWING_REF.rumor}<br><br>This app's own last check: ${checked}. It polls roughly every 90s and pushes an alert the moment the state above flips to OPEN.</div>
        </div>
      </div>
    </div>
  `;
}

// Card layout below is deliberately built to match index.html's/
// lorcana.html's own "Tracking Now" deal cards one-for-one: a 5/6 photo
// well with a retailer chip overlay, the name as a link, a stock line, a
// big price with MSRP struck through, and an "ALERT ≤ $ / ADD ALERT" row.
// The one structural difference: those pages treat "same product, two
// retailers" as two separate cards (see server/seed.js's hobbit-target /
// hobbit-walmart pair), so this flattens each PRODUCT's listings into one
// card per LISTING too, instead of nesting all of a product's retailers
// inside a single card the way the earlier version of this page did —
// that nested-list style was the biggest visible difference from the
// sibling pages, more than the missing photo/big-price treatment was.
//
// Like index.html's/lorcana.html's own "ADD ALERT" control, this is a
// client-side-only toggle (see armedState/targetState below) — it isn't
// wired to a per-listing threshold on the server. That matches those
// pages' actual current behavior exactly, not a step behind it: the
// server-side alert that actually fires (Trigger 2b, MSRP-anchored) is a
// fixed rule in poll.js, not driven by this input on any of the three
// pages yet.
const armedState = {};   // key: `${product.id}:${retailer}` -> boolean
const targetState = {};  // key: `${product.id}:${retailer}` -> string (input value)

// Mirrors the server-side Trigger 2b logic in server/poller.js — MSRP
// leads the comparison, TCGPlayer just confirms there's real resale
// demand. See the comment above pollOneListing() there for the full
// reasoning (TCGPlayer is almost always above MSRP for hyped sealed
// product, so comparing straight to TCGPlayer flags marked-up listings
// as "good deals" just because they're cheaper than an inflated ceiling).
const MIN_MARKUP_OVER_MSRP = 0.25;        // TCGPlayer must be >= 25% over MSRP
const MAX_RETAIL_PREMIUM_OVER_MSRP = 0.10; // retail price must be <= 10% over MSRP

function isGoodPriceListing(product, l) {
  if (!product.tcgplayer_ref || !product.msrp || !l.last_purchasable || l.last_price == null) return false;
  const markupOverMsrp = (product.tcgplayer_ref - product.msrp) / product.msrp;
  if (markupOverMsrp < MIN_MARKUP_OVER_MSRP) return false;
  const retailPremiumOverMsrp = (l.last_price - product.msrp) / product.msrp;
  return retailPremiumOverMsrp <= MAX_RETAIL_PREMIUM_OVER_MSRP;
}

function renderGrid() {
  const grid = els.grid;
  grid.innerHTML = '';
  const products = state.products.filter((p) => p.game === state.activeGame);

  // Flatten to one card per listing (see comment above); a product with
  // no tracked listings yet still gets one card, same as the original
  // per-product view, so nothing tracked disappears from the grid.
  const cards = [];
  for (const product of products) {
    if (!product.listings || product.listings.length === 0) {
      cards.push({ product, listing: null });
    } else {
      for (const l of product.listings) cards.push({ product, listing: l });
    }
  }

  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No tracked products for this game yet.';
    grid.appendChild(empty);
    return;
  }

  for (const { product, listing } of cards) {
    grid.appendChild(renderCard(product, listing));
  }
}

function renderCard(product, l) {
  const key = `${product.id}:${l ? l.retailer : 'none'}`;
  const good = l ? isGoodPriceListing(product, l) : false;

  const card = document.createElement('div');
  card.className = 'card' + (good ? ' good-price' : '');

  const art = document.createElement(l && l.url ? 'a' : 'div');
  art.className = 'artwell card-art';
  if (l && l.url) {
    art.href = l.url;
    art.target = '_blank';
    art.rel = 'noopener noreferrer';
  }
  const placeholderHtml = `<div class="mono">${product.name}<br>(official product photo — link out)</div>`;
  // Real photo, pulled live off the retailer's own listing page by the
  // poller (see worker/src/scrapers.js) — not uploaded/maintained by hand,
  // since these products and their listings change too often for that to
  // stay accurate. Built as a real <img> (not a template-literal string)
  // so its error handler is a real function, not a fragile string that
  // would break on a product name containing a quote. Falls back to the
  // honest text placeholder when a listing has no scraped image yet
  // (brand-new product, or a retailer page with neither a schema.org
  // Product block nor an og:image tag), or if the image URL 404s later.
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
  if (good) {
    const tag = document.createElement('div');
    tag.className = 'chip';
    tag.style.position = 'absolute';
    tag.style.top = '10px';
    tag.style.right = '10px';
    tag.style.background = 'var(--accent)';
    tag.style.color = 'var(--accent-ink)';
    tag.innerHTML = '<span>GOOD PRICE</span>';
    art.appendChild(tag);
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
    const msrpHtml = product.msrp ? `<span class="strike">$${product.msrp.toFixed(2)}</span>` : '';
    row.innerHTML = `<span class="num">$${Number(l.last_price).toFixed(2)}</span>${msrpHtml}`;
    pad.appendChild(row);
  } else if (product.msrp) {
    const row = document.createElement('div');
    row.className = 'card-msrp-row';
    row.innerHTML = `<span class="mono" style="font-size:13px;color:var(--dim)">MSRP $${product.msrp.toFixed(2)}</span>`;
    pad.appendChild(row);
  }

  if (product.tcgplayer_ref) {
    const ref = document.createElement('div');
    ref.className = 'ref-price';
    ref.textContent = `TCGPlayer ref: $${product.tcgplayer_ref.toFixed(2)}`;
    pad.appendChild(ref);
  }

  const alertRow = document.createElement('div');
  alertRow.className = 'alert-row';

  const alertInput = document.createElement('div');
  alertInput.className = 'alert-input';
  const defaultTarget = targetState[key] ?? (product.msrp != null ? product.msrp.toFixed(2) : '');
  alertInput.innerHTML = `<span>ALERT ≤</span><span style="color:#fff">$</span>`;
  const input = document.createElement('input');
  input.inputMode = 'decimal';
  input.value = defaultTarget;
  input.addEventListener('change', () => { targetState[key] = input.value; });
  alertInput.appendChild(input);
  alertRow.appendChild(alertInput);

  const btn = document.createElement('div');
  btn.className = 'alert-btn';
  const armed = !!armedState[key];
  btn.dataset.armed = armed ? '1' : '0';
  btn.textContent = armed ? '✓ ALERT ARMED' : '+ ADD ALERT';
  btn.addEventListener('click', () => {
    const nowArmed = !armedState[key];
    armedState[key] = nowArmed;
    // Arming an alert is the thing that should turn push notifications
    // on — not a separate "Enable alerts" button a person has to go
    // find. window.tcgEnsurePushEnabled (push-client.js) no-ops if
    // already subscribed, and the browser's own permission prompt still
    // has to appear on a real click like this one — that part can't be
    // skipped, but requiring a SECOND click elsewhere on the page can.
    if (nowArmed && window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
    render();
  });
  alertRow.appendChild(btn);

  pad.appendChild(alertRow);
  card.appendChild(pad);

  return card;
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
    // ev.url (the actual retailer page the poller checked) is now sent
    // by the API for restock/good_price events — render a real <a> when
    // it's there instead of a plain <div>, per the explicit ask that
    // these be clickable.
    const row = document.createElement(ev.url ? 'a' : 'div');
    row.className = 'event';
    row.dataset.kind = ev.kind;
    if (ev.url) {
      row.href = ev.url;
      row.target = '_blank';
      row.rel = 'noopener noreferrer';
    }
    // The kind used to be communicated only by a border color (removed —
    // see styles.css) — now it's an actual readable label, same badge
    // language as the rest of the site.
    const kind = document.createElement('span');
    kind.className = 'event-kind';
    kind.textContent = EVENT_KIND_LABELS[ev.kind] || ev.kind;
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msg = document.createElement('span');
    msg.className = 'event-msg';
    msg.textContent = ev.message;
    row.appendChild(kind);
    row.appendChild(msg);
    row.appendChild(time);
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
