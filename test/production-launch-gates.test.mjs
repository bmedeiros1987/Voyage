import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
test('production rejects demo/preview routes and fails readiness closed without durable storage', async (t) => {
  const port = 42000 + process.pid % 10000;
  const server = spawn(process.execPath, ['src/server.mjs'], { cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, PORT: String(port), NODE_ENV: 'production', DATABASE_URL: '', SESSION_SIGNING_KEY: 'production-test-only-key-32-bytes', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => server.kill());
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server timeout')), 8000);
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('server_started')) { clearTimeout(timeout); resolve(); } });
    server.on('exit', () => { clearTimeout(timeout); reject(new Error('server exited')); });
  });
  const base = `http://127.0.0.1:${port}`;
  for (const path of ['/api/v1/trips/demo', '/api/v1/trips/graph/preview', '/api/v1/imports/manual/preview', '/api/v1/imports/pdf']) assert.equal((await fetch(base + path, { method: path.endsWith('demo') ? 'GET' : 'POST' })).status, 404);
  assert.equal((await fetch(base + '/ready')).status, 503);
  const status = await (await fetch(base + '/api/v1/auth/google/status')).json();
  assert.equal(status.enabled, false); assert.equal(status.gmailEnabled, false);
  const page = await (await fetch(base + '/')).text();
  assert.match(page, /launch.js/); assert.doesNotMatch(page, /demo-italia/);
});
