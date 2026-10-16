/**
 * ReelForge service worker — offline shell.
 * Media files are never cached: only the app itself.
 */
const VERSION = 'reelforge-v1';
const CORE = ['./', './index.html', './manifest.webmanifest'];

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
