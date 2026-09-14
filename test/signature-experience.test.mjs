import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { handleCrewCheckIntegrationHttp } from '../src/crewcheck-http-integration.mjs';

const root = new URL('../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

function response() {
  const headers = new Map();
  return {
    statusCode: 200,
    writableEnded: false,
    body: Buffer.alloc(0),
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = Buffer.isBuffer(value) ? value : Buffer.from(String(value)); this.writableEnded = true; },
    get headers() { return headers; }
  };
}

test('Signature assets load before app navigation is initialized', async () => {
  const html = await text('app/www/index.html');
  assert.match(html, /premium-layout\.css/);
  assert.match(html, /premium-overrides\.css/);
  assert.match(html, /signature-experience\.css/);
  assert.match(html, /responsive-hardening\.css/);
  const signatureIndex = html.indexOf('signature-experience.js');
  const appIndex = html.indexOf('app.js');
  assert.ok(signatureIndex > 0 && appIndex > signatureIndex, 'Signature must inject the command screen before app.js captures screen navigation');
});

test('Signature UI is premium, service-backed and does not invent trip readiness', async () => {
  const js = await text('app/www/signature-experience.js');
  const css = await text('app/www/signature-experience.css');
  assert.match(js, /PRIVATE TRAVEL INTELLIGENCE/);
  assert.match(js, /\/api\/v1\/intelligence\/capabilities/);
  assert.match(js, /\/api\/v1\/integrations\/crewcheck\/capabilities/);
  assert.match(js, /\/api\/v1\/data\/capabilities/);
  assert.match(js, /Cirium via CrewCheck/);
  assert.match(js, /Prontidão tecnológica/);
  assert.match(js, /A prontidão da sua viagem é calculada separadamente/);
  assert.doesNotMatch(js, /Journey Readiness[^\n]*92%/);
  assert.match(css, /signature-command/);
  assert.match(css, /conic-gradient/);
  assert.match(css, /prefers-reduced-motion/);
});

test('premium and responsive assets are served by the early Voyage router at root and /voyage paths', async () => {
  for (const path of [
    '/premium-layout.css',
    '/voyage/premium-overrides.css',
    '/signature-experience.js',
    '/adaptive-home.css',
    '/voyage/adaptive-home.js',
    '/voyage/signature-experience.css',
    '/responsive-hardening.css',
    '/voyage/native-pdf-share.js'
  ]) {
    const req = Readable.from([]);
    req.method = 'GET';
    req.headers = {};
    const res = response();
    const handled = await handleCrewCheckIntegrationHttp(req, res, path);
    assert.equal(handled, true, path);
    assert.equal(res.statusCode, 200, path);
    assert.ok(res.body.length > 100, path);
  }
});

test('service worker caches the current Signature shell resources', async () => {
  const sw = await text('app/www/service-worker.js');
  assert.match(sw, /voyage-shell-v\d+-[a-z0-9-]+/);
  for (const resource of [
    'premium-layout.css',
    'premium-overrides.css',
    'signature-experience.css',
    'responsive-hardening.css',
    'signature-experience.js',
    'native-pdf-share.js'
  ]) {
    assert.ok(sw.includes(`'./${resource}'`), resource);
  }
});

test('PWA shared PDFs use unique keys and bounded retention instead of a permanent singleton cache entry', async () => {
  const sw = await text('app/www/service-worker.js');
  const bridge = await text('app/www/native-pdf-share.js');
  assert.match(sw, /SHARED_PDF_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
  assert.match(sw, /makeShareId\(\)/);
  assert.match(sw, /x-voyage-shared-at/);
  assert.match(sw, /purgeExpiredSharedPdfs/);
  assert.doesNotMatch(sw, /cache\.put\('\/__voyage_shared_pdf__'/);
  assert.match(bridge, /getSharedPdfById/);
  assert.match(bridge, /getNewestSharedPdf/);
  assert.match(bridge, /purgeExpiredSharedPdfs/);
});

test('Universal importer has a single frontend owner and review is evidence-first', async () => {
  const app = await text('app/www/app.js');
  const importer = await text('app/www/import-enhancements.js');
  const css = await text('app/www/imports.css');

  assert.doesNotMatch(app, /queuePdfImport|openImportDb|putImport|listImports|syncQueuedImports/);
  assert.doesNotMatch(app, /data-import-files[^\n]*addEventListener\(['"]change/);
  assert.match(app, /voyage:imports-open/);

  assert.match(importer, /input\.addEventListener\(['"]change['"]/);
  assert.match(importer, /data-review-evidence/);
  assert.match(importer, /extractedFacts/);
  assert.match(importer, /factConfidence/);
  assert.match(importer, /Nenhum arquivo foi marcado como salvo/);
  assert.match(importer, /from '\.\/retention-policy\.js'/, 'raw-blob retention is bounded by the shared policy');
  assert.match(importer, /deleteRecord/);
  assert.match(css, /import-review-evidence/);
});
