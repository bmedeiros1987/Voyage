import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ingestPdfBuffer } from '../src/pdf-ingest.mjs';

test('direct PDF intake performs automatic travel-document triage', () => {
  const synthetic = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nstream\nBT (LATAM LA 1234 GRU -> BSB seat 12A) Tj ET\nendstream\nendobj\n%%EOF');
  const result = ingestPdfBuffer(synthetic, { fileName: 'synthetic-ticket.pdf' });
  assert.ok(['PARSED', 'NEEDS_REVIEW'].includes(result.status));
  assert.notEqual(result.document.category, undefined);
  assert.equal(result.document.mimeType, 'application/pdf');
  assert.equal(result.source.contentType, 'application/pdf');
  assert.equal(result.review.required, result.status === 'NEEDS_REVIEW');
});

test('PWA manifest registers Voyage as an application/pdf share target', async () => {
  const manifest = JSON.parse(await readFile(new URL('../app/www/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.share_target.method, 'POST');
  assert.ok(manifest.share_target.params.files[0].accept.includes('application/pdf'));
});

test('mobile shell loads native PDF share bridge and routes it into universal importer', async () => {
  const [html, bridge, androidConfigurator] = await Promise.all([
    readFile(new URL('../app/www/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app/www/native-pdf-share.js', import.meta.url), 'utf8'),
    readFile(new URL('../app/scripts/configure-pdf-share.mjs', import.meta.url), 'utf8')
  ]);
  assert.match(html, /native-pdf-share\.js/);
  assert.match(bridge, /VoyagePdfShare/);
  assert.match(bridge, /data-import-files/);
  assert.match(androidConfigurator, /android\.intent\.action\.SEND/);
  assert.match(androidConfigurator, /application\/pdf/);
});
