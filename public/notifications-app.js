// notifications-app.js — 2026-10-14
//
// The "all notifications" page: the user's own counter-proposal to a
// backend restock-cooldown was "one notification with a number badge,
// then a page with everything I may have missed" — this is that page.
// Pulls the full, real history (confirmed /api/events + unconfirmed
// /api/heads-up, same two sources urgent-ticker.js already mixes for the
// top marquee/toasts) with NO freshness window — unlike the ticker, this
// page's whole point is to show things you missed a while ago too.
//
// include_muted=1 is passed deliberately: muting a product only stops the
// push/toast/badge (see worker/migrations/0008_product_muted.sql) — this
// page is the one place the full, honest record always shows, muted or
// not, with a visible "muted" tag so it's clear why something didn't
// otherwise bug you.

const LAST_SEEN_KEY = 'tcg-last-seen-event-id';
const LIMIT = 150;

const listEl = document.getElementById('notifList');
const tabsEl = document.getElementById('notifTabs');
const muteListEl = document.getElementById('notifMuteList');
const markReadBtn = document.getElementById('notifMarkReadBtn');

let allItems = []; // normalized, merged, sorted newest-first
let activeTab = 'all';

function kindGlyph(kind) {
  if (kind === 'restock') return '🟢';
  if (kind === 'good_price') return '💰';
  if (kind === 'drawing_open') return '🎟️';
  if (kind === 'drawing_reminder') return '⏰';
  if (kind === 'headsup') return '❓';
  return '🔔';
}

function timeAgo(iso) {
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 1440) return `${Math.round(diffMin / 60)}h ago`;
  return `${Math.round(diffMin / 1440)}d ago`;
}

// 2026-10-15 — same list-row design as Heads Up. Repeats of the same alert
// are grouped into one row with ×N.
const KIND_TEXT = { restock: 'Restock', good_price: 'Good price', drawing_open: 'Drawing open', drawing_reminder: 'Drawing soon', headsup: 'Unconfirmed', price_target: 'Price alert', new_listing: 'Now listed' };
const GAME_ICON = { pokemon: '/icons/pokemon.png', mtg: '/icons/mtg.png', lorcana: '/icons/lorcana.png' };
let productsById = {};

function renderList() {
  listEl.innerHTML = '';
  const filtered = allItems.filter((it) => {
    // Same rule as the game pages: a "restock" more than 20% over MSRP is a
    // reseller listing, not a real restock — don't show it.
    if (it.kind === 'restock') {
      const msrp = (productsById[it.product_id] || {}).msrp;
      const m = it.message.match(/\$([\d.]+)/);
      if (msrp && m && Number(m[1]) > msrp * 1.2 + 0.01) return false;
    }
    if (activeTab === 'confirmed') return it.confirmed;
    if (activeTab === 'unconfirmed') return !it.confirmed;
    return true;
  });
  const groups = new Map();
  for (const it of filtered) {
    const k = `${it.kind}|${it.message}`;
    const g = groups.get(k);
    if (g) g.count += 1; else groups.set(k, { it, count: 1 });
  }
  if (groups.size === 0) {
    listEl.innerHTML = '<div class="empty-state">Nothing here yet.</div>';
    return;
  }
  for (const { it, count } of groups.values()) {
    const row = document.createElement(it.url ? 'a' : 'div');
    row.className = 'tl-item';
    if (it.url) { row.href = it.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; }
    const game = it.game || (productsById[it.product_id] || {}).game;
    const icon = document.createElement('div');
    icon.className = 'tl-item-icon';
    if (GAME_ICON[game]) icon.innerHTML = `<img src="${GAME_ICON[game]}" alt="">`;
    row.appendChild(icon);

    const main = document.createElement('div');
    main.className = 'tl-item-main';
    const tags = document.createElement('div');
    tags.className = 'tl-item-tags';
    const tag = document.createElement('span');
    tag.className = 'tl-tag tl-tag-' + (it.confirmed ? it.kind : 'unconfirmed');
    tag.textContent = KIND_TEXT[it.kind] || it.kind;
    tags.appendChild(tag);
    if (it.product_muted) {
      const m = document.createElement('span');
      m.className = 'tl-tag';
      m.textContent = 'Alerts off';
      tags.appendChild(m);
    }
    main.appendChild(tags);
    const title = document.createElement('div');
    title.className = 'tl-item-title';
    const t = document.createElement('textarea');
    t.innerHTML = it.message.replace(/^(RESTOCK|GOOD PRICE):\s*/i, '');
    title.textContent = t.value;
    main.appendChild(title);
    const meta = document.createElement('div');
    meta.className = 'tl-item-meta';
    meta.textContent = timeAgo(it.created_at) + (count > 1 ? ` · ×${count}` : '');
    main.appendChild(meta);
    row.appendChild(main);
    if (it.url) {
      const go = document.createElement('span');
      go.className = 'tl-item-go';
      go.textContent = 'VIEW →';
      row.appendChild(go);
    }
    listEl.appendChild(row);
  }
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.tl-pill[data-tab]');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  for (const t of tabsEl.querySelectorAll('.tl-pill[data-tab]')) t.classList.toggle('active', t === btn);
  renderList();
});

