// site-search.js — 2026-10-20. ONE search that looks everywhere it can:
//   • your tracked products (every store you track: Walmart, Target, Best Buy,
//     GameStop, Pokémon Center, Nintendo…)
//   • the watch list and Coming up (this page's game)
//   • every sold-by-Walmart Pokémon / Magic / Lorcana product, plus a live
//     search of Walmart's official feed (sold by Walmart only — user rule)
//   • the whole Nintendo Store, plus a live Nintendo search
//   • Heads Up tips
//   • one-tap "search on" links for stores that can't be read automatically
//     (Target, Best Buy, GameStop, Pokémon Center, Amazon, TCGplayer)
// It sits at the TOP of every product page, and the 🔍 in the menu opens the
// same search from anywhere.
(function () {
  'use strict';
  const GAME_NAME = { pokemon: 'Pokémon', mtg: 'Magic', lorcana: 'Lorcana', nintendo: 'Nintendo' };
  const GAME_PAGE = { pokemon: '/pokemon', mtg: '/', lorcana: '/lorcana', nintendo: '/nintendo' };
  const GAME_TERM = { pokemon: 'pokemon', mtg: 'magic the gathering', lorcana: 'disney lorcana' };
  const RETAILER = { walmart: 'Walmart', walmart_marketplace: 'Walmart (3rd-party)', target: 'Target', bestbuy: 'Best Buy', gamestop: 'GameStop', pokemoncenter: 'Pokémon Center', nintendo: 'Nintendo Store', samsclub: "Sam's Club", costco: 'Costco', amazon: 'Amazon', secretlair: 'Secret Lair' };
  const OTHER_STORES = [
    ['Walmart (all sellers)', (q) => `https://www.walmart.com/search?q=${q}`],
    ['Target', (q) => `https://www.target.com/s?searchTerm=${q}`],
    ['Best Buy', (q) => `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`],
    ['GameStop', (q) => `https://www.gamestop.com/search/?q=${q}`],
    ['Pokémon Center', (q) => `https://www.pokemoncenter.com/search/${q}`],
    ['Amazon', (q) => `https://www.amazon.com/s?k=${q}`],
    ['TCGplayer', (q) => `https://www.tcgplayer.com/search/all/product?q=${q}`],
  ];
  const ICON = { pokemon: '/icons/pokemon.png', mtg: '/icons/mtg.png', lorcana: '/icons/lorcana.png', nintendo: '/icons/icon-192.png' };
  const ph = (game) => { const d = el('div', 'tl-ph'); const i = el('img'); i.src = ICON[game] || '/icons/icon-192.png'; i.alt = ''; d.appendChild(i); return d; };
  const gameOf = (title) => (/pok[eé]mon/i.test(title) ? 'pokemon' : /lorcana/i.test(title) ? 'lorcana' : /magic|mtg|secret lair/i.test(title) ? 'mtg' : null);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const money = (n) => (n == null || n === '' ? '' : `$${Number(n).toFixed(2)}`);
  const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (title, q) => { const t = String(title || '').toLowerCase(); return words(q).every((w) => t.includes(w)); };

  async function getJson(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (_) { return null; }
  }
  let dataPromise = null;
  function loadAll() {
    if (!dataPromise) {
      dataPromise = Promise.all([
        getJson('/api/products'),
        getJson('/api/walmart/catalog?game=pokemon'), getJson('/api/walmart/catalog?game=mtg'), getJson('/api/walmart/catalog?game=lorcana'),
        getJson('/api/nintendo/catalog'),
        getJson('/api/heads-up?limit=100'),
      ]).then(([products, wp, wm, wl, nin, tips]) => ({
        tracked: Array.isArray(products) ? products : [],
        trackedOk: Array.isArray(products),
        walmart: [
          ...((wp && wp.results) || []).map((x) => ({ ...x, game: 'pokemon' })),
          ...((wm && wm.results) || []).map((x) => ({ ...x, game: 'mtg' })),
          ...((wl && wl.results) || []).map((x) => ({ ...x, game: 'lorcana' })),
        ],
        nintendo: ((nin && nin.results) || []).map((x) => ({ ...x, game: 'nintendo' })),
        tips: Array.isArray(tips) ? tips : [],
      }));
    }
    return dataPromise;
  }

  function tile(item, { track = true } = {}) {
    const t = el('a', 'tl-tile');
    t.href = item.url || GAME_PAGE[item.game] || '/';
    if (/^https?:/.test(t.getAttribute('href'))) { t.target = '_blank'; t.rel = 'noopener noreferrer'; }
    const photo = el('div', 'tl-photo');
    if (item.image) {
      const img = el('img', 'tl-img'); img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => { img.remove(); photo.prepend(ph(item.game)); };
      photo.appendChild(img);
    } else {
      photo.appendChild(ph(item.game));
    }
    if (item.badge) photo.appendChild(el('span', `tl-badge ${item.badgeCls || ''}`, item.badge));
    else if (item.inStock || item.stockStatus === 'IN_STOCK') photo.appendChild(el('span', 'tl-badge', '● In stock'));
    if (track && item.game && item.url) {
      const btn = el('button', 'tl-track', '+ TRACK');
      btn.type = 'button';
      btn.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        btn.disabled = true; btn.textContent = 'ADDING…';
        try {
          const nin = item.game === 'nintendo';
          const res = await fetch('/api/admin/track-product', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              game: item.game, name: item.title, retailer: nin ? 'nintendo' : 'walmart', url: item.url,
              poll_tier: nin || item.game === 'pokemon' ? 'fast' : 'slow',
              msrp: nin ? (item.regPrice ?? null) : (item.msrp ?? item.price ?? null),
            }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          btn.textContent = '✓ TRACKING'; btn.classList.add('on');
          if (window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
        } catch (_) {
          btn.disabled = false; btn.textContent = '+ TRACK';
        }
      });
      photo.appendChild(btn);
    }
    t.appendChild(photo);
    t.appendChild(el('div', 'tl-name', item.title));
    t.appendChild(el('div', 'tl-price', item.line || [money(item.price), item.store || GAME_NAME[item.game]].filter(Boolean).join(' · ')));
    return t;
  }

  // One search box + results, used both at the top of a page and in the overlay.
  function mount(container, opts = {}) {
    const game = opts.game || null;
    const bar = el('form', 'tl-search-form tl-gs-bar');
    bar.setAttribute('role', 'search');
    const input = el('input');
    input.type = 'search';
    input.placeholder = opts.placeholder || 'Search everything — tracked products, Walmart, Nintendo, tips…';
    input.setAttribute('aria-label', input.placeholder);
    const go = el('button', null, 'Search'); go.type = 'submit';
    bar.append(input, go);
    if (opts.onClose) {
      const close = el('button', 'tl-gs-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Close search');
      close.addEventListener('click', opts.onClose);
      bar.append(close);
    }
    const msg = el('div', 'tl-search-msg');
    const results = el('div', 'tl-gs-results');
    container.append(bar, msg, results);

    let runId = 0;
    let live = { walmart: [], nintendo: [] };
    let lastLiveQ = '';

    function section(title, items, opt) {
      if (!items.length) return 0;
      results.appendChild(el('div', 'tl-gs-head', `${title} · ${items.length}`));
      const grid = el('div', 'tl-strip tl-wrap');
      for (const it of items.slice(0, 40)) grid.appendChild(tile(it, opt));
      results.appendChild(grid);
      return items.length;
    }
    const rank = (list) => (game ? [...list.filter((x) => x.game === game), ...list.filter((x) => x.game !== game)] : list);
    const dedupe = (list) => { const seen = new Set(); return list.filter((x) => { const k = x.url || x.title; if (seen.has(k)) return false; seen.add(k); return true; }); };

    async function render(q) {
      const d = await loadAll();
      results.innerHTML = '';
      if (!q) { msg.textContent = opts.hint || ''; return; }
      let n = 0;
      // 1. tracked products (all stores)
      n += section('Your tracked products', rank(d.tracked.filter((p) => matches(p.name, q)).map((p) => {
        const ls = p.listings || [];
        const live = ls.find((l) => l.last_purchasable);
        return {
          title: p.name, game: p.game, url: (live || ls[0] || {}).url || GAME_PAGE[p.game],
          image: ls.map((l) => l.image_url).find(Boolean),
          line: [...new Set(ls.map((l) => RETAILER[l.retailer] || l.retailer))].join(' · ') || 'Watching — not listed yet',
          badge: live ? '● In stock' : null,
        };
      })), { track: false });
      // 2. watch list + coming up (this page's game)
      const page = window.TCG_PAGE;
      if (page) {
        const planned = [
          ...(page.upcoming || []).filter((u) => new Date(u.date + 'T23:59:59') >= new Date()).map((u) => ({ title: u.name, game: page.game, url: u.url || GAME_PAGE[page.game], image: page.imgMap && page.imgMap[u.name], line: `${new Date(u.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} · ${u.line || ''}`, badge: u.kind })),
          ...(page.watchlist || []).map((w) => ({ title: w.name, game: page.game, url: GAME_PAGE[page.game], image: (w.img && page.images && page.images[w.img]) || (page.imgMap && page.imgMap[w.name]), line: w.msrp ? `MSRP ${money(w.msrp)} · watch list` : 'Watch list', badge: 'Not listed yet', badgeCls: 'kind-soon' })),
        ].filter((x) => matches(x.title, q));
        n += section(`Coming up & watch list — ${GAME_NAME[page.game]}`, planned, { track: false });
      }
      // 3. Walmart (sold by Walmart) — loaded lists + live search
      const wal = dedupe(rank([...d.walmart.filter((x) => matches(x.title, q)), ...live.walmart]));
      n += section('Sold by Walmart', wal.map((x) => ({ ...x, store: 'Walmart' })));
      // 4. Nintendo Store
      const nin = dedupe([...d.nintendo.filter((x) => matches(x.title, q)), ...live.nintendo]);
      n += section('Nintendo Store', game === 'nintendo' || !game ? nin : nin, {});
      // 5. Heads Up tips
      n += section('Heads Up tips', d.tips.filter((t) => matches(t.title, q)).map((t) => ({ title: t.title, game: t.game, url: t.url || '/heads-up', line: [t.retailer, 'tip'].filter(Boolean).join(' · '), badge: 'Tip', badgeCls: 'kind-soon' })), { track: false });
      // 6. stores we can't read automatically → one-tap links
      results.appendChild(el('div', 'tl-gs-head', 'Search other stores'));
      const chips = el('div', 'tl-chips');
      const enc = encodeURIComponent(q);
      for (const [name, url] of OTHER_STORES) {
        const a = el('a', 'tl-chip', `${name} ↗`);
        a.href = url(enc); a.target = '_blank'; a.rel = 'noopener noreferrer';
        chips.appendChild(a);
      }
      results.appendChild(chips);
      msg.textContent = n ? `${n} found for "${q}"${lastLiveQ === q ? '' : ' — checking Walmart and Nintendo…'}` : (lastLiveQ === q ? `Nothing found for "${q}" in your products, Walmart or Nintendo — try the store links below.` : 'Searching…');
      if (!d.trackedOk) msg.textContent += ' (your tracked products could not load right now)';
    }

    async function liveSearch(q) {
      const id = ++runId;
      const queries = [q];
      if (game && GAME_TERM[game] && !q.toLowerCase().includes(GAME_TERM[game].split(' ')[0])) queries.push(`${GAME_TERM[game]} ${q}`);
      const [w, n] = await Promise.all([
        Promise.all(queries.map((x) => getJson(`/api/walmart/search?q=${encodeURIComponent(x)}`))),
        getJson(`/api/nintendo/search?q=${encodeURIComponent(q)}`),
      ]);
      if (id !== runId) return; // a newer search started
      live = {
        walmart: w.flatMap((r) => (r && r.results) || []).map((x) => ({ ...x, game: gameOf(x.title) })),
        nintendo: ((n && n.results) || []).map((x) => ({ ...x, game: 'nintendo' })),
      };
      lastLiveQ = q;
      render(q);
    }

    let t1; let t2;
    input.addEventListener('input', () => {
      const q = input.value.trim();
      clearTimeout(t1); clearTimeout(t2);
      live = { walmart: [], nintendo: [] }; lastLiveQ = '';
      t1 = setTimeout(() => render(q), 150);
      if (q.length >= 3) t2 = setTimeout(() => liveSearch(q), 700); // also asks Walmart + Nintendo directly
    });
    bar.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      clearTimeout(t2);
      render(q);
      if (q) liveSearch(q);
    });
    msg.textContent = opts.hint || '';
    return { input, run: () => render(input.value.trim()) };
  }

  // ---------- menu 🔍 overlay ----------
  let overlay; let overlayApi;
  function open() {
    if (!overlay) {
      overlay = el('div', 'tl-gs');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Search everything');
      document.body.appendChild(overlay);
      overlayApi = mount(overlay, {
        game: document.body.dataset.game && GAME_NAME[document.body.dataset.game] ? document.body.dataset.game : null,
        hint: 'Search everything: your tracked products, watch list, Walmart, the Nintendo Store and tips — plus links to search other stores.',
        onClose: shut,
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) shut(); });
    }
    overlay.hidden = false;
    document.body.classList.add('tl-gs-open');
    overlayApi.input.focus();
  }
  function shut() { overlay.hidden = true; document.body.classList.remove('tl-gs-open'); }

  function init() {
    const nav = document.querySelector('.tcg-nav');
    if (nav && !nav.querySelector('.tcg-nav-search')) {
      const b = el('button', 'tcg-nav-item tcg-nav-search');
      b.type = 'button';
      b.setAttribute('aria-label', 'Search everything');
      b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.13l4.24 4.23-1.42 1.42-4.23-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" fill="currentColor"/></svg><span class="tcg-nav-tip">Search</span>';
      b.addEventListener('click', open);
      nav.appendChild(b);
    }
    // Search at the TOP of product pages.
    const top = document.getElementById('tlTopSearch');
    if (top) {
      const game = top.dataset.game;
      mount(top, {
        game,
        placeholder: `Search ${GAME_NAME[game] || ''} — or anything: Walmart, Nintendo, your products, tips…`,
        hint: '',
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
