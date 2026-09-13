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
  assert.throws(() => normalizeApiOrigin('https://user:pass@crewcheck.online'), /voyage_api_origin_credentials_forbidden/);
  assert.throws(() => normalizeApiOrigin('https://crewcheck.online/voyage'), /voyage_api_origin_must_be_origin_only/);
  assert.throws(() => normalizeApiOrigin('https://crewcheck.online?x=1'), /voyage_api_origin_must_be_origin_only/);
});

test('build-time injection replaces the empty packaged-shell meta without changing the web contract', () => {
  const source = '<meta name="voyage-api-origin" content="" />';
  const configured = injectApiOriginHtml(source, 'https://crewcheck.online');
  assert.equal(configured, '<meta name="voyage-api-origin" content="https://crewcheck.online" />');
  assert.throws(() => injectApiOriginHtml('<html></html>', 'https://crewcheck.online'), /voyage_api_origin_meta_missing/);
});

test('Android workflow injects and verifies a non-empty API origin before packaging', async () => {
  const workflow = await readFile(`${repoRoot}/.github/workflows/android-apk.yml`, 'utf8');
  assert.match(workflow, /VOYAGE_API_ORIGIN/);
  assert.match(workflow, /android:api-origin/);
  assert.match(workflow, /Verify packaged API origin survived sync/);
  assert.match(workflow, /android\/app\/src\/main\/assets\/public\/index\.html/);
});
