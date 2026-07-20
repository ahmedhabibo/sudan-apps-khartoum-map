/**
 * sw.js — Service Worker for KhartoumMap PWA
 *
 * Strategy:
 * - Workbox 6.x via importScripts from CDN (cached offline after first install)
 * - Precache: app shell + Leaflet + Dexie + services JSON data
 * - Runtime: NetworkFirst for navigations, CacheFirst for map tiles,
 *   StaleWhileRevalidate for static assets
 *
 * Compatibility: Android Chrome 7+ (importScripts classic syntax, no ES modules in SW)
 */

const WORKBOX_CDN = "https://unpkg.com/workbox-sw@6.6.0/build/workbox-sw.js";
const DEXIE_CDN = "https://unpkg.com/dexie@3.2.7/dist/dexie.min.js";
const LEAFLET_JS_CDN = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS_CDN = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

// ---------------------------------------------------------------------------
// Self-contained SW boot — fall back to minimal cache strategy if Workbox fails
// ---------------------------------------------------------------------------

importScripts(WORKBOX_CDN);

if (typeof workbox !== "undefined") {
  // --- Workbox available path ---

  const precacheFiles = [
    { url: "./", revision: "v1" },
    { url: "./index.html", revision: "v5" },
    { url: "./styles.css", revision: "v4" },
    { url: "./db.js", revision: "v4" },
    { url: "./app.js", revision: "v5" },
    { url: "./config.js", revision: "v5" },
    { url: "./manifest.json", revision: "v1" },
    { url: "./data/services_khartoum.json", revision: "v1" },
    { url: DEXIE_CDN, revision: null },
    { url: WORKBOX_CDN, revision: null },
    { url: LEAFLET_JS_CDN, revision: null },
    { url: LEAFLET_CSS_CDN, revision: null }
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil(
      (async () => {
        // Precache app shell
        await workbox.precaching.precacheAndRoute(precacheFiles);
        // Pre-cache external libs in a separate cache
        try {
          const cache = await caches.open("khartoum-map-external");
          await Promise.all([
            cache.add(DEXIE_CDN),
            cache.add(WORKBOX_CDN),
            cache.add(LEAFLET_JS_CDN),
            cache.add(LEAFLET_CSS_CDN)
          ]);
        } catch (e) {
          console.warn("SW install: could not precache external CDNs now", e);
        }
      })()
    );
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

  // --- Runtime caching strategies ---

  // Navigations (HTML page loads): NetworkFirst with offline fallback
  workbox.routing.registerRoute(
    ({ request }) => request.mode === "navigate",
    new workbox.strategies.NetworkFirst({
      cacheName: "khartoum-pages",
      networkTimeoutSeconds: 5,
      plugins: [
        new workbox.cacheable_response.CacheableResponsePlugin({ statuses: [200] })
      ]
    })
  );

  // Static assets (CSS, JS, JSON): StaleWhileRevalidate
  workbox.routing.registerRoute(
    ({ request }) =>
      request.destination === "style" ||
      request.destination === "script" ||
      request.destination === "manifest",
    new workbox.strategies.StaleWhileRevalidate({
      cacheName: "khartoum-static"
    })
  );

  // External CDN libs (Dexie, Leaflet): CacheFirst, long-lived
  workbox.routing.registerRoute(
    ({ url }) => url.origin === "https://unpkg.com",
    new workbox.strategies.CacheFirst({
      cacheName: "khartoum-external",
      plugins: [
        new workbox.cacheable_response.CacheableResponsePlugin({ statuses: [200] }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 10,
          maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
        })
      ]
    })
  );

  // OSM Map tiles: CacheFirst with expiration (allows offline map viewing)
  workbox.routing.registerRoute(
    ({ url }) => url.origin === "https://tile.openstreetmap.org" || 
                   url.origin === "https://a.tile.openstreetmap.org" ||
                   url.origin === "https://b.tile.openstreetmap.org" ||
                   url.origin === "https://c.tile.openstreetmap.org",
    new workbox.strategies.CacheFirst({
      cacheName: "khartoum-tiles",
      plugins: [
        new workbox.cacheable_response.CacheableResponsePlugin({ statuses: [200] }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 500,
          maxAgeSeconds: 60 * 60 * 24 * 90 // 90 days
        })
      ]
    })
  );

  // Images: CacheFirst with expiration
  workbox.routing.registerRoute(
    ({ request }) => request.destination === "image",
    new workbox.strategies.CacheFirst({
      cacheName: "khartoum-images",
      plugins: [
        new workbox.cacheable_response.CacheableResponsePlugin({ statuses: [200] }),
        new workbox.expiration.ExpirationPlugin({
          maxEntries: 50,
          maxAgeSeconds: 60 * 60 * 24 * 90
        })
      ]
    })
  );

  // --- Message handler: skipWaiting on UPDATE message ---
  self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });

} else {
  // --- Minimal fallback SW (Workbox failed to load) ---

  const FALLBACK_CACHE = "khartoum-map-fallback";

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches.open(FALLBACK_CACHE).then((cache) =>
        cache.addAll([
          "./",
          "./index.html",
          "./styles.css",
          "./db.js",
          "./app.js",
          "./manifest.json",
          "./data/services_khartoum.json"
        ]).catch(() => undefined)
      )
    );
    self.skipWaiting();
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET") return;
    
    // Cache-first for same-origin, network-first for tiles
    if (event.request.url.includes("tile.openstreetmap.org")) {
      event.respondWith(
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          return fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open("khartoum-tiles-fallback").then((cache) =>
                cache.put(event.request, clone)
              );
            }
            return response;
          }).catch(() => caches.match("./index.html"));
        })
      );
      return;
    }

    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request)
          .then((response) => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(FALLBACK_CACHE).then((cache) => cache.put(event.request, clone));
            }
            return response;
          })
          .catch(() => caches.match("./index.html"));
      })
    );
  });

  self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
      self.skipWaiting();
    }
  });
}
