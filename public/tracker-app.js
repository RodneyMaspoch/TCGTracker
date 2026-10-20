// tracker-app.js — 2026-10-15. ONE shared script for the MTG (index.html),
// Lorcana (lorcana.html) and Pokémon (pokemon.html) pages, so all three
// look and behave the same (TrackaLacker-style: image-first tiles, a
// TRACK pill per product, minimal copy). The page's <body data-game="...">
// picks the game. Replaces pokemon-app.js and the old runtime.js/pwa-boot.js
// template pages for MTG/Lorcana.
//
// Sections, top to bottom:
//   1. Hero — the single most important thing right now, picked live:
//      Walmart drawing open > something in stock now > good price > the
//      next dated drop (with a live countdown).
//   2. Coming up — upcoming releases, Walmart drawings, events. Soonest first.
//   3. Browse — one row per product type, square photo tiles, TRACK pill.
//      Tap a tile → "Where to buy" sheet with every store.
//   4. Recent restocks — deal cards, repeats grouped (×N).
// Data: /api/products, /api/walmart-drawing, /api/events (real, live).
// The dated lists below (releases/events) are hand-kept from the project
// watchlist research; past dates hide themselves automatically.

(function () {
  'use strict';

  const GAME = document.body.dataset.game || 'pokemon';
  const REFRESH_MS = 60000; // 2026-10-20 — was 20s; database budget

  // ---------------- per-game content ----------------
  const GAMES = {
    pokemon: {
      label: 'Pokémon',
      icon: '/icons/pokemon.png',
      drawing: true,
      heroArt: 'https://thehobbybin.com/cdn/shop/files/30th-Celebration-Elite-Trainer-Box.png?v=1782833098&width=800',
      images: {
        'pkm-30th-etb': 'https://thehobbybin.com/cdn/shop/files/30th-Celebration-Elite-Trainer-Box.png?v=1782833098&width=800',
        'pkm-30th-etb-pokemoncenter': 'https://thehobbybin.com/cdn/shop/files/30th-Celebration-Pokemon-Center-Elite-Trainer-Box.png?v=1782833098&width=800',
        'pkm-30th-upc-day': 'https://cdn.shopify.com/s/files/1/0713/8007/4695/files/704190.jpg?v=1785248463',
        'pkm-delta-reign-etb': 'https://cdn.shopify.com/s/files/1/0727/7553/2770/files/712102.jpg?v=1787705571',
        'pkm-prismatic-etb': 'https://cdn.shopify.com/s/files/1/0689/9397/4463/files/593355.jpg?v=1748918714',
      },
      upcoming: [
        { kind: 'RELEASE', name: "Deck Crafter's Collection", date: '2026-10-23', line: '$9.99', productId: 'pkm-deck-crafter' },
        { kind: 'RELEASE', name: 'Delta Reign — Elite Trainer Box', date: '2026-11-06', line: '$49.99', productId: 'pkm-delta-reign-etb' },
        { kind: 'RELEASE', name: 'ME7: Aura Seeker (Japan)', date: '2026-11-27', line: 'Japan' },
        { kind: 'RELEASE', name: 'ME7a: MEGA x MEGA Parade (Japan)', date: '2027-02-19', line: 'Japan' },
        { kind: 'EVENT', name: 'Pokémon World Championships', date: '2027-08-13', line: 'Singapore' },
      ],
    },
    mtg: {
      label: 'Magic',
      icon: '/icons/mtg.png',
      drawing: false,
      heroArt: 'https://images.ctfassets.net/s5n2t79q9icq/5jKECux0YypT0gdUVQ2yMG/26797d4ef011e98218ba0e5af45776ff/FRA-1029_IREHSAFULXE_548x432_EN.png',
      images: {
        'reality-fracture-sld-target': 'https://images.ctfassets.net/s5n2t79q9icq/5jKECux0YypT0gdUVQ2yMG/26797d4ef011e98218ba0e5af45776ff/FRA-1029_IREHSAFULXE_548x432_EN.png',
        'reality-fracture-sld-walmart': 'https://images.ctfassets.net/s5n2t79q9icq/5jKECux0YypT0gdUVQ2yMG/26797d4ef011e98218ba0e5af45776ff/FRA-1029_IREHSAFULXE_548x432_EN.png',
        'motu-secretlair': '/img/category-secretlair.jpg',
        'doom-prevails': '/img/category-precons.jpg',
      },
      upcoming: [
        { kind: 'RELEASE', name: 'Reality Fracture — Secret Lair Bundle', date: '2026-10-23', line: '$89.99 · Target / Walmart', productId: 'reality-fracture-sld-target' },
        { kind: 'EVENT', name: 'SCG CON: Hartford', date: '2026-10-23', line: 'Hartford, CT · Sealed + Commander' },
        { kind: 'EVENT', name: "Magic Presents: All Leylines' Eve", date: '2026-10-30', line: 'Local game stores' },
        { kind: 'EVENT', name: 'Star Trek Prerelease', date: '2026-11-06', line: 'Local game stores' },
        { kind: 'RELEASE', name: 'Star Trek', date: '2026-11-13', line: 'Collector Box $479.99', productId: 'startrek-cbb' },
        { kind: 'RELEASE', name: 'Mystery Booster: Commander Edition', date: '2026-11-13', line: 'MagicCon only' },
        { kind: 'EVENT', name: 'MagicCon: Atlanta', date: '2026-11-13', line: 'Atlanta, GA' },
        { kind: 'DROP', name: 'Secret Lair × MSCHF: The Zeta Set', date: '2026-12-09', line: '24-hr window · $19.92/pack', url: 'https://magic.wizards.com/en/news/announcements/an-update-on-the-zeta-set-sale' },
        { kind: 'RELEASE', name: 'Nauctis: The Sunken Realm', date: '2027-02-05', line: 'Standard set' },
        { kind: 'EVENT', name: 'MagicCon: Detroit', date: '2027-02-26', line: 'Detroit, MI' },
      ],
    },
    lorcana: {
      label: 'Lorcana',
      icon: '/icons/lorcana.png',
      drawing: false,
      heroArt: 'https://ravensburger.cloud/cms/gallery/lorcana-web/products/s14-hyperia-city/hero-and-background-new/s14_header_still_1920x1080.jpg',
      images: {
        'aotv-target': 'https://target.scene7.com/is/image/Target/GUEST_0ca8caf7-d26e-4b41-a127-6d1629cb9caa?wid=548&hei=432&fmt=pjpeg',
        'aotv-walmart': 'https://target.scene7.com/is/image/Target/GUEST_0ca8caf7-d26e-4b41-a127-6d1629cb9caa?wid=548&hei=432&fmt=pjpeg',
        'aotv-bestbuy': 'https://target.scene7.com/is/image/Target/GUEST_0ca8caf7-d26e-4b41-a127-6d1629cb9caa?wid=548&hei=432&fmt=pjpeg',
        'hyperia-box-mm': 'https://ravensburger.cloud/cms/gallery/lorcana-web/products/s14-hyperia-city/hero-and-background-new/s14_header_still_1920x1080.jpg',
        'hyperia-trove': 'https://ravensburger.cloud/cms/gallery/lorcana-web/products/s14-hyperia-city/hero-and-background-new/s14_header_still_1920x1080.jpg',
        'hunny-rescue': 'https://ravensburger.cloud/cms/gallery/lorcana-web/products/dt/en_9qtnfq4muo.png',
      },
      upcoming: [
        { kind: 'EVENT', name: 'Hyperia City Prerelease', date: '2026-10-16', line: 'Local game stores', url: 'https://www.disneylorcana.com/en-US/locator/' },
        { kind: 'RELEASE', name: 'Hyperia City', date: '2026-10-23', line: 'Booster Box $143.76', productId: 'hyperia-box-mm' },
        { kind: 'RELEASE', name: "Hyperia City — Illumineer's Trove", date: '2026-10-23', line: '$49.99', productId: 'hyperia-trove' },
        { kind: 'EVENT', name: 'Lorcana Challenge — Bangkok', date: '2026-10-30', line: 'Bangkok, Thailand' },
        { kind: 'RELEASE', name: 'Hyperia City — Beast Gift Box', date: '2026-11-13', line: '$29.99 · GameStop' },
        { kind: 'EVENT', name: 'Lorcana Challenge — London', date: '2026-11-13', line: 'London, UK' },
        { kind: 'EVENT', name: 'Lorcana World Championship', date: '2026-12-04', line: 'Aulani, Hawaii' },
        { kind: 'EVENT', name: 'Lorcana Challenge — Tampa', date: '2026-12-18', line: 'Tampa, FL' },
      ],
    },
    nintendo: {
      label: 'Nintendo',
      icon: '/icons/icon-192.png',
      drawing: false,
      heroArt: null,
      images: {},
      upcoming: [],
      search: 'nintendo',
    },
  };
  // 2026-10-16 — the three card-game pages search Walmart's official feed
  // (sold-by-Walmart items only). The game's name is added to the query so
  // "elite trainer box" on the Pokémon page finds Pokémon products.
  // 2026-10-16 — WATCH LIST (TrackaLacker/TYPA style): known products that
  // Walmart may carry, even before any store lists them. + WATCH creates the
  // product; the server checks Walmart every few minutes and alerts
  // "Now listed at Walmart" the moment Walmart itself lists it. Only real,
  // verified product names (official announcements / retailer listings
  // recorded in the project watchlist) — no guessed SKUs.
  GAMES.pokemon.watchlist = [
    { name: '30th Celebration Elite Trainer Box', msrp: 49.99, img: 'pkm-30th-etb' },
    { name: '30th Celebration Booster Bundle' },
    { name: '30th Celebration Knock Out Collection' },
    { name: '30th Celebration Ultra Premium Collection', msrp: 179.99, img: 'pkm-30th-upc-day' },
    { name: '30th Celebration Mini Tin' },
    { name: '30th Celebration Poster Collection', msrp: 19.99 },
    { name: 'Delta Reign Elite Trainer Box', msrp: 49.99, img: 'pkm-delta-reign-etb' },
    { name: 'Ascended Heroes Elite Trainer Box', msrp: 59.99 },
    { name: 'Prismatic Evolutions Elite Trainer Box', img: 'pkm-prismatic-etb' },
    { name: 'Prismatic Evolutions Super Premium Collection', msrp: 129.99 },
    { name: 'Black Kyurem ex & Melmetal ex', msrp: 49.99 },
    { name: "Deck Crafter's Collection", msrp: 9.99 },
  ];
  GAMES.mtg.watchlist = [
    { name: 'Reality Fracture Collector Booster Box', msrp: 323.88 },
    { name: 'Reality Fracture Play Booster Box', msrp: 164.70 },
    { name: 'Reality Fracture Secret Lair Bundle', msrp: 89.99, img: 'reality-fracture-sld-target' },
    { name: 'Star Trek Collector Booster Box', msrp: 479.99 },
    { name: 'The Hobbit Play Booster Box' },
  ];
  GAMES.lorcana.watchlist = [
    { name: 'Hyperia City Booster Box', msrp: 143.76, img: 'hyperia-box-mm' },
    { name: "Hyperia City Illumineer's Trove", msrp: 49.99, img: 'hyperia-trove' },
    { name: 'Hyperia City Beast Gift Box', msrp: 29.99 },
    { name: 'Hyperia City 2-Player Starter Set' },
  ];

  GAMES.pokemon.search = 'walmart'; GAMES.pokemon.searchTerm = 'pokemon';
  GAMES.mtg.search = 'walmart'; GAMES.mtg.searchTerm = 'magic the gathering';
  GAMES.lorcana.search = 'walmart'; GAMES.lorcana.searchTerm = 'disney lorcana';
  const CFG = GAMES[GAME] || GAMES.pokemon;

  const RETAILER_NAMES = {
    target: 'Target', walmart: 'Walmart', walmart_marketplace: 'Walmart (3rd party)', bestbuy: 'Best Buy',
    gamestop: 'GameStop', nintendo: 'Nintendo Store', pokemoncenter: 'Pokémon Center', samsclub: "Sam's Club", costco: 'Costco', amazon: 'Amazon',
    secretlair: 'Secret Lair', miniaturemarket: 'Miniature Market', disneylorcana: 'Disney Lorcana', ravensburger: 'Ravensburger',
  };
  const retailerName = (slug) => RETAILER_NAMES[slug] || slug;

  const CATEGORY_RULES = [
    [/secret\s*lair/i, 'Secret Lair'],
    [/commander/i, 'Commander'],
    [/elite\s*trainer\s*box|\betb\b/i, 'Elite Trainer Box'],
    [/premium\s*collection/i, 'Premium Collection'],
    [/trove/i, "Illumineer's Trove"],
    [/illumineer'?s?\s*quest/i, "Illumineer's Quest"],
    [/booster\s*(box|display)/i, 'Booster Box'],
    [/bundle/i, 'Bundle'],
    [/collection/i, 'Collection Box'],
    [/\btin\b/i, 'Tin'],
    [/gift/i, 'Gift Set'],
  ];
  const categorize = (name) => (CATEGORY_RULES.find(([re]) => re.test(name)) || [null, 'Tracked'])[1];

  // ---------------- state ----------------
  const state = { products: [], drawing: null, events: [] };

  // 2026-10-17 — one failing endpoint or one bad row must never blank the
  // whole page again: each fetch and each section is isolated, and any
  // problem is shown in a small line at the bottom so it can be fixed.
  const loadErrors = [];
  async function getJson(url, label) {
    // 10s timeout: a hanging server must not leave the page waiting forever.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      const text = await r.text();
      if (!r.ok) throw new Error(`HTTP ${r.status} ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } catch (err) {
      loadErrors.push(`${label}: ${err.name === 'AbortError' ? 'server did not answer within 10s' : err.message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  async function loadAll() {
    loadErrors.length = 0;
    const [products, drawing, events] = await Promise.all([
      getJson('/api/products', 'products'),
      CFG.drawing ? getJson('/api/walmart-drawing', 'drawing') : Promise.resolve(null),
      getJson('/api/events?limit=100', 'events'),
    ]);
    try {
      state.products = groupProducts((Array.isArray(products) ? products : []).filter((p) => p && p.game === GAME));
    } catch (err) {
      loadErrors.push(`products data: ${err.message}`);
      state.products = [];
    }
    state.drawing = drawing;
    state.events = Array.isArray(events) ? events : [];
    render();
  }
  function showLoadErrors() {
    let box = document.getElementById('tlLoadErr');
    if (!loadErrors.length) { if (box) box.remove(); return; }
    if (!box) {
      box = el('div', 'tl-search-msg');
      box.id = 'tlLoadErr';
      box.style.cssText = 'margin:24px 16px;color:#b91c1c;white-space:pre-wrap';
      document.getElementById('app').appendChild(box);
    }
    box.textContent = `Something didn't load (send a screenshot of this):\n${loadErrors.join('\n')}`;
  }

  // The same product tracked at two stores is sometimes stored as two
  // product rows (e.g. hobbit-target / hobbit-walmart). Merge rows with the
  // same base name into one tile with all their stores.
  function baseName(name) {
    return name.replace(/\s*\((3rd-party seller|preorder)\)\s*/gi, ' ').replace(/booster display/i, 'Booster Box').replace(/\s+/g, ' ').trim();
  }
  // User rule (2026-10-15): only MSRP or up to 20% over counts as "in stock".
  // A listing priced higher (usually a reseller at market price) is shown as
  // "Over MSRP" and never featured, badged or counted as a restock.
  const MAX_OVER_MSRP = 0.20;
  function annotate(p) {
    for (const l of p.listings || []) {
      l.msrp = p.msrp;
      l.over = !!(l.last_purchasable && p.msrp && l.last_price != null && l.last_price > p.msrp * (1 + MAX_OVER_MSRP) + 0.01);
      l.buyable = !!l.last_purchasable && !l.over;
    }
  }
  function groupProducts(rows) {
    const map = new Map();
    for (const p of rows) {
      annotate(p);
      const key = baseName(p.name).toLowerCase();
      const g = map.get(key);
      if (!g) {
        map.set(key, { ...p, name: baseName(p.name), ids: [p.id], listings: [...(p.listings || [])] });
      } else {
        g.ids.push(p.id);
        g.listings.push(...(p.listings || []));
        g.msrp = g.msrp || p.msrp;
        g.tcgplayer_ref = g.tcgplayer_ref || p.tcgplayer_ref;
        g.muted = g.muted && p.muted ? 1 : 0;
        g.target_price = g.target_price || p.target_price;
      }
    }
    return [...map.values()];
  }
  const findProduct = (id) => state.products.find((p) => p.ids.includes(id));

  // ---------------- helpers ----------------
  const MIN_MARKUP_OVER_MSRP = 0.25;
  const MAX_RETAIL_PREMIUM_OVER_MSRP = 0.10;
  function isGoodPriceListing(product, l) {
    if (!product.tcgplayer_ref || !product.msrp || !l.last_purchasable || l.last_price == null) return false;
    if ((product.tcgplayer_ref - product.msrp) / product.msrp < MIN_MARKUP_OVER_MSRP) return false;
    return (l.last_price - product.msrp) / product.msrp <= MAX_RETAIL_PREMIUM_OVER_MSRP;
  }
  function storeState(l) {
    if (l.buyable) return ['in', 'In stock'];
    if (l.over) return ['over', 'Over MSRP'];
    if (l.last_stock === 'third_party') return ['over', '3rd-party only'];
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
  const money = (n) => `$${Number(n).toFixed(2)}`;
  function lowestLivePrice(product) {
    const live = product.listings.filter((l) => l.buyable && l.last_price != null);
    return live.length ? Math.min(...live.map((l) => Number(l.last_price))) : null;
  }
  function imageCandidates(product) {
    const out = [];
    for (const l of product.listings || []) if (l.image_url) out.push(l.image_url);
    for (const id of product.ids || [product.id]) if (CFG.images[id]) out.push(CFG.images[id]);
    return [...new Set(out)];
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function linkify(node, url) {
    node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer';
    return node;
  }

  function buildPhoto(product, cls, extraFallback) {
    const wrap = el('div', cls);
    const candidates = product ? imageCandidates(product) : [];
    if (extraFallback) candidates.push(extraFallback);
    const fallback = () => {
      wrap.querySelector('img.tl-img')?.remove();
      const ph = el('div', 'tl-ph');
      ph.innerHTML = `<img src="${CFG.icon}" alt="">`;
      wrap.prepend(ph);
    };
    if (!candidates.length) { fallback(); return wrap; }
    let i = 0;
    const img = el('img', 'tl-img');
    img.alt = product ? product.name : '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = candidates[0];
    img.onerror = () => { i += 1; if (i < candidates.length) img.src = candidates[i]; else fallback(); };
    wrap.appendChild(img);
    return wrap;
  }

  // TRACK = the product's real server-side alert switch (tracked = not muted).
  async function setTracked(product, tracked) {
    for (const id of product.ids) {
      const res = await fetch('/api/admin/set-muted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_id: id, muted: !tracked }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    product.muted = tracked ? 0 : 1;
    if (tracked && window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
  }
  function buildTrackPill(product) {
    const btn = el('button', 'tl-track');
    btn.type = 'button';
    const paint = () => {
      const tracked = !product.muted;
      btn.className = 'tl-track' + (tracked ? ' on' : '');
      btn.textContent = tracked ? '✓ TRACKING' : '+ TRACK';
    };
    paint();
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      try { await setTracked(product, !!product.muted); render(); }
      catch (err) { console.error('[tracker] track toggle failed', err); }
      finally { btn.disabled = false; }
    });
    return btn;
  }

  // ---------------- dated items (Coming up + hero) ----------------
  function datedItems() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const items = [];
    let officialDrawDay = null;
    if (CFG.drawing && state.drawing) {
      let next = state.drawing.next_drawing_at ? new Date(state.drawing.next_drawing_at) : null;
      if (next && next.getTime() < Date.now() - 6 * 3600000) next = null; // old drawing — don't show it as upcoming
      if (next) officialDrawDay = next.toDateString();
      items.push({
        kind: 'LOTTERY', name: 'Walmart Collectibles Drawing',
        date: state.drawing.is_open ? new Date() : next,
        line: state.drawing.is_open ? 'OPEN NOW'
          : (next ? `Starts ${next.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })} · Walmart` : 'Next date not announced'),
        url: 'https://www.walmart.com/shop/collectibles/draw', productId: 'pkm-30th-etb',
        open: !!state.drawing.is_open, exact: !!next,
      });
    }
    // 2026-10-20 — upcoming Walmart drawings reported by other sources
    // (e.g. Restockd: "another drawing is likely this Wednesday (10/21)")
    // before Walmart posts it. Shown as unconfirmed; dropped once Walmart's
    // own page lists that same day.
    if (CFG.drawing) {
      const seenDays = new Set();
      for (const ev of state.events) {
        if (ev.kind !== 'tip_scheduled') continue;
        let d; try { d = JSON.parse(ev.data_json || '{}'); } catch (_) { continue; }
        if (!d.at || !/walmart/i.test(d.title || '') || !/draw|lottery|raffle/i.test(d.title || '')) continue;
        const at = new Date(d.at);
        if (isNaN(at) || at < today) continue;
        const day = at.toDateString();
        if (day === officialDrawDay || seenDays.has(day)) continue;
        seenDays.add(day);
        items.push({
          kind: 'LOTTERY', name: 'Walmart drawing (unconfirmed)', date: at, exact: true,
          line: d.dayOnly ? 'Likely · time not announced' : `Likely · ${at.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`,
          url: 'https://www.walmart.com/shop/collectibles/draw',
        });
      }
    }
    for (const r of CFG.upcoming) {
      const d = new Date(r.date + 'T12:00:00');
      if (d >= today) items.push({ ...r, date: d });
    }
    items.sort((a, b) => (b.open ? 1 : 0) - (a.open ? 1 : 0) || (a.date ? a.date.getTime() : 9e15) - (b.date ? b.date.getTime() : 9e15));
    return items;
  }

  function countdown(date) {
    const ms = date.getTime() - Date.now();
    if (ms <= 0) return 'Today';
    const d = Math.floor(ms / 86400000);
    const h = Math.floor((ms % 86400000) / 3600000);
    if (d >= 1) return `${d} day${d === 1 ? '' : 's'}${d < 3 ? ` ${h} hr` : ''}`;
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h} hr ${m} min`;
  }

  // ---------------- 1. hero ----------------
  function pickHero() {
    const items = datedItems();
    const open = items.find((i) => i.open);
    if (open) {
      return { kicker: '🟢 Open right now', title: 'Walmart drawing is open', line: 'Free to enter — winners picked at random.', cta: 'ENTER NOW', url: open.url, product: findProduct(open.productId), hot: true };
    }
    // In stock now — newest restock first.
    const restockIds = state.events.filter((e) => e.kind === 'restock').map((e) => e.product_id);
    const live = state.products.filter((p) => p.listings.some((l) => l.buyable));
    live.sort((a, b) => {
      const ai = restockIds.findIndex((id) => a.ids.includes(id));
      const bi = restockIds.findIndex((id) => b.ids.includes(id));
      return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
    });
    if (live.length) {
      const p = live[0];
      const l = [...p.listings].filter((x) => x.buyable).sort((a, b) => (a.last_price ?? 1e9) - (b.last_price ?? 1e9))[0];
      const good = isGoodPriceListing(p, l);
      return {
        kicker: good ? '💰 Good price — in stock' : '🟢 In stock now',
        title: p.name,
        line: `${retailerName(l.retailer)}${l.last_price != null ? ` · ${money(l.last_price)}` : ''}${p.msrp ? ` · MSRP ${money(p.msrp)}` : ''}`,
        cta: `BUY AT ${retailerName(l.retailer).toUpperCase()}`, url: l.url, product: p, hot: true,
      };
    }
    const next = items.find((i) => i.date);
    if (next) {
      return {
        kicker: `Next ${next.kind.toLowerCase()}`,
        title: next.name,
        line: `${next.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${next.line}`,
        countdownTo: next.date,
        cta: next.url ? 'DETAILS' : null, url: next.url,
        product: next.productId ? findProduct(next.productId) : null,
      };
    }
    return null; // nothing to feature — the hero hides itself
  }

  function renderHero() {
    const root = document.getElementById('tlHero');
    if (!root) return;
    const h = pickHero();
    root.innerHTML = '';
    root.hidden = !h;
    if (!h) return;
    root.className = 'tl-hero2' + (h.hot ? ' hot' : '');
    const text = el('div', 'tl-hero2-text');
    text.appendChild(el('div', 'tl-hero2-kicker', h.kicker));
    text.appendChild(el('h1', 'tl-hero2-title', h.title));
    text.appendChild(el('div', 'tl-hero2-line', h.line));
    if (h.countdownTo) {
      const cd = el('div', 'tl-hero2-count', countdown(h.countdownTo));
      cd.dataset.target = h.countdownTo.toISOString();
      text.appendChild(cd);
    }
    const actions = el('div', 'tl-hero2-actions');
    if (h.cta && h.url) actions.appendChild(linkify(el('a', 'tl-hero2-cta', h.cta), h.url));
    if (h.product) actions.appendChild(buildTrackPill(h.product));
    if (actions.children.length) text.appendChild(actions);
    root.appendChild(text);
    // Photo only ever shows the hero's OWN product (never generic set art —
    // that put a Reality Fracture box next to "The Hobbit"). No product
    // photo → a big date block for dated items, else the plain placeholder.
    if (h.product || !h.countdownTo) {
      root.appendChild(buildPhoto(h.product, 'tl-hero2-photo'));
    } else {
      const box = el('div', 'tl-hero2-photo tl-datebox');
      box.appendChild(el('span', 'tl-dmon', h.countdownTo.toLocaleString('en-US', { month: 'long' })));
      box.appendChild(el('span', 'tl-dday tl-dday-xl', String(h.countdownTo.getDate())));
      root.appendChild(box);
    }
  }
  setInterval(() => {
    const cd = document.querySelector('.tl-hero2-count');
    if (cd && cd.dataset.target) cd.textContent = countdown(new Date(cd.dataset.target));
  }, 30000);

  // ---------------- 2. coming up ----------------
  function renderComingUp() {
    const wrap = document.getElementById('tlComing');
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const it of datedItems()) {
      const product = it.productId ? findProduct(it.productId) : null;
      const tile = el(it.url ? 'a' : 'div', 'tl-tile tl-cu' + (it.open ? ' hot' : ''));
      if (it.url) linkify(tile, it.url);
      else if (product) tile.addEventListener('click', () => openSheet(product));
      let photo;
      if (product) {
        photo = buildPhoto(product, 'tl-photo');
        photo.appendChild(buildTrackPill(product));
      } else {
        photo = el('div', 'tl-photo tl-datebox');
        if (it.date && (it.exact !== false)) {
          photo.appendChild(el('span', 'tl-dmon', it.date.toLocaleString('en-US', { month: 'short' })));
          photo.appendChild(el('span', 'tl-dday', String(it.date.getDate())));
        } else {
          photo.appendChild(el('span', 'tl-dmon', 'TBA'));
        }
      }
      photo.appendChild(el('span', 'tl-badge kind-' + it.kind.toLowerCase(), it.kind));
      tile.appendChild(photo);
      tile.appendChild(el('div', 'tl-name', it.name));
      const when = it.date && !it.open && it.exact !== false ? it.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' : '';
      tile.appendChild(el('div', 'tl-price', when + it.line));
      wrap.appendChild(tile);
    }
    wrap.closest('section').hidden = wrap.children.length === 0;
  }

  // ---------------- 3. browse ----------------
  function renderTile(product) {
    const live = product.listings.some((l) => l.buyable);
    const good = product.listings.some((l) => isGoodPriceListing(product, l));
    const tile = el('div', 'tl-tile');
    tile.tabIndex = 0;
    tile.addEventListener('click', () => openSheet(product));
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSheet(product); });
    const photo = buildPhoto(product, 'tl-photo');
    if (live || good) photo.appendChild(el('span', 'tl-badge' + (good ? ' good' : ''), good ? '$ Good price' : '● In stock'));
    else if (!product.listings.length) photo.appendChild(el('span', 'tl-badge kind-soon', 'Not listed yet'));
    photo.appendChild(buildTrackPill(product));
    tile.appendChild(photo);
    tile.appendChild(el('div', 'tl-name', product.name));
    const low = lowestLivePrice(product);
    tile.appendChild(el('div', 'tl-price', low != null ? money(low) : (product.msrp ? money(product.msrp) : '—')));
    if (product.target_price) tile.appendChild(el('div', 'tl-target', `🎯 Alert at ${money(product.target_price)}`));
    return tile;
  }

  let filterText = '';
  function renderBrowse() {
    const root = document.getElementById('tlRows');
    if (!root) return;
    root.innerHTML = '';
    const q = filterText.trim().toLowerCase();
    const shown = q ? state.products.filter((p) => p.name.toLowerCase().includes(q)) : state.products;
    const add = document.getElementById('tlAdd');
    if (add) add.hidden = !q || shown.length > 0;
    if (!shown.length) { root.appendChild(el('div', 'empty-state', q ? `Nothing tracked matches "${filterText.trim()}".` : 'No tracked products yet.')); return; }
    const groups = new Map();
    for (const p of shown) {
      const c = categorize(p.name);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(p);
    }
    for (const [cat, list] of groups) {
      list.sort((a, b) => (b.listings.some((l) => l.buyable) - a.listings.some((l) => l.buyable)) || a.name.localeCompare(b.name));
      const row = el('div', 'tl-row');
      const label = el('div', 'tl-row-label');
      label.appendChild(el('span', 'tl-row-kicker', CFG.label));
      label.appendChild(el('span', 'tl-row-name', cat));
      label.appendChild(el('span', 'tl-row-count', `${list.length} tracked`));
      row.appendChild(label);
      const strip = el('div', 'tl-strip');
      for (const p of list) strip.appendChild(renderTile(p));
      row.appendChild(strip);
      root.appendChild(row);
    }
  }

  // Price alert: "tell me when it's at or below $X" (server: /api/admin/set-target).
  function buildPriceAlert(product) {
    const box = el('form', 'tl-alertbox');
    box.appendChild(el('div', 'tl-alertbox-label', '🎯 Price alert'));
    const row = el('div', 'tl-alertbox-row');
    const input = el('input');
    input.type = 'number'; input.step = '0.01'; input.min = '0'; input.inputMode = 'decimal';
    input.placeholder = product.msrp ? `e.g. ${Number(product.msrp).toFixed(2)}` : 'Price';
    if (product.target_price) input.value = Number(product.target_price).toFixed(2);
    const save = el('button', 'tl-btn', product.target_price ? 'Update' : 'Set alert');
    save.type = 'submit';
    row.appendChild(el('span', 'tl-alertbox-at', 'At or below $'));
    row.appendChild(input);
    row.appendChild(save);
    if (product.target_price) {
      const clear = el('button', 'tl-btn tl-btn-ghost', 'Remove');
      clear.type = 'button';
      clear.addEventListener('click', () => saveTarget(null));
      row.appendChild(clear);
    }
    box.appendChild(row);
    const msg = el('div', 'tl-alertbox-msg');
    box.appendChild(msg);
    async function saveTarget(value) {
      msg.textContent = 'Saving…';
      try {
        for (const id of product.ids) {
          const res = await fetch('/api/admin/set-target', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: id, target_price: value }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
        }
        product.target_price = value;
        if (value && product.muted) await setTracked(product, true);
        if (value && window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
        render();
        openSheet(product);
      } catch (err) {
        msg.textContent = `Couldn't save (${err.message}).`;
      }
    }
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Number(input.value);
      if (!(v > 0)) { msg.textContent = 'Enter a price.'; return; }
      saveTarget(Math.round(v * 100) / 100);
    });
    return box;
  }

  // Product sheet: every store, status + direct link.
  function openSheet(product) {
    const sheet = document.getElementById('tlSheet');
    if (!sheet) return;
    sheet.innerHTML = '';
    const panel = el('div', 'tl-panel');
    const close = el('button', 'tl-close', '✕');
    close.type = 'button';
    close.addEventListener('click', () => { sheet.hidden = true; });
    panel.appendChild(close);
    const top = el('div', 'tl-panel-top');
    top.appendChild(buildPhoto(product, 'tl-panel-photo'));
    const info = el('div');
    info.appendChild(el('div', 'tl-panel-name', product.name));
    const meta = [];
    if (product.msrp) meta.push(`MSRP ${money(product.msrp)}`);
    if (product.tcgplayer_ref) meta.push(`TCGplayer ${money(product.tcgplayer_ref)}`);
    info.appendChild(el('div', 'tl-panel-meta', meta.join(' · ')));
    info.appendChild(buildTrackPill(product));
    top.appendChild(info);
    panel.appendChild(top);
    panel.appendChild(buildPriceAlert(product));
    panel.appendChild(el('div', 'tl-where', 'Where to buy'));
    const listings = [...product.listings].sort((a, b) => (b.buyable ? 1 : 0) - (a.buyable ? 1 : 0));
    if (!listings.length) panel.appendChild(el('div', 'tl-store', "Not listed at any store yet — you'll get an alert the moment Walmart lists it."));
    for (const l of listings) {
      const [key, label] = storeState(l);
      const a = linkify(el('a', 'tl-store'), l.url);
      a.dataset.s = key;
      a.appendChild(el('span', 'tl-store-name', retailerName(l.retailer)));
      a.appendChild(el('span', 'tl-store-status', label));
      a.appendChild(el('span', 'tl-store-price', l.last_price != null && key !== 'unknown' ? money(l.last_price) : ''));
      a.appendChild(el('span', 'tl-store-time', `Checked ${timeAgo(l.last_checked_at)}`));
      a.appendChild(el('span', 'tl-store-go', 'VIEW →'));
      panel.appendChild(a);
    }
    sheet.appendChild(panel);
    sheet.hidden = false;
    sheet.onclick = (e) => { if (e.target === sheet) sheet.hidden = true; };
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { const s = document.getElementById('tlSheet'); if (s) s.hidden = true; }
  });

  // ---------------- 4. recent restocks ----------------
  const KIND_LABELS = { restock: 'Restock', good_price: 'Good price', drawing_open: 'Drawing open', price_target: 'Price alert', new_listing: 'Now listed', launch_reminder: 'Reminder', tip_reminder: 'Reminder (unconfirmed)', tip_scheduled: 'Upcoming (unconfirmed)' };
  function renderDeals() {
    const wrap = document.getElementById('tlDeals');
    if (!wrap) return;
    wrap.innerHTML = '';
    const groups = new Map();
    for (const ev of state.events) {
      const product = ev.product_id ? findProduct(ev.product_id) : null;
      if (!product) continue; // only this game's products
      const pm = ev.message.match(/\$([\d.]+)/);
      if (ev.kind === 'restock' && pm && product.msrp && Number(pm[1]) > product.msrp * (1 + MAX_OVER_MSRP) + 0.01) continue; // reseller price — not a real restock
      const key = `${ev.kind}|${ev.product_id}|${ev.url || ev.message}`;
      const g = groups.get(key);
      if (g) g.count += 1; else groups.set(key, { ev, product, count: 1 });
    }
    wrap.closest('section').hidden = groups.size === 0;
    for (const { ev, product, count } of [...groups.values()].slice(0, 10)) {
      const card = el('div', 'tl-deal');
      card.appendChild(buildPhoto(product, 'tl-deal-photo'));
      card.appendChild(el('div', 'tl-deal-name', product.name));
      const m = ev.message.match(/at (.+?)(?: — \$([\d.]+))?$/);
      card.appendChild(el('div', 'tl-deal-price', m && m[2] ? money(m[2]) : ''));
      const btn = el(ev.url ? 'a' : 'div', 'tl-deal-btn', `VIEW AT ${(m ? m[1] : 'STORE').toUpperCase()}`);
      if (ev.url) linkify(btn, ev.url);
      card.appendChild(btn);
      card.appendChild(el('div', 'tl-deal-time', `${KIND_LABELS[ev.kind] || ev.kind} · ${timeAgo(ev.created_at)}${count > 1 ? ` · ×${count}` : ''}`));
      wrap.appendChild(card);
    }
  }

  // ---------------- Nintendo store search ----------------
  function stockText(item) {
    if (CFG.search === 'walmart') return item.inStock ? ['in', 'In stock'] : ['out', item.stock || 'Sold out'];
    if (item.stockStatus === 'IN_STOCK') return ['in', 'In stock'];
    const soon = (item.availability || []).find((a) => /pre-?order|coming soon/i.test(a));
    if (soon) return ['soon', soon];
    if (item.stockStatus === 'OUT_OF_STOCK') return ['out', 'Sold out'];
    if ((item.availability || []).length) return ['soon', item.availability[0]];
    return ['unknown', ''];
  }
  function renderSearchResults(items) {
    const wrap = document.getElementById('tlSearchResults');
    wrap.innerHTML = '';
    const trackedUrls = new Set(state.products.flatMap((p) => p.listings.map((l) => l.url)));
    for (const item of items) {
      const tile = el('div', 'tl-tile');
      tile.addEventListener('click', () => { if (item.url) window.open(item.url, '_blank', 'noopener'); });
      const photo = el('div', 'tl-photo');
      if (item.image) {
        const img = el('img', 'tl-img');
        img.src = item.image; img.alt = item.title || ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        img.onerror = () => img.replaceWith(Object.assign(el('div', 'tl-ph'), { innerHTML: `<img src="${CFG.icon}" alt="">` }));
        photo.appendChild(img);
      } else {
        photo.appendChild(Object.assign(el('div', 'tl-ph'), { innerHTML: `<img src="${CFG.icon}" alt="">` }));
      }
      const [sk, st] = stockText(item);
      if (sk === 'in') photo.appendChild(el('span', 'tl-badge', '● In stock'));
      else if (sk === 'soon') photo.appendChild(el('span', 'tl-badge kind-soon', st));
      const btn = el('button', 'tl-track');
      btn.type = 'button';
      const tracked = trackedUrls.has(item.url);
      btn.textContent = tracked ? '✓ TRACKING' : '+ TRACK';
      if (tracked) { btn.classList.add('on'); btn.disabled = true; }
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true; btn.textContent = 'ADDING…';
        try {
          const res = await fetch('/api/admin/track-product', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(CFG.search === 'walmart'
              ? { game: GAME, name: item.title, retailer: 'walmart', url: item.url, poll_tier: GAME === 'pokemon' ? 'fast' : 'slow', msrp: item.msrp ?? item.price ?? null }
              : { game: 'nintendo', name: item.title, retailer: 'nintendo', url: item.url, poll_tier: 'fast', msrp: typeof item.regPrice === 'number' ? item.regPrice : null }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          btn.textContent = '✓ TRACKING'; btn.classList.add('on');
          if (window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
          await loadAll();
        } catch (err) {
          btn.disabled = false; btn.textContent = '+ TRACK';
          document.getElementById('tlSearchMsg').textContent = `Couldn't add that one (${err.message}).`;
        }
      });
      photo.appendChild(btn);
      tile.appendChild(photo);
      tile.appendChild(el('div', 'tl-name', item.title || ''));
      tile.appendChild(el('div', 'tl-price', [item.price != null ? money(item.price) : '', st && sk !== 'in' ? st : ''].filter(Boolean).join(' · ')));
      wrap.appendChild(tile);
    }
  }
  // Search tracked products as you type; when nothing matches, offer to start
  // tracking it from a store link (POST /api/admin/track-product).
  function initFilter() {
    const input = document.getElementById('tlFilter');
    if (!input) return;
    input.addEventListener('input', () => { filterText = input.value; renderBrowse(); });
    const form = document.getElementById('tlAddForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('tlAddMsg');
      const url = document.getElementById('tlAddUrl').value.trim();
      let host;
      try { host = new URL(url).hostname.replace(/^www\./, ''); } catch (_) { msg.textContent = 'Paste a full store link (https://…).'; return; }
      const retailer = host.split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
      const name = filterText.trim() || host;
      msg.textContent = 'Adding…';
      try {
        const res = await fetch('/api/admin/track-product', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ game: GAME, name, url, retailer, poll_tier: GAME === 'pokemon' || GAME === 'nintendo' ? 'fast' : 'slow' }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        msg.textContent = `Tracking "${name}". Set a price alert by tapping it.`;
        document.getElementById('tlAddUrl').value = '';
        if (window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
        await loadAll();
      } catch (err) {
        msg.textContent = `Couldn't add it (${err.message}).`;
      }
    });
  }

  // 2026-10-16 — Walmart pages auto-load EVERY sold-by-Walmart product for
  // this game (server-cached 30 min). Typing filters that list instantly;
  // pressing Search runs a live Walmart search for anything not in it.
  let catalog = [];
  async function loadCatalog() {
    if (CFG.search !== 'walmart' && CFG.search !== 'nintendo') return;
    const msg = document.getElementById('tlSearchMsg');
    if (msg) msg.textContent = CFG.search === 'nintendo' ? 'Loading the Nintendo Store…' : '';
    if (CFG.search === 'nintendo') { const sec = document.getElementById('tlCatalogSection'); if (sec) sec.hidden = false; }
    try {
      const res = await fetch(CFG.search === 'nintendo' ? '/api/nintendo/catalog' : `/api/walmart/catalog?game=${GAME}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      catalog = body.results || [];
      showCatalog();
    } catch (err) {
      console.warn('[tracker] catalog unavailable', err);
      if (CFG.search === 'nintendo' && msg) msg.textContent = `Couldn't load the Nintendo Store right now (${err.message}).`;
    }
  }
  // 2026-10-16 — Nintendo: whole store loads by itself, with filter chips
  // (In stock / Pre-order & coming soon / each store category).
  let chip = 'all';
  const isSoon = (it) => (it.availability || []).some((a) => /pre-?order|coming soon/i.test(a));
  const isIn = (it) => (CFG.search === 'walmart' ? it.inStock : it.stockStatus === 'IN_STOCK');
  function chipFilter(it) {
    if (chip === 'all') return true;
    if (chip === 'in') return isIn(it);
    if (chip === 'soon') return isSoon(it);
    return it.category === chip;
  }
  function renderChips() {
    const wrap = document.getElementById('tlChips');
    if (!wrap || CFG.search !== 'nintendo') return;
    const counts = {};
    for (const it of catalog) if (it.category) counts[it.category] = (counts[it.category] || 0) + 1;
    const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => [c, c]);
    const chips = [['all', `All ${catalog.length}`], ['in', `In stock ${catalog.filter(isIn).length}`], ['soon', `Pre-order / soon ${catalog.filter(isSoon).length}`], ...cats];
    wrap.innerHTML = '';
    for (const [key, label] of chips) {
      const b = el('button', `tl-chip${chip === key ? ' on' : ''}`, label);
      b.type = 'button';
      b.addEventListener('click', () => { chip = key; showCatalog(); });
      wrap.appendChild(b);
    }
  }
  function showCatalog() {
    const section = document.getElementById('tlCatalogSection');
    const msg = document.getElementById('tlSearchMsg');
    if (section) section.hidden = catalog.length === 0 && CFG.search !== 'nintendo';
    if (!catalog.length) { if (CFG.search === 'nintendo' && msg) msg.textContent = 'No products came back from the Nintendo Store.'; return; }
    const inStock = catalog.filter(isIn).length;
    if (msg) msg.textContent = CFG.search === 'nintendo'
      ? 'Tap + TRACK on anything to get an alert when it comes in stock.'
      : `${catalog.length} sold by Walmart · ${inStock} in stock now — tap + TRACK to get alerts`;
    renderChips();
    renderSearchResults(catalog.filter(chipFilter));
  }

  function initSearch() {
    const form = document.getElementById('tlSearchForm');
    if (!form || !CFG.search) return;
    const msg = document.getElementById('tlSearchMsg');
    if (CFG.search === 'walmart') return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = document.getElementById('tlSearchInput').value.trim();
      if (!q) return;
      msg.textContent = 'Searching…';
      try {
        const query = CFG.search === 'walmart' && CFG.searchTerm && !q.toLowerCase().includes(CFG.searchTerm.split(' ')[0])
          ? `${CFG.searchTerm} ${q}` : q;
        const res = await fetch(`/api/${CFG.search}/search?q=${encodeURIComponent(query)}`);
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        const items = Array.isArray(body) ? body : (body.results || body.hits || []);
        msg.textContent = items.length ? '' : (CFG.search === 'walmart' ? 'Nothing sold by Walmart matches that.' : 'No results.');
        renderSearchResults(items);
      } catch (err) {
        msg.textContent = `Search failed (${err.message}).`;
      }
    });
  }

  // ---------------- watch list (not-yet-listed products) ----------------
  const STOPW = new Set(['the', 'a', 'of', 'and', 'tcg', 'trading', 'card', 'game', 'pokemon', 'pokémon', 'magic', 'gathering', 'disney', 'lorcana', 'mtg', 'x']);
  const wordsOf = (str) => String(str).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9é ]+/g, ' ').split(/\s+/).filter((w) => w && !STOPW.has(w));
  function alreadyTracked(name) {
    const need = wordsOf(name);
    return state.products.some((p) => {
      const have = new Set(wordsOf(p.name));
      return need.every((w) => have.has(w) || have.has(w.replace(/s$/, '')) || have.has(`${w}s`));
    });
  }
  function renderWatchlist() {
    const wrap = document.getElementById('tlWatch');
    if (!wrap) return;
    const items = (CFG.watchlist || []).filter((w) => !alreadyTracked(w.name));
    wrap.closest('section').hidden = items.length === 0;
    wrap.innerHTML = '';
    for (const w of items) {
      const tile = el('div', 'tl-tile');
      const photo = buildPhoto(w.img ? { id: w.img, ids: [w.img], listings: [], name: w.name } : null, 'tl-photo');
      photo.appendChild(el('span', 'tl-badge kind-soon', 'Not listed yet'));
      const btn = el('button', 'tl-track', '+ WATCH');
      btn.type = 'button';
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        btn.disabled = true; btn.textContent = 'ADDING…';
        try {
          const res = await fetch('/api/admin/watch', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ game: GAME, name: w.name, msrp: w.msrp ?? null }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          if (window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
          await loadAll();
        } catch (err) {
          btn.disabled = false; btn.textContent = '+ WATCH';
          console.error('[tracker] watch failed', err);
        }
      });
      photo.appendChild(btn);
      tile.appendChild(photo);
      tile.appendChild(el('div', 'tl-name', w.name));
      tile.appendChild(el('div', 'tl-price', w.msrp ? `MSRP ${money(w.msrp)}` : '—'));
      wrap.appendChild(tile);
    }
  }

  function render() {
    for (const [name, fn] of [['hero', renderHero], ['watch list', renderWatchlist], ['coming up', renderComingUp], ['browse', renderBrowse], ['restocks', renderDeals]]) {
      try { fn(); } catch (err) { console.error(`[tracker] ${name} failed`, err); loadErrors.push(`${name}: ${err.message}`); }
    }
    showLoadErrors();
  }

  (async function init() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => console.error('[tracker] SW registration failed', err));
    }
    initSearch();
    initFilter();
    // Draw the page right away from what's built in (Coming up, watch list,
    // hero), then fill in live data when the server answers.
    try { render(); } catch (err) { console.error('[tracker] first render failed', err); }
    loadCatalog();
    await loadAll();
    setInterval(() => { if (!document.hidden) loadAll(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadAll(); });
  })();
})();
