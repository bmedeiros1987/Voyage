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
  assert.match(js, /Prontidão tecnológica/);
  assert.match(js, /A prontidão da sua viagem é calculada separadamente/);
  assert.doesNotMatch(js, /Journey Readiness[^\n]*92%/);
  assert.match(css, /signature-command/);
  assert.match(css, /conic-gradient/);
  assert.match(css, /prefers-reduced-motion/);
});

test('premium assets are served by the early Voyage router at root and /voyage paths', async () => {
  for (const path of ['/premium-layout.css', '/voyage/premium-overrides.css', '/signature-experience.js', '/voyage/signature-experience.css']) {
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

test('service worker caches Signature shell resources', async () => {
  const sw = await text('app/www/service-worker.js');
  assert.match(sw, /voyage-shell-v5-signature/);
  for (const resource of ['premium-layout.css', 'premium-overrides.css', 'signature-experience.css', 'signature-experience.js']) {
    assert.ok(sw.includes(`'./${resource}'`), resource);
  }
});
