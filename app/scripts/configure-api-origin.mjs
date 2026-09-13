import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const indexPath = fileURLToPath(new URL('../www/index.html', import.meta.url));

export function normalizeApiOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('voyage_api_origin_required');

  let url;
  try { url = new URL(value.trim()); }
  catch { throw new Error('voyage_api_origin_invalid'); }

  if (url.protocol !== 'https:') throw new Error('voyage_api_origin_https_required');
  if (url.username || url.password) throw new Error('voyage_api_origin_credentials_forbidden');
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error('voyage_api_origin_must_be_origin_only');
  }
  return url.origin;
}

export function injectApiOriginHtml(html, origin) {
  const marker = /(<meta\s+name=["']voyage-api-origin["']\s+content=["'])[^"']*(["']\s*\/?>)/i;
  if (!marker.test(html)) throw new Error('voyage_api_origin_meta_missing');
  return html.replace(marker, `$1${origin}$2`);
}

export async function configurePackagedApiOrigin({ value = process.env.VOYAGE_API_ORIGIN, path = indexPath } = {}) {
  const origin = normalizeApiOrigin(value);
  const html = await readFile(path, 'utf8');
  const updated = injectApiOriginHtml(html, origin);
  await writeFile(path, updated, 'utf8');
  return origin;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  configurePackagedApiOrigin()
    .then((origin) => console.log(`Configured packaged Voyage API origin: ${origin}`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
