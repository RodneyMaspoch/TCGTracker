// push-client.js — shared push-subscribe logic, used by index.html (MTG),
// lorcana.html, and pokemon.html so it lives in ONE place instead of
// being copy-pasted three times.
//
// Used to also render a permanent floating "Enable alerts" pill button —
// removed per explicit feedback that arming any price alert should be
// what turns push on, not a separate always-visible button/indicator
// sitting on top of the header. The subscribe/unsubscribe/state logic
// below is unchanged and still works exactly the same; it's just not
// wired to a visible button anymore. It's triggered instead by
// window.tcgEnsurePushEnabled(), called from each page's own "Add
// Alert"/"Arm"/"Arm All" handlers (see pokemon-app.js, index.html,
// lorcana.html).
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

  // No longer appended to the page — arming an alert (see
  // tcgEnsurePushEnabled below) is now the thing that turns push on, so a
  // permanently-visible floating "Enable alerts"/"Alerts on" pill sitting
  // on top of the header all the time is redundant UI, not a needed
  // control. `btn` is kept (in memory only) purely because subscribe()/
  // unsubscribe()/setState() below still read and write its properties —
  // refresh() still runs so that internal state is correct the moment
  // tcgEnsurePushEnabled is first called.
  document.addEventListener('DOMContentLoaded', () => {
    refresh();
  });

  // Exposed so an "Add Alert"/"Arm" button elsewhere on the page can
  // piggyback on this same subscribe flow instead of making the person
  // find and click "Enable alerts" separately — per explicit ask:
  // arming a price alert should be the thing that turns push on, not a
  // second, easy-to-miss step. Browsers still require the permission
  // prompt to come from a real user gesture (a click), so this can't be
  // silent — it just means the Add Alert button's own click is what
  // triggers it, instead of a dedicated button. Safe to call repeatedly:
  // no-ops once already subscribed.
  window.tcgEnsurePushEnabled = async function () {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return true;
      await subscribe();
      return btn.dataset.state === 'on';
    } catch (err) {
      console.error('[push-client] tcgEnsurePushEnabled failed', err);
      return false;
    }
  };
})();
