// site-search.js — 2026-10-20. One search box in the top menu that looks
// through EVERYTHING: your tracked products, every sold-by-Walmart Pokémon /
// Magic / Lorcana product, and the whole Nintendo Store. Typing filters
// instantly; Enter also asks Walmart and Nintendo directly for anything not
// already loaded. Every result can be opened or tracked with one tap.
(function () {
  'use strict';
  const GAME_NAME = { pokemon: 'Pokémon', mtg: 'Magic', lorcana: 'Lorcana', nintendo: 'Nintendo' };
  const GAME_PAGE = { pokemon: '/pokemon', mtg: '/', lorcana: '/lorcana', nintendo: '/nintendo' };
  const gameOf = (title) => (/pok[eé]mon/i.test(title) ? 'pokemon' : /lorcana/i.test(title) ? 'lorcana' : /magic|mtg|secret lair/i.test(title) ? 'mtg' : null);

  let data = null; // { tracked, walmart, nintendo }
  async function getJson(url) {
    try { const r = await fetch(url); return r.ok ? await r.json() : null; } catch (_) { return null; }
  }
  async function loadAll() {
    if (data) return data;
    const [products, wp, wm, wl, nin] = await Promise.all([
      getJson('/api/products'),
      getJson('/api/walmart/catalog?game=pokemon'), getJson('/api/walmart/catalog?game=mtg'), getJson('/api/walmart/catalog?game=lorcana'),
      getJson('/api/nintendo/catalog'),
    ]);
    data = {
      tracked: Array.isArray(products) ? products : [],
      walmart: [
        ...((wp && wp.results) || []).map((x) => ({ ...x, game: 'pokemon' })),
        ...((wm && wm.results) || []).map((x) => ({ ...x, game: 'mtg' })),
        ...((wl && wl.results) || []).map((x) => ({ ...x, game: 'lorcana' })),
      ],
      nintendo: ((nin && nin.results) || []).map((x) => ({ ...x, game: 'nintendo' })),
      trackedOk: Array.isArray(products),
    };
    return data;
  }

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const money = (n) => (n == null ? '' : `$${Number(n).toFixed(2)}`);
  const matches = (title, q) => { const t = String(title || '').toLowerCase(); return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => t.includes(w)); };

  function tile(item, kind) {
    const t = el('a', 'tl-tile');
    t.href = item.url || GAME_PAGE[item.game] || '/';
    if (item.url && /^https?:/.test(item.url)) { t.target = '_blank'; t.rel = 'noopener noreferrer'; }
    const photo = el('div', 'tl-photo');
    if (item.image) {
      const img = el('img', 'tl-img'); img.src = item.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
      img.onerror = () => img.remove();
      photo.appendChild(img);
    } else {
      photo.appendChild(el('div', 'tl-ph', GAME_NAME[item.game] || ''));
    }
    const inStock = item.inStock || item.stockStatus === 'IN_STOCK';
    if (inStock) photo.appendChild(el('span', 'tl-badge', '● In stock'));
    if (kind !== 'tracked' && item.game) {
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
        } catch (err) {
          btn.disabled = false; btn.textContent = '+ TRACK';
        }
      });
      photo.appendChild(btn);
    }
    t.appendChild(photo);
    t.appendChild(el('div', 'tl-name', item.title));
    t.appendChild(el('div', 'tl-price', [money(item.price), GAME_NAME[item.game]].filter(Boolean).join(' · ')));
    return t;
  }

  function section(root, title, items, kind) {
    if (!items.length) return;
    root.appendChild(el('div', 'tl-gs-head', `${title} · ${items.length}`));
    const grid = el('div', 'tl-strip tl-wrap');
    for (const it of items.slice(0, 60)) grid.appendChild(tile(it, kind));
    root.appendChild(grid);
  }

  let overlay; let input; let results; let msg;
  async function runLocal() {
    const q = input.value.trim();
    results.innerHTML = '';
    if (!q) { msg.textContent = 'Search everything: your tracked products, Pokémon / Magic / Lorcana at Walmart, and the Nintendo Store.'; return; }
    msg.textContent = 'Searching…';
    const d = await loadAll();
    const tracked = d.tracked.filter((p) => matches(p.name, q)).map((p) => {
      const l = (p.listings || [])[0] || {};
      return { title: p.name, game: p.game, url: GAME_PAGE[p.game] || '/', image: (p.listings || []).map((x) => x.image_url).find(Boolean), price: l.last_price, inStock: (p.listings || []).some((x) => x.last_purchasable) };
    });
    const wal = d.walmart.filter((x) => matches(x.title, q));
    const nin = d.nintendo.filter((x) => matches(x.title, q));
    section(results, 'Your tracked products', tracked, 'tracked');
    section(results, 'Sold by Walmart', wal, 'store');
    section(results, 'Nintendo Store', nin, 'store');
    const n = tracked.length + wal.length + nin.length;
    msg.textContent = n ? `${n} found — press Enter to also search the stores directly` : `Nothing loaded matches "${q}" — press Enter to search Walmart and Nintendo directly`;
    if (!d.trackedOk) msg.textContent += ' (your tracked products could not load right now)';
  }
  async function runLive() {
    const q = input.value.trim();
    if (!q) return;
    msg.textContent = 'Searching Walmart and the Nintendo Store…';
    const [w, n] = await Promise.all([
      getJson(`/api/walmart/search?q=${encodeURIComponent(q)}`),
      getJson(`/api/nintendo/search?q=${encodeURIComponent(q)}`),
    ]);
    results.innerHTML = '';
    const wal = ((w && w.results) || []).map((x) => ({ ...x, game: gameOf(x.title) }));
    const nin = ((n && n.results) || []).map((x) => ({ ...x, game: 'nintendo' }));
    section(results, 'Sold by Walmart', wal, 'store');
    section(results, 'Nintendo Store', nin, 'store');
    msg.textContent = wal.length + nin.length ? `${wal.length + nin.length} found in the stores for "${q}"` : `No store results for "${q}".`;
  }

  function open() {
    if (!overlay) {
      overlay = el('div', 'tl-gs');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', 'Search everything');
      const bar = el('form', 'tl-search-form tl-gs-bar');
      bar.setAttribute('role', 'search');
      input = el('input'); input.type = 'search'; input.placeholder = 'Search everything — e.g. elite trainer box, amiibo, Hyperia…'; input.setAttribute('aria-label', 'Search everything');
      const go = el('button', null, 'Search'); go.type = 'submit';
      const close = el('button', 'tl-gs-close', '✕'); close.type = 'button'; close.setAttribute('aria-label', 'Close search');
      bar.append(input, go, close);
      msg = el('div', 'tl-search-msg');
      results = el('div', 'tl-gs-results');
      overlay.append(bar, msg, results);
      document.body.appendChild(overlay);
      let timer;
      input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runLocal, 150); });
      bar.addEventListener('submit', (e) => { e.preventDefault(); runLive(); });
      close.addEventListener('click', shut);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) shut(); });
    }
    overlay.hidden = false;
    document.body.classList.add('tl-gs-open');
    input.focus();
    runLocal();
  }
  function shut() { overlay.hidden = true; document.body.classList.remove('tl-gs-open'); }

  function addButton() {
    const nav = document.querySelector('.tcg-nav');
    if (!nav || nav.querySelector('.tcg-nav-search')) return;
    const b = el('button', 'tcg-nav-item tcg-nav-search');
    b.type = 'button';
    b.setAttribute('aria-label', 'Search everything');
    b.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.13l4.24 4.23-1.42 1.42-4.23-4.24A7.5 7.5 0 1 1 10.5 3zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z" fill="currentColor"/></svg><span class="tcg-nav-tip">Search</span>';
    b.addEventListener('click', open);
    nav.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addButton); else addButton();
})();
