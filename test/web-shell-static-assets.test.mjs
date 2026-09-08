import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
const serviceWorker = await readFile(new URL('../app/www/service-worker.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../app/www/index.html', import.meta.url), 'utf8');

const requiredWebAssets = [
  'styles.css', 'themes.css', 'premium-layout.css', 'premium-overrides.css',
  'signature-experience.css', 'adaptive-home.css', 'responsive-hardening.css',
  'imports.css', 'api-origin.js', 'signature-experience.js', 'adaptive-home.js',
  'app.js', 'import-enhancements.js', 'native-pdf-share.js',
  'service-worker.js', 'manifest.webmanifest'
];

test('every service-worker core asset is served by the API static map', () => {
  for (const asset of requiredWebAssets) {
    assert.match(serviceWorker, new RegExp(`\\./${asset.replace('.', '\\.')}`));
    assert.match(server, new RegExp(`\\['${asset.replace('.', '\\.')}'`));
  }
});

test('branded icon referenced by HTML and manifest has a server route', () => {
  assert.match(index, /\.\.\/resources\/icon\.svg/);
  assert.match(server, /\['icon\.svg', 'image\/svg\+xml; charset=utf-8'\]/);
  assert.match(server, /`\/resources\/\$\{name\}`/);
});

test('adaptive home assets cannot regress to 404 from server omissions', () => {
  assert.match(index, /\.\/adaptive-home\.css/);
  assert.match(index, /\.\/adaptive-home\.js/);
  assert.match(server, /\['adaptive-home\.css', 'text\/css; charset=utf-8'\]/);
  assert.match(server, /\['adaptive-home\.js', 'text\/javascript; charset=utf-8'\]/);
});
