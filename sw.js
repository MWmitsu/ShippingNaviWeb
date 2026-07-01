/* Service Worker — network-first（更新を確実に届ける） */
const CACHE = 'shipping-navi-v14';
const CORE = [
  './',
  './index.html',
  './css/styles.css?v=14',
  './js/app.js?v=14',
  './js/engine.js?v=14',
  './js/data/methods.js?v=14',
  './js/sw-register.js?v=14',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // 同一オリジンのみ扱う（Google Analytics・楽天画像などのクロスオリジンはSWを素通り）
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'reload' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
  );
});
