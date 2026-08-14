/**
 * Yomu Service Worker — offline-first shell + offline reading
 *
 * Strategy:
 *  - App shell (HTML/CSS/JS/icons): stale-while-revalidate so the app opens
 *    instantly offline and still picks up updates.
 *  - Book catalog + bundled novels: cache-first; added on demand the first
 *    time they are fetched (downloaded books also live in IndexedDB, this
 *    keeps the raw JSON available too).
 *  - Anything else (cross-origin, non-GET): network only.
 */
const CACHE = 'yomu-v8';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/dict.js',
  './js/wordbook.js',
  './js/stats.js',
  './js/bookmarks.js',
  './js/fonts.js',
  './js/storage.js',
  './js/tokenizer.js',
  './js/aozora.js',
  './js/reader.js',
  './libs/kuromoji.js',
  './assets/app_icon.svg',
  './assets/app_icon.png',
  './data/books.json',
  './data/version.json',
  './data/aozora_catalog_preview.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch GitHub raw / cross-origin

  // App navigation: serve cached shell first when offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  const isBookData = url.pathname.startsWith(self.location.pathname.replace(/sw\.js$/, '') + 'data/');

  if (isBookData) {
    // Cache-first for catalogs and novels
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  // Shell assets: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
