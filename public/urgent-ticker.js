// urgent-ticker.js — a single cross-game "something just happened" bar,
// shown at the very top of EVERY page (MTG, Lorcana, Pokémon, Heads Up),
// above the ticker/hero/header/everything else. Explicit ask: "I need to
// know Pokémon Center is ready for a drop so I can get there IMMEDIATELY
// no matter what page I'm on" — a restock on the Pokémon page shouldn't
// only be visible to someone who happens to already be on that page.
//
// Pulls from /api/events (confirmed restock/good-price/drawing events —
// NOT the heads_up "unconfirmed" tier), which already covers all three
// games (the fast lane checks Pokémon listings, the slow lane checks
// MTG+Lorcana), so no backend change is needed to make this cross-game.
//
// Only shows events from the last FRESH_MS — an event from 3 days ago
// isn't "immediate," it's stale, and showing it permanently would just
// be clutter contradicting the "most important thing" framing. When
// nothing qualifies, this renders nothing at all (no empty bar).
//
// FULLY SELF-CONTAINED ON PURPOSE: index.html/lorcana.html never link
// public/styles.css at all (they're self-contained pages with their own
// inline <style> blocks) — a first version of this that relied on
// styles.css classes/variables rendered as plain unstyled text there
// (no color, no animation, no hover-pause) even though it "looked okay
// by accident." This version injects its own <style> tag and picks its
// color from document.body.dataset.game directly in JS, so it works
// identically on every page regardless of what that page does or
// doesn't link.

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
      background: ${colors.bg};
      border-bottom: 1px solid rgba(0,0,0,.2);
      padding: 9px 0;
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
    return '🔔';
  }

  let wrap = null;

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
      document.body.insertBefore(wrap, document.body.firstChild);
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
        item.innerHTML = `<span class="tcg-urgent-dot"></span><span>${kindGlyph(ev.kind)} ${ev.message}</span><span class="tcg-urgent-time">${timeAgo(ev.created_at)}</span>`;
        track.appendChild(item);
      }
    }
  }

  async function load() {
    try {
      const res = await fetch('/api/events?limit=5');
      if (!res.ok) return;
      const rows = await res.json();
      const fresh = (rows || []).filter((ev) => Date.now() - new Date(ev.created_at).getTime() < FRESH_MS);
      render(fresh);
    } catch (err) {
      console.error('[urgent-ticker] load failed', err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    load();
    setInterval(load, REFRESH_MS);
  });
})();
