// urgent-ticker.js — a single cross-game "something just happened" bar,
// shown at the very top of EVERY page (MTG, Lorcana, Pokémon, Heads Up),
// above the ticker/hero/header/everything else. Explicit ask: "I need to
// know Pokémon Center is ready for a drop so I can get there IMMEDIATELY
// no matter what page I'm on" — a restock on the Pokémon page shouldn't
// only be visible to someone who happens to already be on that page.
//
// Pulls from BOTH /api/events (confirmed restock/price/drawing from our
// own retailer polling) AND /api/heads-up (unconfirmed third-party
// signals). Pokémon Center specifically is blocked by Incapsula
// bot-protection, so our own polling can't confirm a PC drop directly —
// the only realistic way "Pokémon Center is ready" ever reaches this
// ticker is via the unconfirmed tier, so both are shown, each clearly
// labeled confirmed vs UNCONFIRMED.
//
// Only shows events from the last FRESH_MS — an event from 3 days ago
// isn't "immediate," it's stale, and showing it permanently would just
// be clutter contradicting the "most important thing" framing. When
// nothing qualifies, this renders nothing at all (no empty bar).
//
// STICKY: lives INSIDE each page's sticky header container (every page
// now marks that container with [data-tcg-sticky-header]) instead of
// being its own separate sticky element — two independent
// position:sticky;top:0 elements stack on TOP of each other, not below
// one another, so nesting this one as the header's first child was the
// only way to make both "stick together" correctly, stacked.
//
// TOASTS: a separate, persistent (no auto-dismiss, manually closed)
// toast appears for anything genuinely NEW since the last poll — not for
// what was already there on page load, which would just spam the first
// 3 hours of history every time the page opens.
//
// FULLY SELF-CONTAINED ON PURPOSE: index.html/lorcana.html never link
// public/styles.css at all (they're self-contained pages with their own
// inline <style> blocks) — an earlier version that relied on styles.css
// classes/variables rendered as plain unstyled text there. This version
// injects its own <style> tag and picks its color from
// document.body.dataset.game directly in JS, so it works identically on
// every page regardless of what that page does or doesn't link.

