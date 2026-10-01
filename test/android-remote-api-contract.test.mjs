import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { injectApiOriginHtml, normalizeApiOrigin } from '../app/scripts/configure-api-origin.mjs';
import { buildOperationalIndex } from '../app/scripts/configure-operational-entry.mjs';

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

test('Android workflow builds the operational entry before injecting and verifying the API origin', async () => {
  const workflow = await readFile(`${repoRoot}/.github/workflows/android-apk.yml`, 'utf8');
  assert.match(workflow, /android:operational-entry/);
  assert.match(workflow, /VOYAGE_API_ORIGIN/);
  assert.match(workflow, /android:api-origin/);
  assert.ok(workflow.indexOf('android:operational-entry') < workflow.indexOf('android:api-origin'), 'operational entry must be generated before API-origin injection');
  assert.match(workflow, /Verify operational entry and API origin survived sync/);
  assert.match(workflow, /android\/app\/src\/main\/assets\/public\/index\.html/);
});

test('packaged Android entry preserves the full Voyage product shell instead of the minimal launch validator', async () => {
  const shell = await readFile(`${repoRoot}/app/www/index.html`, 'utf8');
  const html = buildOperationalIndex(shell);
  assert.match(html, /name="voyage-api-origin"/, 'packaged shell must keep the build-time API origin hook');
  assert.match(html, /data-screen="welcome"/, 'packaged shell must preserve the branded welcome experience');
  assert.match(html, /data-screen="journeys"/, 'packaged shell must preserve the real journeys UI');
  assert.match(html, /signature-experience\.js/, 'packaged shell must keep the premium product experience');
  assert.match(html, /adaptive-home\.js/, 'packaged shell must keep the adaptive home');
  assert.match(html, /import-enhancements\.js/, 'packaged shell must keep the universal importer');
  assert.match(html, /native-pdf-share\.js/, 'packaged shell must preserve Android/PWA PDF share intake');
  assert.match(html, /operational-shell\.js/, 'packaged shell must bind the product UI to authenticated operational APIs');
  assert.doesNotMatch(html, /Suas viagens, com você\./, 'the Android package must not fall back to the minimal launch validator');
});

test('official shell runtime binds login, persisted session and confirmed PDF journeys to canonical APIs', async () => {
  const runtime = await readFile(`${repoRoot}/app/www/operational-shell.js`, 'utf8');
  assert.match(runtime, /\/api\/v1\/auth\/google\/status/);
  assert.match(runtime, /\/api\/v1\/auth\/session/);
  assert.match(runtime, /\/api\/v1\/journeys\/imports\/pdf/);
  assert.match(runtime, /\/api\/v1\/journeys/);
  assert.doesNotMatch(runtime, /\/api\/v1\/imports\/pdf/);
  assert.doesNotMatch(runtime, /\/api\/v1\/imports\/manual\/preview/);
});
