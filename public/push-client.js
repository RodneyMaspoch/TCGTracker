// push-client.js — shared "Enable alerts" push-subscribe control, used by
// index.html (MTG), lorcana.html, and pokemon.html so this logic lives in
// ONE place instead of being copy-pasted three times. Renders a small
// fixed-position pill button, independent of each page's own template
// engine (runtime.js) — this way it can't be broken by, or interfere
// with, the game-specific hero/card rendering on each page.
//
// Why a fixed floating button instead of wiring into each page's own nav:
// index.html/lorcana.html's header controls (search, hamburger menu) are
// rendered by runtime.js from a <template>, re-created on every state
// change (e.g. opening/closing the menu). Attaching this to a node inside
// that template risks it vanishing or double-binding on re-render. A
// plain element appended once, outside that template's root, sidesteps
// that entirely — same reasoning pwa-boot.js already uses for the service
// worker registration.
//
// NOTE ON TESTING IN INCOGNITO: Chrome restricts/auto-denies the
// Notification permission prompt in Incognito windows by default, often
// silently (no visible prompt, no error). If clicking this button seems
// to do nothing, try a normal window first before assuming it's broken.

(function () {
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  const btn = document.createElement('button');
  btn.id = 'tcg-push-btn';
  btn.type = 'button';
  btn.textContent = 'Enable alerts';
  Object.assign(btn.style, {
    position: 'fixed',
    top: '18px',
    right: '18px',
    zIndex: '90',
    border: 'none',
    borderRadius: '999px',
    padding: '10px 18px',
    fontFamily: 'Archivo, sans-serif',
    fontWeight: '800',
    fontSize: '13px',
    cursor: 'pointer',
    background: 'var(--tcg-push-accent, #b0ff36)',
    color: 'var(--tcg-push-accent-ink, #14210a)',
    boxShadow: '0 8px 24px rgba(0,0,0,.35)',
  });

  function setState(stateName, label) {
    btn.dataset.state = stateName;
    btn.textContent = label;
    if (stateName === 'on') {
      btn.style.background = 'transparent';
      btn.style.color = 'var(--tcg-push-accent, #b0ff36)';
      btn.style.border = '1px solid var(--tcg-push-accent, #b0ff36)';
    } else {
      btn.style.background = 'var(--tcg-push-accent, #b0ff36)';
      btn.style.color = 'var(--tcg-push-accent-ink, #14210a)';
      btn.style.border = 'none';
    }
  }

  async function refresh() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported', 'Alerts unsupported');
      btn.disabled = true;
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? 'on' : 'off', sub ? '✓ Alerts on' : 'Enable alerts');
    } catch (_) {
      setState('off', 'Enable alerts');
    }
  }

  async function subscribe() {
    const keyRes = await fetch('/api/push/public-key').then((r) => r.json());
    if (!keyRes.configured || !keyRes.publicKey) {
      alert("Push isn't configured on the server yet (missing VAPID keys).");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      setState('off', 'Enable alerts');
      if (permission === 'denied') {
        console.warn('[push-client] Notification permission was denied (or auto-denied — this happens silently in Incognito windows).');
      }
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyRes.publicKey),
    });
    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub),
    });
    setState('on', '✓ Alerts on');
  }

  async function unsubscribe() {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
    setState('off', 'Enable alerts');
  }

  btn.addEventListener('click', async () => {
    if (btn.disabled) return;
    try {
      if (btn.dataset.state === 'on') await unsubscribe();
      else await subscribe();
    } catch (err) {
      console.error('[push-client] toggle failed', err);
      alert('Something went wrong enabling alerts. Check the browser console for details.');
    }
  });

  document.addEventListener('DOMContentLoaded', () => {
    document.body.appendChild(btn);
    refresh();
  });
})();