async function loadNotifications() {
  try {
    const [eventsRes, headsUpRes] = await Promise.all([
      fetch(`/api/events?limit=${LIMIT}&include_muted=1`),
      fetch(`/api/heads-up?limit=${LIMIT}`),
    ]);
    const events = eventsRes.ok ? await eventsRes.json() : [];
    const headsUp = headsUpRes.ok ? await headsUpRes.json() : [];
    allItems = [
      ...(events || []).map((ev) => ({
        key: `event-${ev.id}`, id: ev.id, message: ev.message, url: ev.url, created_at: ev.created_at,
        kind: ev.kind, confirmed: true, product_muted: !!ev.product_muted, product_id: ev.product_id,
      })),
      ...(headsUp || []).map((ev) => ({
        key: `headsup-${ev.id}`, id: null, message: ev.title, url: ev.url, created_at: ev.discovered_at,
        kind: 'headsup', confirmed: false, product_muted: false, game: ev.game,
      })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    renderList();

    // Opening this page IS "I've seen everything up to now" — advance the
    // read marker to the highest real event id we just fetched, and clear
    // the bell badge / app icon badge immediately rather than waiting for
    // notification-badge.js's next 30s poll.
    const maxEventId = Math.max(0, ...events.map((ev) => ev.id || 0));
    try { localStorage.setItem(LAST_SEEN_KEY, String(maxEventId)); } catch (_) {}
    const badge = document.getElementById('tcgNotifBadge');
    if (badge) badge.style.display = 'none';
    try { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {}); } catch (_) {}
  } catch (err) {
    console.error('[notifications] load failed', err);
    listEl.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    errBox.textContent = `Couldn't load notifications (${err.message || 'unknown error'}).`;
    listEl.appendChild(errBox);
  }
}

markReadBtn.addEventListener('click', () => {
  const maxId = Math.max(0, ...allItems.filter((it) => it.id != null).map((it) => it.id));
  try { localStorage.setItem(LAST_SEEN_KEY, String(maxId)); } catch (_) {}
  const badge = document.getElementById('tcgNotifBadge');
  if (badge) badge.style.display = 'none';
  try { if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {}); } catch (_) {}
});

async function loadMuteList() {
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const products = await res.json();
    muteListEl.innerHTML = '';
    if (products.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = 'No tracked products yet.';
      muteListEl.appendChild(empty);
      return;
    }
    // Alphabetical, not insertion order — this list is for finding one
    // specific product to mute, not for browsing by recency.
    productsById = Object.fromEntries(products.map((p) => [p.id, p]));
    const sorted = [...products].sort((a, b) => (a.game || '').localeCompare(b.game || '') || a.name.localeCompare(b.name));
    for (const p of sorted) {
      const tile = document.createElement('div');
      tile.className = 'tl-tile';
      const photo = document.createElement('div');
      photo.className = 'tl-photo';
      const img = (p.listings || []).map((l) => l.image_url).find(Boolean);
      photo.innerHTML = img
        ? `<img class="tl-img" src="${img}" alt="" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;tl-ph&quot;><img src=&quot;${GAME_ICON[p.game] || '/icons/icon-192.png'}&quot; alt=&quot;&quot;></div>'">`
        : `<div class="tl-ph"><img src="${GAME_ICON[p.game] || '/icons/icon-192.png'}" alt=""></div>`;
      const btn = document.createElement('button');
      btn.type = 'button';
      const paint = () => { btn.className = 'tl-track' + (p.muted ? '' : ' on'); btn.textContent = p.muted ? '+ TRACK' : '✓ TRACKING'; };
      paint();
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await fetch('/api/admin/set-muted', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ product_id: p.id, muted: !p.muted }) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          p.muted = p.muted ? 0 : 1;
          paint();
          if (!p.muted && window.tcgEnsurePushEnabled) window.tcgEnsurePushEnabled();
        } catch (err) { console.error('[notifications] toggle failed', err); }
        finally { btn.disabled = false; }
      });
      photo.appendChild(btn);
      tile.appendChild(photo);
      const name = document.createElement('div');
      name.className = 'tl-name';
      name.textContent = p.name;
      tile.appendChild(name);
      muteListEl.appendChild(tile);
    }
  } catch (err) {
    console.error('[notifications] mute list load failed', err);
    muteListEl.innerHTML = '';
    const errBox = document.createElement('div');
    errBox.className = 'empty-state';
    errBox.textContent = `Couldn't load products (${err.message || 'unknown error'}).`;
    muteListEl.appendChild(errBox);
  }
}

(async function init() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('/sw.js'); } catch (err) { console.error('[notifications] sw register failed', err); }
  }
  await loadMuteList();
  await loadNotifications();
  setInterval(loadNotifications, 30000);
})();
