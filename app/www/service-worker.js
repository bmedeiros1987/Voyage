const CACHE = 'voyage-shell-v5-signature';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './themes.css',
  './premium-layout.css',
  './premium-overrides.css',
  './signature-experience.css',
  './imports.css',
  './signature-experience.js',
  './app.js',
  './import-enhancements.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('./index.html')))
  );
});
