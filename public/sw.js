/**
 * ReelForge service worker — offline shell.
 * Media files are never cached: only the app itself.
 *
 * Update strategy: navigations (the HTML shell) are network-first so a freshly
 * published build wins as soon as the phone is online; hashed assets keep the
 * cache-first + background-refresh path. The page can also ask for the new
 * worker to take over right away via `postMessage({ type: 'SKIP_WAITING' })`.
 */
const VERSION = 'reelforge-v2';
const CORE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(CORE.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // never touch blob: media or API-ish requests
  if (url.pathname.includes('/audio/') || url.hostname.includes('api.')) return;

  // the app shell: always try the network first, fall back to the cached copy offline
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith((async () => {
      try {
        const res = await fetch(request);
        if (res && res.ok && res.type === 'basic') {
          const cache = await caches.open(VERSION);
          cache.put(request, res.clone()).catch(() => {});
        }
        return res;
      } catch {
        return (await caches.match(request, { ignoreSearch: true }))
          || (await caches.match('./index.html'))
          || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then((res) => {
        if (res && res.ok && res.type === 'basic') cache.put(request, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => cached || Response.error());
    return cached || network;
  })());
});
