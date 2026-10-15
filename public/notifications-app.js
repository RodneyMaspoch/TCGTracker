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

function renderList() {
  listEl.innerHTML = '';
  const filtered = allItems.filter((it) => {
    if (activeTab === 'confirmed') return it.confirmed;
    if (activeTab === 'unconfirmed') return !it.confirmed;
    return true;
  });
  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Nothing here yet.';
    listEl.appendChild(empty);
    return;
  }
  for (const it of filtered) {
    const row = document.createElement(it.url ? 'a' : 'div');
    row.className = 'event';
    row.dataset.kind = it.kind;
    if (it.url) { row.href = it.url; row.target = '_blank'; row.rel = 'noopener noreferrer'; }

    const kind = document.createElement('span');
    kind.className = 'event-kind';
    kind.textContent = (it.confirmed ? '' : 'UNCONFIRMED · ') + (kindGlyph(it.kind) + ' ' + it.kind.replace('_', ' ').toUpperCase());
    row.appendChild(kind);

    const msg = document.createElement('div');
    msg.className = 'event-msg';
    msg.textContent = it.message;
    row.appendChild(msg);

    const bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;align-items:center;gap:10px;justify-content:space-between';
    const time = document.createElement('span');
    time.className = 'event-time';
    time.textContent = timeAgo(it.created_at);
    bottom.appendChild(time);
    if (it.product_muted) {
      const tag = document.createElement('span');
      tag.className = 'event-muted-tag';
      tag.textContent = '🔕 muted product';
      bottom.appendChild(tag);
    }
    row.appendChild(bottom);

    listEl.appendChild(row);
  }
}

tabsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.notif-tab');
  if (!btn) return;
  activeTab = btn.dataset.tab;
  for (const t of tabsEl.querySelectorAll('.notif-tab')) t.classList.toggle('active', t === btn);
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
        kind: ev.kind, confirmed: true, product_muted: !!ev.product_muted,
      })),
      ...(headsUp || []).map((ev) => ({
        key: `headsup-${ev.id}`, id: null, message: ev.title, url: ev.url, created_at: ev.discovered_at,
        kind: 'headsup', confirmed: false, product_muted: false,
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
    const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name));
    for (const p of sorted) {
      const row = document.createElement('div');
      row.className = 'notif-mute-item';
      const name = document.createElement('span');
      name.className = 'notif-mute-item-name';
      name.textContent = p.name;
      row.appendChild(name);
      if (window.TCGMuteToggle) {
        const btn = window.TCGMuteToggle.buildMuteButton(p);
        btn.style.width = 'auto';
        btn.style.marginTop = '0';
        row.appendChild(btn);
      }
      muteListEl.appendChild(row);
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
  await Promise.all([loadNotifications(), loadMuteList()]);
  setInterval(loadNotifications, 30000);
})();
