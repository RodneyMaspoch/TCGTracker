// sw.js — service worker: makes the app installable, caches the app shell
// for offline load, and is what actually receives push events (this is
// the piece that lets a notification arrive even if the app is closed).

const CACHE = 'tcgtracker-shell-v1';
const SHELL_FILES = ['/', '/index.html', '/app.js', '/styles.css', '/manifest.json'];

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

// Network-first for API calls (always want fresh data), cache-first for
// the static app shell (fast load, works offline for the UI itself).
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // let it hit the network directly
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
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
