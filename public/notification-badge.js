// notification-badge.js — 2026-10-14
//
// Shared on every page (same pattern as urgent-ticker.js/push-client.js):
// keeps the nav's notification-bell badge (an element with
// id="tcgNotifBadge" inside the nav link with id="tcgNotifNavLink")
// showing how many real, non-muted events have happened since the user
// last opened the notifications page, and mirrors that same number onto
// the installed PWA's home-screen icon via the Badging API where the
// browser supports one.
//
// Why localStorage and not something server-tracked: this app has no
// accounts/login (documented standing posture — "single trusted user, not
// multi-tenant" per index.js's own admin-route comments), so there is no
// per-user row to store a read-marker against server-side. The marker
// lives per-browser/device instead — opening notifications.html on your
// phone doesn't mark things read on your laptop. That's an honest
// limitation, not a bug, and is noted in notifications.html itself.
(function () {
  const LAST_SEEN_KEY = 'tcg-last-seen-event-id';
  const REFRESH_MS = 60000; // 2026-10-20 — was 30s; database budget

  function getLastSeenId() {
    try {
      return parseInt(localStorage.getItem(LAST_SEEN_KEY), 10) || 0;
    } catch (_) {
      return 0;
    }
  }

  function applyBadge(count) {
    const badge = document.getElementById('tcgNotifBadge');
    if (badge) {
      if (count > 0) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    }
    // PWA app-icon badge (Android/desktop Chrome, Safari on installed
    // iOS PWAs) — wrapped defensively since support is inconsistent and a
    // thrown error here should never break the in-page badge above.
    try {
      if (count > 0 && 'setAppBadge' in navigator) {
        navigator.setAppBadge(count).catch(() => {});
      } else if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(() => {});
      }
    } catch (_) { /* Badging API unsupported — in-page badge still works */ }
  }

  async function refresh() {
    try {
      const sinceId = getLastSeenId();
      const res = await fetch(`/api/events/unread-count?since_id=${sinceId}`);
      if (!res.ok) return;
      const body = await res.json();
      applyBadge(body.count || 0);
    } catch (err) {
      console.error('[notification-badge] refresh failed', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  });
})();
