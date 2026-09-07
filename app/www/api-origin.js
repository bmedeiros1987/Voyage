/**
 * Single owner of where the Voyage clients send API requests.
 *
 * Same-origin is the default and the only thing a browser session can reach.
 * A packaged shell — Capacitor serves the bundle from https://localhost, which
 * has no API of its own — declares its API origin in a build-time meta tag that
 * ships inside the bundle. Nothing readable or writable at runtime (storage,
 * query string, a value typed into the page) is trusted, so an XSS, a hostile
 * extension or a DevTools session cannot repoint the API and harvest imports or
 * session bearer tokens.
 */
const API_ORIGIN = resolveTrustedApiOrigin();

function resolveTrustedApiOrigin() {
  const configured = document.querySelector('meta[name="voyage-api-origin"]')?.getAttribute('content')?.trim();
  if (!configured) return '';
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password) return '';
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
