import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('PWA shared PDFs are bounded, isolated and deleted on consumption', async () => {
  const worker = await read('app/www/service-worker.js');
  const client = await read('app/www/native-pdf-share.js');

  for (const source of [worker, client]) {
    assert.match(source, /SHARED_PDF_CACHE\s*=\s*'voyage-shared-pdf-v1'/);
    assert.match(source, /SHARED_PDF_TTL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
    assert.match(source, /purgeExpiredSharedPdfs/);
  }

  assert.match(worker, /file\.size\s*>\s*15\s*\*\s*1024\s*\*\s*1024/);
  assert.match(worker, /%PDF-/);
  assert.match(client, /await cache\.delete\(key\)/, 'shared source bytes must be removed before importer dispatch');
});

test('Android PDF share is consume-once and does not introduce durable Voyage storage', async () => {
  const generator = await read('app/scripts/configure-pdf-share.mjs');
  assert.match(generator, /MAX_BYTES = 15 \* 1024 \* 1024/);
  assert.match(generator, /invalid_pdf_signature/);
  assert.match(generator, /Intent consumed = new Intent\(Intent\.ACTION_MAIN\)/);
  assert.doesNotMatch(generator, /FileOutputStream|openFileOutput|SharedPreferences/, 'share processing must not add a hidden durable PDF copy');
});

test('secret persistence uses authenticated encryption and policy forbids plaintext document retention by default', async () => {
  const crypto = await read('src/token-crypto.mjs');
  const policy = await read('docs/DOCUMENT_RETENTION_SECURITY.md');

  assert.match(crypto, /aes-256-gcm/);
  assert.match(crypto, /setAAD/);
  assert.match(crypto, /getAuthTag/);
  assert.match(crypto, /key\.length !== 32/);

  assert.match(policy, /Minimize by default/);
  assert.match(policy, /Maximum cache lifetime: \*\*30 minutes\*\*/);
  assert.match(policy, /Long-term raw-document persistence requires authenticated encryption at rest/);
  assert.match(policy, /A durable raw-document store is release-blocked/);
});
