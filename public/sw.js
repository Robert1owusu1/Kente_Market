/* FILE LOCATION: public/sw.js
 * DESCRIPTION: Offline-first service worker for resilience on slow / flaky
 *              connections. Keeps the app shell and last-good API JSON so the
 *              store keeps working (with cached data) when the network drops.
 *
 * Strategies:
 *  - Precache the app shell (/, /index.html) on install.
 *  - Hashed, fingerprinted build assets (JS/CSS in /assets/*) are IMMUTABLE:
 *    cache-first, network never needed on repeat visits.
 *  - PUBLIC, account-agnostic GET /api/* -> network-first, fall back to the
 *    last cached response headers. Only explicitly allow-listed endpoints are
 *    cached (catalog, storefront, promotions, reviews ...). Never touches
 *    mutations (they must reach the server).
 *  - PRIVATE / user-scoped GET /api/* (profile, wallet, orders, vendor
 *    insights ...) is NEVER intercepted or cached — another account on the
 *    same browser must never be served the previous user's cached data.
 *  - Images/fonts -> cache-first with a size cap (offline photos).
 */

const SHELL = ['/', '/index.html'];
const API_PREFIX = '/api/';
// Bump APP_SW_VERSION whenever the app shell, build layout, or API behavior
// changes: sw.js bytes change -> browsers re-download it -> activate drops
// every app-* cache and re-precaches the current shell + assets. Without this,
// cache-first immutable assets keep serving a stale bundle to old SW clients.
const APP_SW_VERSION = 4;
// Cache versions; bump APP_API_KEY when the API shape changes so stale lists
// (e.g. pre-wipe product catalogs) are purged on the next SW update.
const APP_API_KEY = 'app-api-v4';

// PUBLIC, account-agnostic endpoints that are safe to cache. Everything else
// under /api (profile, orders, wallet, vendor tools, admin ...) is passed
// straight to the network and is NEVER placed in (or served from) a cache, so
// logged-out / second-account browsers cannot receive another user's data.
const PUBLIC_API = [
  // [path prefix, exact-match-only?]
  ['/api/products', false],            // list + /:id + category/featured/etc (all public)
  ['/api/vendors/store/', true],       // public storefront
  ['/api/vendors/directory', true],
  ['/api/promotions/public/', true],
  ['/api/categories', true],
  ['/api/reviews', true],              // list only (never /analytics)
  ['/api/reviews/product/', true],
  ['/api/certificates/verify/', true], // token-based public verification
];

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
const isApiPath = (url) => url.pathname.startsWith(API_PREFIX);

// A GET on a PUBLIC allow-listed endpoint whose response is account-agnostic.
const isPublicApiGet = (req, url) =>
  req.method === 'GET' &&
  isApiPath(url) &&
  !isHashedAsset(url) &&
  PUBLIC_API.some(([prefix, exact]) => (exact ? url.pathname === prefix : url.pathname.startsWith(prefix)));

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

  // 2) PUBLIC API GET -> network-first, fall back to stale cache when offline/flaky.
  if (isPublicApiGet(req, url)) {
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

  // PRIVATE / user-scoped API GET: never intercept, never cache — the browser
  // talks to the network directly so the response is always the caller's own.
  if (isApiPath(url)) return;

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