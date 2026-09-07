import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const port = 20000 + (process.pid % 20000);
let server;

before(async () => {
  server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_URL: `http://127.0.0.1:${port}`
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  await new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`server_start_timeout: ${stderr}`)), 5000);
    server.stderr.setEncoding('utf8');
    server.stdout.setEncoding('utf8');
    server.stderr.on('data', (chunk) => { stderr += chunk; });
    server.stdout.on('data', (chunk) => {
      if (chunk.includes('"event":"server_started"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    server.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server_exited_before_ready:${code}: ${stderr}`));
    });
  });
});

after(() => {
  if (server && !server.killed) server.kill('SIGTERM');
});

test('served shell has a restrictive Content-Security-Policy', async () => {
  const response = await exactRequest('/');
  assert.equal(response.statusCode, 200);
  const csp = String(response.headers['content-security-policy'] || '');
  assert.match(csp, /default-src\s+'self'/);
  assert.match(csp, /frame-ancestors\s+'none'/);
  assert.doesNotMatch(csp, /'unsafe-inline'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
});

test('ambiguous protocol-relative request paths cannot resolve to valid routes', async () => {
  for (const path of ['//health', '//evil.com/health', '///']) {
    const response = await exactRequest(path);
    assert.notEqual(response.statusCode, 200, `${path} must be rejected or return a non-success response`);
  }

  const health = await exactRequest('/health');
  assert.equal(health.statusCode, 200);
  assert.match(String(health.headers['content-type'] || ''), /application\/json/);
});

function exactRequest(path) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path,
      headers: { Host: `127.0.0.1:${port}` }
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
