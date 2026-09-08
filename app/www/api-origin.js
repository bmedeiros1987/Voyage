/**
 * Single owner of where the Voyage clients send API requests.
 *
 * Browser sessions are always same-origin. A packaged Capacitor shell is the
 * only client allowed to honor the build-time voyage-api-origin meta tag,
 * because its local origin (https://localhost or capacitor://localhost) does
 * not host the Voyage API. Runtime-writable state (query params, storage,
 * user input) is never trusted as an API destination.
 */
const API_ORIGIN = resolveTrustedApiOrigin({
  configured: document.querySelector('meta[name="voyage-api-origin"]')?.getAttribute('content')?.trim(),
  pageOrigin: globalThis.location?.origin || ''
});

const CAPACITOR_SHELL_ORIGINS = new Set([
  'https://localhost',
  'capacitor://localhost'
]);

export function resolveTrustedApiOrigin({ configured, pageOrigin } = {}) {
  const currentOrigin = String(pageOrigin || '').trim().toLowerCase();
  if (!CAPACITOR_SHELL_ORIGINS.has(currentOrigin)) return '';
  if (typeof configured !== 'string' || !configured.trim()) return '';

  try {
    const url = new URL(configured.trim());
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
    if (url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function apiUrl(path) {
  const suffix = typeof path === 'string' && path.startsWith('/') ? path : `/${String(path ?? '')}`;
  return `${API_ORIGIN}${suffix}`;
}

export function fetchApi(path, options = {}) {
  return fetch(apiUrl(path), options);
}

export { API_ORIGIN };
