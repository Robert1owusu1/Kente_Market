/* FILE LOCATION: public/sw.js
 * DESCRIPTION: Offline-first service worker for resilience on slow / flaky
 *              connections. Keeps the app shell and last-good API JSON so the
 *              store keeps working (with cached data) when the network drops.
 *
 * Strategies:
 *  - Precache the app shell (/, /index.html) on install.
 *  - Hashed, fingerprinted build assets (JS/CSS in /assets/*) are IMMUTABLE:
 *    cache-first, network never needed on repeat visits.
 *  - Same-origin GET /api/* -> network-first, fall back to the last cached
 *    response headers. Never touches mutations (they must reach the server).
 *  - Images/fonts -> cache-first with a size cap (offline photos).
 */

const SHELL = ['/', '/index.html'];
const API_PREFIX = '/api/';
// Cache versions; bump APP_API_KEY when the API shape changes so stale lists
// (e.g. pre-wipe product catalogs) are purged on the next SW update.
const APP_API_KEY = 'app-api-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open('app-shell-v1').then((cache) =>
      // best-effort precache; failures are non-fatal
      Promise.allSettled(
        SHELL.map((url) => fetch(url, { cache: 'no-cache' }).then((r) => {
          if (r && r.ok) cache.put(url, r);
        }))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Drop every app cache from earlier versions. Old cached API JSON may
  // reference data that no longer exists (e.g. after a data wipe).
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith('app-')).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

// Fresh immutable build assets
const isHashedAsset = (url) => /\/assets\/.+\.(js|css)$/.test(url.pathname);
const isApiGet = (req) =>
  req.method === 'GET' && req.url && req.url.includes(API_PREFIX) && !isHashedAsset(req.url);

self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Only handle GET; every mutation must reach the server.
  if (req.method !== 'GET') return;

  // Cross-origin (fonts, images CDNs): let the browser handle it, but we may
  // cache opaque responses opportunistically below for same-origin only.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Uploaded media (/uploads/*) lives on the API origin and must be fetched
  // through the network (Vercel proxies it). Never cache or intercept it —
  // cached copies can reference wiped files and crash the page.
  if (url.pathname.startsWith('/uploads')) return;

  // 1) Hashed build assets -> cache-first (immutable).
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open('app-assets-v1').then((c) => c.put(req, copy));
        return res;
      }))
    );
    return;
  }

  // 2) API GET -> network-first, fall back to stale cache when offline/flaky.
  if (isApiGet(req)) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && (res.ok || res.status === 304)) {
            const copy = res.clone();
            caches.open(APP_API_KEY).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => {
            if (cached && cached.ok) {
              // Serve stale data with a header so the UI could show it.
              const headers = new Headers(cached.headers);
              headers.set('X-Served-From', 'service-worker-cache');
              return new Response(cached.body, { status: 200, headers });
            }
            return new Response(
              JSON.stringify({ message: 'You appear to be offline. Showing the latest saved copy is unavailable for this request.' }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          })
        )
    );
    return;
  }

  // 3) App shell (/, /index.html, and other same-origin GETs)
  // Network-first so we always get fresh HTML/assets, fall back to cached shell.
  // Always resolves to a real Response so respondWith never throws.
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open('app-shell-v1').then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true }).then((cached) =>
          cached ||
          caches.match('/').then(
            (shell) =>
              shell ||
              new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          )
        )
      )
  );
});