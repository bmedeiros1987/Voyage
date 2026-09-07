const CACHE = 'voyage-shell-v6-pdf-share';
const SHARED_PDF_CACHE = 'voyage-shared-pdf-v1';
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
  './native-pdf-share.js',
  './manifest.webmanifest'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== SHARED_PDF_CACHE).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname.endsWith('/share-pdf')) {
    event.respondWith(handlePdfShareTarget(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).catch(() => caches.match('./index.html')))
  );
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
  await cache.put('/__voyage_shared_pdf__', new Response(file, {
    headers: {
      'content-type': 'application/pdf',
      'x-voyage-filename': file.name || 'documento.pdf'
    }
  }));

  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: 'VOYAGE_PDF_SHARE_READY' }));
  return Response.redirect('./?shared=pdf', 303);
}
