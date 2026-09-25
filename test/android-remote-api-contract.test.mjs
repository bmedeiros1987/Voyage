import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectApiOriginHtml, normalizeApiOrigin } from '../app/scripts/configure-api-origin.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

test('packaged API origin accepts only a clean HTTPS origin', () => {
  assert.equal(normalizeApiOrigin('https://crewcheck.online'), 'https://crewcheck.online');
  assert.equal(normalizeApiOrigin('https://crewcheck.online/'), 'https://crewcheck.online');
  assert.throws(() => normalizeApiOrigin('http://crewcheck.online'), /voyage_api_origin_https_required/);
  const userInfoOrigin = ['https://u', 'p@crewcheck.online'].join(':');
  assert.throws(() => normalizeApiOrigin(userInfoOrigin), /voyage_api_origin_credentials_forbidden/);
  assert.throws(() => normalizeApiOrigin('https://crewcheck.online/voyage'), /voyage_api_origin_must_be_origin_only/);
  assert.throws(() => normalizeApiOrigin('https://crewcheck.online?x=1'), /voyage_api_origin_must_be_origin_only/);
});

test('build-time injection replaces exactly one packaged-shell meta tag', () => {
  const source = '<meta name="voyage-api-origin" content="" />';
  const configured = injectApiOriginHtml(source, 'https://crewcheck.online');
  assert.equal(configured, '<meta name="voyage-api-origin" content="https://crewcheck.online" />');
  assert.throws(() => injectApiOriginHtml('<html></html>', 'https://crewcheck.online'), /voyage_api_origin_meta_missing/);
  assert.throws(() => injectApiOriginHtml(`${source}\n${source}`, 'https://crewcheck.online'), /voyage_api_origin_meta_ambiguous/);
});

test('Android workflow injects and verifies a non-empty API origin before packaging', async () => {
  const workflow = await readFile(`${repoRoot}/.github/workflows/android-apk.yml`, 'utf8');
  assert.match(workflow, /VOYAGE_API_ORIGIN/);
  assert.match(workflow, /android:api-origin/);
  assert.match(workflow, /Verify packaged API origin survived sync/);
  assert.match(workflow, /android\/app\/src\/main\/assets\/public\/index\.html/);
});


test('packaged Android entry uses the operational launch flow instead of disabled preview CTAs', async () => {
  const html = await readFile(`${repoRoot}/app/www/index.html`, 'utf8');
  assert.match(html, /name="voyage-api-origin"/, 'packaged shell must keep the build-time API origin hook');
  assert.match(html, /id="login"/, 'packaged shell must expose the real Google login entry');
  assert.match(html, /id="upload"/, 'packaged shell must expose the persisted PDF import flow');
  assert.match(html, /id="review"/, 'packaged shell must require explicit review before save');
  assert.match(html, /src="\.\/launch\.js"/, 'packaged shell must run the same operational launch client as web');
  assert.match(html, /src="\.\/native-pdf-share\.js"/, 'packaged shell must preserve Android/PWA PDF share intake');
  assert.doesNotMatch(html, /Nenhuma sessão será criada nesta prévia/, 'packaged release candidate must not present preview-only auth copy');
  assert.doesNotMatch(html, /data-action="google-login"[^>]*disabled/, 'Google login must not be hard-disabled in the packaged release candidate');
});
