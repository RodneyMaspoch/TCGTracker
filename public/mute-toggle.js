// mute-toggle.js — 2026-10-14
//
// Per-product "don't notify me about this one" toggle (POST
// /api/admin/set-muted). This is the user's own counter-proposal to a
// backend restock-cooldown: rather than debounce every product's repeat
// alerts (which risks swallowing a genuine second restock), let the user
// turn off alerts for a SPECIFIC product they don't care about — e.g.
// "I don't want to hear about Pokemon Pitch Black restocks" — while
// everything else keeps alerting at full fidelity. Muting never stops
// polling that product and never hides its past/future events from the
// full notification-history page (notifications.html) — it only stops
// the OS push + in-app toast/ticker/badge for it. See
// worker/migrations/0008_product_muted.sql for the full reasoning.
//
// Shared DOM builder so every card renderer (pokemon-app.js,
// nintendo-app.js, index.html/lorcana.html's template) gets the same
// button/behavior instead of four slightly-different copies.
(function (global) {
  'use strict';

  // product: the product object as returned by /api/products (has `id`
  // and `muted` — `muted` comes straight from the DB column, 0 or 1).
  // onChange(newMutedBool): optional callback once the server confirms.
  function buildMuteButton(product, onChange) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const setLabel = (muted) => {
      btn.textContent = muted ? '🔕 Muted — tap to unmute' : '🔔 Mute this product’s alerts';
      btn.className = 'tcg-mute-btn' + (muted ? ' is-muted' : '');
    };
    let muted = !!product.muted;
    setLabel(muted);
    btn.addEventListener('click', async () => {
      const next = !muted;
      btn.disabled = true;
      try {
        const res = await fetch('/api/admin/set-muted', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product_id: product.id, muted: next }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        muted = next;
        setLabel(muted);
        if (onChange) onChange(muted);
      } catch (err) {
        console.error('[mute-toggle] failed to update', err);
      } finally {
        btn.disabled = false;
      }
    });
    return btn;
  }

  global.TCGMuteToggle = { buildMuteButton };
})(window);
