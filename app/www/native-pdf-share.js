queueMicrotask(() => installNativePdfShare().catch(() => {}));

const SHARED_PDF_CACHE = 'voyage-shared-pdf-v1';
const SHARED_PDF_PREFIX = '/__voyage_shared_pdf__/';
const SHARED_PDF_TTL_MS = 30 * 60 * 1000;

async function installNativePdfShare() {
  await consumeNativePdfShare();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) consumeNativePdfShare().catch(() => {});
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'VOYAGE_PDF_SHARE_READY') consumeWebShareTarget(event.data.shareId).catch(() => {});
    });
  }

  await consumeWebShareTarget();
}

async function consumeNativePdfShare() {
  const plugin = window.Capacitor?.Plugins?.VoyagePdfShare;
  if (!plugin?.consumeSharedPdf) return false;

  const shared = await plugin.consumeSharedPdf().catch(() => null);
  if (!shared?.available || !shared.base64) return false;

  const bytes = base64ToUint8Array(shared.base64);
  const file = new File([bytes], safePdfName(shared.name), { type: 'application/pdf' });
  return dispatchPdfToUniversalImporter(file, 'ANDROID_SHARE');
}

async function consumeWebShareTarget(explicitShareId = null) {
  const url = new URL(window.location.href);
  const shareId = explicitShareId || url.searchParams.get('share');
  if (url.searchParams.get('shared') !== 'pdf' && !shareId) return false;

  const cache = await caches.open(SHARED_PDF_CACHE);
  await purgeExpiredSharedPdfs(cache);
  const match = shareId ? await getSharedPdfById(cache, shareId) : await getNewestSharedPdf(cache);
  if (!match) return false;

  const { key, response } = match;
  const blob = await response.blob();
  const name = response.headers.get('x-voyage-filename') || 'documento.pdf';
  await cache.delete(key);
  url.searchParams.delete('shared');
  url.searchParams.delete('share');
  history.replaceState({}, '', url.pathname + url.search + url.hash);
  const file = new File([blob], safePdfName(name), { type: 'application/pdf' });
  return dispatchPdfToUniversalImporter(file, 'PWA_SHARE_TARGET');
}

async function getSharedPdfById(cache, shareId) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(shareId || ''))) return null;
  const key = `${SHARED_PDF_PREFIX}${shareId}`;
  const response = await cache.match(key);
  return response ? { key, response } : null;
}

async function getNewestSharedPdf(cache) {
  let newest = null;
  for (const request of await cache.keys()) {
    const parsed = new URL(request.url);
    if (!parsed.pathname.startsWith(SHARED_PDF_PREFIX)) continue;
    const response = await cache.match(request);
    const sharedAt = Number(response?.headers.get('x-voyage-shared-at') || 0);
    if (!response || !sharedAt) continue;
    if (!newest || sharedAt > newest.sharedAt) newest = { key: request, response, sharedAt };
  }
  return newest;
}

async function purgeExpiredSharedPdfs(cache) {
  const now = Date.now();
  for (const request of await cache.keys()) {
    const parsed = new URL(request.url);
    if (!parsed.pathname.startsWith(SHARED_PDF_PREFIX)) continue;
    const response = await cache.match(request);
    const sharedAt = Number(response?.headers.get('x-voyage-shared-at') || 0);
    if (!sharedAt || now - sharedAt > SHARED_PDF_TTL_MS) await cache.delete(request);
  }
}

async function dispatchPdfToUniversalImporter(file, sourceMode) {
  const input = await waitForImportInput();
  if (!input) return false;

  const transfer = new DataTransfer();
  transfer.items.add(file);
  try {
    input.files = transfer.files;
  } catch {
    Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  }
  input.dataset.sourceMode = sourceMode;
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  // Never leave an own frozen files property behind. Manual selection must keep
  // using the browser's HTMLInputElement files getter after a shared import.
  queueMicrotask(() => {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(input, 'files');
      if (descriptor?.configurable) delete input.files;
      input.value = '';
    } catch {}
  });

  const importScreen = document.querySelector('[data-screen="imports"]');
  if (importScreen) {
    document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('screen--active'));
    importScreen.classList.add('screen--active');
  }
  return true;
}

async function waitForImportInput() {
  for (let i = 0; i < 40; i += 1) {
    const input = document.querySelector('[data-import-files]');
    if (input) return input;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function safePdfName(value) {
  const cleaned = String(value || 'documento.pdf').replace(/[\\/\0\r\n]/g, '_').slice(0, 160);
  return cleaned.toLowerCase().endsWith('.pdf') ? cleaned : `${cleaned || 'documento'}.pdf`;
}
