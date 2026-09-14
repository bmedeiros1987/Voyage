import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CLIENTS = [
  'app/www/app.js',
  'app/www/import-enhancements.js',
  'app/www/signature-experience.js'
];

test('API destination is not user-controlled through voyage-api-base localStorage', async () => {
  for (const path of CLIENTS) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /voyage-api-base/,
      `${path} must use same-origin or a trusted build-time/runtime configuration, never localStorage voyage-api-base`
    );
  }
});
