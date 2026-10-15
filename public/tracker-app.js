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
  const REFRESH_MS = 20000;

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
        { kind: 'RELEASE', name: "Deck Crafter's Collection", date: '2026-10-23', line: '$9.99' },
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
        { kind: 'EVENT', name: "Magic Presents: All Leylines' Eve", date: '2026-10-30', line: 'Local game stores' },
        { kind: 'EVENT', name: 'Star Trek Prerelease', date: '2026-11-06', line: 'Local game stores' },
        { kind: 'RELEASE', name: 'Star Trek', date: '2026-11-13', line: 'Collector Box $479.99' },
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
  };
  const CFG = GAMES[GAME] || GAMES.pokemon;

  const RETAILER_NAMES = {
    target: 'Target', walmart: 'Walmart', walmart_marketplace: 'Walmart (3rd party)', bestbuy: 'Best Buy',
    gamestop: 'GameStop', pokemoncenter: 'Pokémon Center', samsclub: "Sam's Club", costco: 'Costco', amazon: 'Amazon',
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
  const categorize = (name) => (CATEGORY_RULES.find(([re]) => re.test(name)) || [null, 'More'])[1];

  // ---------------- state ----------------
  const state = { products: [], drawing: null, events: [] };

  async function loadAll() {
    try {
      const [products, drawing, events] = await Promise.all([
        fetch('/api/products').then((r) => r.json()),
        CFG.drawing ? fetch('/api/walmart-drawing').then((r) => r.json()).catch(() => null) : Promise.resolve(null),
        fetch('/api/events?limit=100').then((r) => r.json()),
      ]);
      state.products = groupProducts((products || []).filter((p) => p.game === GAME));
      state.drawing = drawing;
      state.events = events || [];
      render();
    } catch (err) {
      console.error('[tracker] failed to load data', err);
    }
  }

  // The same product tracked at two stores is sometimes stored as two
  // product rows (e.g. hobbit-target / hobbit-walmart). Merge rows with the
  // same base name into one tile with all their stores.
  function baseName(name) {
    return name.replace(/\s*\((3rd-party seller|preorder)\)\s*/gi, ' ').replace(/booster display/i, 'Booster Box').replace(/\s+/g, ' ').trim();
  }
  function groupProducts(rows) {
    const map = new Map();
    for (const p of rows) {
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
  const money = (n) => `$${Number(n).toFixed(2)}`;
  function lowestLivePrice(product) {
    const live = product.listings.filter((l) => l.last_purchasable && l.last_price != null);
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
    if (CFG.drawing && state.drawing) {
      const next = state.drawing.next_drawing_at ? new Date(state.drawing.next_drawing_at) : null;
      items.push({
        kind: 'LOTTERY', name: 'Walmart Collectibles Drawing',
        date: state.drawing.is_open ? new Date() : next,
        line: state.drawing.is_open ? 'OPEN NOW' : (next ? 'Entries open' : 'Next date not announced'),
        url: 'https://www.walmart.com/shop/collectibles/draw', productId: 'pkm-30th-etb',
        open: !!state.drawing.is_open, exact: !!next,
      });
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
    const live = state.products.filter((p) => p.listings.some((l) => l.last_purchasable));
    live.sort((a, b) => {
      const ai = restockIds.findIndex((id) => a.ids.includes(id));
      const bi = restockIds.findIndex((id) => b.ids.includes(id));
      return (ai < 0 ? 1e9 : ai) - (bi < 0 ? 1e9 : bi);
    });
    if (live.length) {
      const p = live[0];
      const l = [...p.listings].filter((x) => x.last_purchasable).sort((a, b) => (a.last_price ?? 1e9) - (b.last_price ?? 1e9))[0];
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
    return { kicker: `${CFG.label} tracker`, title: 'Nothing urgent right now', line: "You'll get an alert the moment something drops." };
  }

  function renderHero() {
    const root = document.getElementById('tlHero');
    if (!root) return;
    const h = pickHero();
    root.innerHTML = '';
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
    root.appendChild(buildPhoto(h.product, 'tl-hero2-photo', CFG.heroArt));
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
    const live = product.listings.some((l) => l.last_purchasable);
    const good = product.listings.some((l) => isGoodPriceListing(product, l));
    const tile = el('div', 'tl-tile');
    tile.tabIndex = 0;
    tile.addEventListener('click', () => openSheet(product));
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSheet(product); });
    const photo = buildPhoto(product, 'tl-photo');
    if (live || good) photo.appendChild(el('span', 'tl-badge' + (good ? ' good' : ''), good ? '$ Good price' : '● In stock'));
    photo.appendChild(buildTrackPill(product));
    tile.appendChild(photo);
    tile.appendChild(el('div', 'tl-name', product.name));
    const low = lowestLivePrice(product);
    tile.appendChild(el('div', 'tl-price', low != null ? money(low) : (product.msrp ? money(product.msrp) : '—')));
    return tile;
  }

  function renderBrowse() {
    const root = document.getElementById('tlRows');
    if (!root) return;
    root.innerHTML = '';
    if (!state.products.length) { root.appendChild(el('div', 'empty-state', 'No tracked products yet.')); return; }
    const groups = new Map();
    for (const p of state.products) {
      const c = categorize(p.name);
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(p);
    }
    for (const [cat, list] of groups) {
      list.sort((a, b) => (b.listings.some((l) => l.last_purchasable) - a.listings.some((l) => l.last_purchasable)) || a.name.localeCompare(b.name));
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
    panel.appendChild(el('div', 'tl-where', 'Where to buy'));
    const listings = [...product.listings].sort((a, b) => (b.last_purchasable || 0) - (a.last_purchasable || 0));
    if (!listings.length) panel.appendChild(el('div', 'tl-store', 'No store tracked yet.'));
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
  const KIND_LABELS = { restock: 'Restock', good_price: 'Good price', drawing_open: 'Drawing open' };
  function renderDeals() {
    const wrap = document.getElementById('tlDeals');
    if (!wrap) return;
    wrap.innerHTML = '';
    const groups = new Map();
    for (const ev of state.events) {
      const product = ev.product_id ? findProduct(ev.product_id) : null;
      if (!product) continue; // only this game's products
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

  function render() {
    renderHero();
    renderComingUp();
    renderBrowse();
    renderDeals();
  }

  (async function init() {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js'); } catch (err) { console.error('[tracker] SW registration failed', err); }
    }
    await loadAll();
    setInterval(loadAll, REFRESH_MS);
  })();
})();
