const CACHE = 'voyage-shell-v14-operational';
const SHARED_PDF_CACHE = 'voyage-shared-pdf-v1';
const SHARED_PDF_PREFIX = '/__voyage_shared_pdf__/';
const SHARED_PDF_TTL_MS = 30 * 60 * 1000;
const CORE = [
  './',
  './index.html',
  './launch.html',
  './launch.js',
  './launch.css',
  './styles.css',
  './themes.css',
  './premium-layout.css',
  './premium-overrides.css',
  './signature-experience.css',
  './adaptive-home.css',
  './responsive-hardening.css',
  './imports.css',
  './api-origin.js',
  './api-origin.js?v=operational-1',
  './retention-policy.js',
  './signature-experience.js',
  './adaptive-home.js',
  './app.js',
  './import-enhancements.js',
  './native-pdf-share.js',
  './manifest.webmanifest',
  '../resources/icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter((key) => key !== CACHE && key !== SHARED_PDF_CACHE).map((key) => caches.delete(key)));
    const shared = await caches.open(SHARED_PDF_CACHE);
    await purgeExpiredSharedPdfs(shared);
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname.endsWith('/share-pdf')) {
    event.respondWith(handlePdfShareTarget(event.request));
    return;
  }
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET') return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

async function handlePdfShareTarget(request) {
  const form = await request.formData();
  const file = form.get('pdf');
  if (!(file instanceof File) || file.size === 0 || file.size > 15 * 1024 * 1024) {
    return Response.redirect('./?shared=pdf&error=invalid', 303);
  }

  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...head) !== '%PDF-') {
    return Response.redirect('./?shared=pdf&error=invalid', 303);
  }

  const cache = await caches.open(SHARED_PDF_CACHE);
  await purgeExpiredSharedPdfs(cache);
  const shareId = makeShareId();
  const cacheKey = `${SHARED_PDF_PREFIX}${shareId}`;
  await cache.put(cacheKey, new Response(file, {
    headers: {
      'content-type': 'application/pdf',
      'x-voyage-filename': file.name || 'documento.pdf',
      'x-voyage-shared-at': String(Date.now())
    }
  }));

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'VOYAGE_PDF_SHARE_READY', shareId }));
  return Response.redirect(`./?shared=pdf&share=${encodeURIComponent(shareId)}`, 303);
}

async function purgeExpiredSharedPdfs(cache) {
  const now = Date.now();
  for (const request of await cache.keys()) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(SHARED_PDF_PREFIX)) continue;
    const response = await cache.match(request);
    const sharedAt = Number(response?.headers.get('x-voyage-shared-at') || 0);
    if (!sharedAt || now - sharedAt > SHARED_PDF_TTL_MS) await cache.delete(request);
  }
}

function makeShareId() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  self.crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
