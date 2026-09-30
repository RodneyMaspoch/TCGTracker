// sw.js — service worker: makes the app installable, caches the app shell
// for offline load, and is what actually receives push events (this is
// the piece that lets a notification arrive even if the app is closed).

// v2 — was cache-first for the shell (index.html/app.js/styles.css), which
// meant editing those files on disk had NO visible effect until someone
// manually unregistered the service worker: the browser just kept serving
// whatever it cached the first time it ever loaded the page. That's the
// "I uploaded the new files and nothing changed" bug.
//
// Fixed to network-first: always try the network for the shell files first
// (so an edit shows up on the very next reload), and only fall back to the
// cache if the network is unreachable (offline). Bumping the cache name to
// v2 also forces every previously-installed copy of this service worker to
// throw away its old (possibly stale-forever) cache on next activate.
// v3 — shell file list updated for the real MTG/Lorcana/Pokémon pages
// (index.html, lorcana.html, pokemon.html + their own scripts/styles),
// replacing the old single-page app.js/styles.css. Bumping v2 -> v3 also
// forces any previously-installed service worker to drop its old cache.
// v4 — pokemon.html moved onto the same shared styles.css as index.html/
// lorcana.html (the old pokemon-styles.css was a byte-identical duplicate,
// now removed) and gained push-client.js. cache.addAll fails ENTIRELY if
// any one URL in this list 404s, so a stale filename here breaks install
// for every page, not just Pokémon's — bumping v3 -> v4 too, so anyone
// who installed the old version doesn't keep serving a shell that
// references a file that no longer exists.
// v5 — added the shared Heads Up page (heads-up.html/heads-up-app.js) and
// site-nav.js (the persistent cross-page nav bar index.html/lorcana.html
// were missing entirely). Same "keep this list in sync or cache.addAll
// fails for everyone" reasoning as v4 — bump the version whenever a new
// shell file is added or removed, not just when one is renamed.
const CACHE = 'tcgtracker-shell-v5';
const SHELL_FILES = [
  '/', '/index.html', '/lorcana.html', '/pokemon.html', '/heads-up.html',
  '/runtime.js', '/pwa-boot.js', '/pokemon-app.js', '/heads-up-app.js',
  '/push-client.js', '/site-nav.js', '/styles.css',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // let API calls hit the network directly, untouched

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Keep the cache warm with whatever the network just gave us, so
        // offline fallback (below) stays reasonably fresh too.
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request)) // offline (or dev server down) — serve last-known-good
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'TCGTracker', body: 'Something changed.' };
  try { payload = event.data.json(); } catch (_) { /* keep default */ }
  const options = {
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag || 'tcgtracker',
    data: { url: payload.url || '/' },
    requireInteraction: true, // stays on screen until dismissed — these are time-sensitive
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'TCGTracker', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
