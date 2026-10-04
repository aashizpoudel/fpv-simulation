// FPV Sim Service Worker
const CACHE_NAME = 'fpv-sim-v1';

// Core shell assets to precache immediately on install
const PRECACHE_ASSETS = [
  './',
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignore non-http(s) schemes (e.g. chrome-extension, data:)
  if (!url.protocol.startsWith('http')) return;

  // Let browser handle Range requests directly without caching partial content (HTTP 206)
  if (request.headers.has('range')) return;

  // HTML navigation requests: Network-first, fall back to cached shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          return caches.match('./');
        })
    );
    return;
  }

  // Large binary assets: Cache-first without background re-fetching to save bandwidth and GPU/CPU performance
  const isLargeBinary = /\.(glb|splat|ksplat|gz|bin|wasm)($|\?)/i.test(url.pathname);

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        if (!isLargeBinary) {
          // Stale-while-revalidate only for light UI assets
          fetch(request)
            .then((networkResponse) => {
              if (networkResponse && networkResponse.status === 200) {
                const clone = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
              }
            })
            .catch(() => {
              /* Offline; ignore background refresh failure */
            });
        }
        return cachedResponse;
      }

      // If not in cache, fetch from network and store full 200 OK responses
      return fetch(request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type === 'opaque') {
          return networkResponse;
        }

        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseToCache);
        });

        return networkResponse;
      });
    })
  );
});
