import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MODULE_URL = new URL('../app/www/api-origin.js', import.meta.url);

test('with no build-time configuration the clients stay same-origin', async () => {
  const { apiUrl, API_ORIGIN } = await loadWithMeta(null, 1);
  assert.equal(API_ORIGIN, '');
  assert.equal(apiUrl('/api/v1/config'), '/api/v1/config');
});

test('a packaged shell can point at its API through the build-time meta tag', async () => {
  const { apiUrl, API_ORIGIN } = await loadWithMeta('https://voyage.example/', 2);
  assert.equal(API_ORIGIN, 'https://voyage.example');
  assert.equal(apiUrl('/api/v1/config'), 'https://voyage.example/api/v1/config');
});

test('an untrustworthy configured origin falls back to same-origin instead of being honoured', async () => {
  const rejected = [
    'http://voyage.example',
    'javascript:alert(1)',
    'https://user:secret@voyage.example',
    'not a url',
    '   '
  ];
  let index = 10;
  for (const value of rejected) {
    const { API_ORIGIN } = await loadWithMeta(value, index++, { pageOrigin: 'https://localhost' });
    assert.equal(API_ORIGIN, '', `${value} must not become the API origin`);
  }
});

test('a browser session ignores the meta tag even when it names a valid https origin', async () => {
  for (const pageOrigin of ['https://crewcheck.online', 'https://voyage.example', 'http://127.0.0.1:8080']) {
    const { API_ORIGIN } = await loadWithMeta('https://api.example.com', 30 + pageOrigin.length, { pageOrigin });
    assert.equal(API_ORIGIN, '', `${pageOrigin} is not a packaged shell and must stay same-origin`);
  }
});

test('resolving the API origin never touches storage', async () => {
  const accesses = [];
  const trap = new Proxy({}, {
    get(_target, property) {
      accesses.push(String(property));
      return () => { throw new Error('storage_must_not_be_read'); };
    }
  });
  const { API_ORIGIN } = await loadWithMeta('https://voyage.example', 20, { extraGlobals: { localStorage: trap, sessionStorage: trap } });
  assert.equal(API_ORIGIN, 'https://voyage.example');
  assert.deepEqual(accesses, []);
});

test('no client reaches the network without going through the single origin owner', async () => {
  for (const path of ['app/www/app.js', 'app/www/import-enhancements.js', 'app/www/signature-experience.js']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    assert.match(source, /import \{ fetchApi \} from '\.\/api-origin\.js';/, `${path} must use the shared origin owner`);
    assert.doesNotMatch(source, /localStorage\.getItem\(\s*['"]voyage-api/, `${path} must not read an API base from storage`);
  }
});

test('the importer owns no retention rule of its own', async () => {
  const source = await readFile(new URL('../app/www/import-enhancements.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ purgedRecord, rawBlobRetention \} from '\.\/retention-policy\.js';/);
  assert.doesNotMatch(source, /blob:\s*null/, 'dropping the bytes belongs to the shared policy, not a second copy here');
  // What the purge actually drops and keeps is covered by local-document-retention.test.mjs.
});

/**
 * The resolver ignores the meta tag entirely outside a packaged shell, so a
 * case that forgets to simulate the page origin passes without ever reaching
 * the URL validation it means to exercise. Default to a Capacitor origin and
 * make the web case explicit.
 */
async function loadWithMeta(content, cacheKey, { pageOrigin = 'https://localhost', extraGlobals = {} } = {}) {
  const previous = {
    document: globalThis.document,
    location: globalThis.location,
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage
  };
  globalThis.document = {
    querySelector(selector) {
      if (selector !== 'meta[name="voyage-api-origin"]' || content === null) return null;
      return { getAttribute: (name) => (name === 'content' ? content : null) };
    }
  };
  globalThis.location = { origin: pageOrigin };
  Object.assign(globalThis, extraGlobals);
  try {
    return await import(`${MODULE_URL.href}?case=${cacheKey}`);
  } finally {
    globalThis.document = previous.document;
    globalThis.location = previous.location;
    globalThis.localStorage = previous.localStorage;
    globalThis.sessionStorage = previous.sessionStorage;
  }
}
