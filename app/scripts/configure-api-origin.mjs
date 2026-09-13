import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function normalizeApiOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('voyage_api_origin_required');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('voyage_api_origin_invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('voyage_api_origin_invalid');
  }
  return url.origin;
}

export function configureApiOriginHtml(html, apiOrigin) {
  const origin = normalizeApiOrigin(apiOrigin);
  const marker = /<meta\s+name=["']voyage-api-origin["']\s+content=["'][^"']*["']\s*\/?>/i;
  if (!marker.test(html)) throw new Error('voyage_api_origin_meta_missing');
  return html.replace(marker, `<meta name="voyage-api-origin" content="${origin}" />`);
}

async function main() {
  const target = fileURLToPath(new URL('../www/index.html', import.meta.url));
  const html = await readFile(target, 'utf8');
  const configured = configureApiOriginHtml(html, process.env.VOYAGE_API_ORIGIN);
  await writeFile(target, configured, 'utf8');
  console.log(`Configured packaged Voyage API origin: ${normalizeApiOrigin(process.env.VOYAGE_API_ORIGIN)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  });
}