(function () {
  const REFRESH_MS = 30000;
  const FRESH_MS = 3 * 60 * 60 * 1000; // 3 hours

  // Matches each page's own warning/urgent color (same values as
  // styles.css's --warn/--warn-ink per game, kept in sync by eye since
  // this file can't depend on that stylesheet existing).
  const GAME_COLORS = {
    mtg: { bg: '#ff5c7a', ink: '#170409' },
    lorcana: { bg: '#ff9a3d', ink: '#2a1207' },
    pokemon: { bg: '#e5383b', ink: '#210800' },
    headsup: { bg: '#ff5c5c', ink: '#240404' },
  };
  const colors = GAME_COLORS[document.body.dataset.game] || GAME_COLORS.headsup;

  const STYLE = `
    .tcg-urgent-wrap {
      position: relative;
      overflow: hidden;
      width: 100%;
      background: ${colors.bg};
      border-bottom: 1px solid rgba(0,0,0,.2);
      padding: 9px 0;
      box-sizing: border-box;
    }
    .tcg-urgent-track {
      display: flex;
      width: max-content;
      gap: 48px;
      animation: tcg-urgent-scroll 22s linear infinite;
      will-change: transform;
    }
    .tcg-urgent-wrap:hover .tcg-urgent-track { animation-play-state: paused; }
    @keyframes tcg-urgent-scroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
    .tcg-urgent-item {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 auto;
      white-space: nowrap;
      padding: 0 24px;
      font-family: 'Roboto Mono', monospace;
      font-size: 14px;
      font-weight: 700;
      color: ${colors.ink};
      text-decoration: none;
    }
    a.tcg-urgent-item:hover { text-decoration: underline; }
    .tcg-urgent-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: ${colors.ink};
      animation: tcg-urgent-blink 1.1s infinite;
      flex: none;
    }
    @keyframes tcg-urgent-blink { 0%, 100% { opacity: 1; } 50% { opacity: .25; } }
    .tcg-urgent-time { font-weight: 500; opacity: .75; }
    .tcg-urgent-unconfirmed {
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .06em;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(0,0,0,.22);
    }

    /* ---------- Toasts — persistent, stacked bottom-right, manually
       dismissed (no setTimeout auto-removal). One per genuinely-new
       item found since the last poll. ---------- */
    .tcg-toast-stack {
      position: fixed;
      bottom: 18px;
      right: 18px;
      z-index: 999;
      display: flex;
      flex-direction: column-reverse;
      gap: 10px;
      max-width: min(360px, calc(100vw - 36px));
    }
    .tcg-toast {
      position: relative;
      background: #15171b;
      border: 1px solid ${colors.bg};
      border-left: 4px solid ${colors.bg};
      border-radius: 10px;
      padding: 12px 34px 12px 14px;
      box-shadow: 0 12px 32px rgba(0,0,0,.45);
      font-family: Archivo, system-ui, sans-serif;
      color: #eef1f4;
      animation: tcg-toast-in .25s ease-out;
    }
    @keyframes tcg-toast-in { from { transform: translateY(8px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
    .tcg-toast a { color: inherit; text-decoration: none; display: block; }
    .tcg-toast a:hover .tcg-toast-title { text-decoration: underline; }
    .tcg-toast-top {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-family: 'Roboto Mono', monospace;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .04em;
      color: ${colors.bg};
    }
    .tcg-toast-title { font-size: 13px; font-weight: 600; line-height: 1.35; }
    .tcg-toast-close {
      position: absolute;
      top: 8px;
      right: 8px;
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      color: rgba(238,241,244,.5);
      font-size: 16px;
      line-height: 1;
      cursor: pointer;
      border-radius: 50%;
    }
    .tcg-toast-close:hover { background: rgba(255,255,255,.08); color: #eef1f4; }
  `;

  function injectStyle() {
    if (document.getElementById('tcg-urgent-style')) return;
    const style = document.createElement('style');
    style.id = 'tcg-urgent-style';
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  function timeAgo(iso) {
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.round(diffMin / 60)}h ago`;
  }

  function kindGlyph(kind) {
    if (kind === 'restock') return '🟢';
    if (kind === 'good_price') return '💰';
    if (kind === 'drawing_open') return '🎟️';
    if (kind === 'headsup') return '❓';
    return '🔔';
  }

  let wrap = null;

  function stickyHost() {
    return document.querySelector('[data-tcg-sticky-header]') || document.body;
  }

  function render(events) {
    if (!events.length) {
      if (wrap) wrap.remove();
      wrap = null;
      return;
    }
    if (!wrap) {
      injectStyle();
      wrap = document.createElement('div');
      wrap.className = 'tcg-urgent-wrap';
      const track = document.createElement('div');
      track.className = 'tcg-urgent-track';
      wrap.appendChild(track);
      const host = stickyHost();
      host.insertBefore(wrap, host.firstChild);
    }
    const track = wrap.querySelector('.tcg-urgent-track');
    track.innerHTML = '';
    // Looped twice back-to-back (same trick the decorative ticker uses)
    // so the marquee animation can scroll seamlessly without a visible
    // jump/reset.
    for (let lap = 0; lap < 2; lap++) {
      for (const ev of events) {
        const item = document.createElement(ev.url ? 'a' : 'span');
        item.className = 'tcg-urgent-item';
        if (ev.url) { item.href = ev.url; item.target = '_blank'; item.rel = 'noopener noreferrer'; }
        const unconfirmed = ev.confirmed ? '' : '<span class="tcg-urgent-unconfirmed">UNCONFIRMED</span> ';
        item.innerHTML = `<span class="tcg-urgent-dot"></span><span>${kindGlyph(ev.kind)} ${unconfirmed}${ev.message}</span><span class="tcg-urgent-time">${timeAgo(ev.created_at)}</span>`;
        track.appendChild(item);
      }
    }
  }

  let toastStack = null;
  function toastHost() {
    if (!toastStack) {
      injectStyle();
      toastStack = document.createElement('div');
      toastStack.className = 'tcg-toast-stack';
      document.body.appendChild(toastStack);
    }
    return toastStack;
  }

  function showToast(ev) {
    const toast = document.createElement('div');
    toast.className = 'tcg-toast';
    const inner = document.createElement(ev.url ? 'a' : 'div');
    if (ev.url) { inner.href = ev.url; inner.target = '_blank'; inner.rel = 'noopener noreferrer'; }
    inner.innerHTML = `
      <div class="tcg-toast-top">${kindGlyph(ev.kind)} ${ev.confirmed ? 'NEW' : 'NEW · UNCONFIRMED'}</div>
      <div class="tcg-toast-title">${ev.message}</div>
    `;
    toast.appendChild(inner);
    const close = document.createElement('button');
    close.className = 'tcg-toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', () => toast.remove());
    toast.appendChild(close);
    toastHost().appendChild(toast);
  }

  // Set of "<table>-<id>" strings already shown, so a poll that sees the
  // same row twice doesn't toast it twice. null on the very first load —
  // that first batch is just "what's already here," not "new," so it
  // populates this set silently without toasting anything.
  let seenKeys = null;

  async function load() {
    try {
      const [eventsRes, headsUpRes] = await Promise.all([
        fetch('/api/events?limit=5'),
        fetch('/api/heads-up?limit=5'),
      ]);
      const events = eventsRes.ok ? await eventsRes.json() : [];
      const headsUp = headsUpRes.ok ? await headsUpRes.json() : [];
      const normalized = [
        ...(events || []).map((ev) => ({
          key: `event-${ev.id}`, message: ev.message, url: ev.url, created_at: ev.created_at, kind: ev.kind, confirmed: true,
        })),
        ...(headsUp || []).map((ev) => ({
          key: `headsup-${ev.id}`, message: ev.title, url: ev.url, created_at: ev.discovered_at, kind: 'headsup', confirmed: false,
        })),
      ];
      const fresh = normalized
        .filter((ev) => ev.created_at && Date.now() - new Date(ev.created_at).getTime() < FRESH_MS)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 6);
      render(fresh);

      const currentKeys = new Set(normalized.map((ev) => ev.key));
      if (seenKeys) {
        for (const ev of normalized) {
          if (!seenKeys.has(ev.key)) showToast(ev);
        }
      }
      seenKeys = currentKeys;
    } catch (err) {
      console.error('[urgent-ticker] load failed', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    setInterval(load, REFRESH_MS);
  });
})();
