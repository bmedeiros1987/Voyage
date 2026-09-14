import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const port = 39000 + (process.pid % 1500);
let server;

before(async () => {
  server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), APP_URL: `http://127.0.0.1:${port}` },
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

test('a protocol-relative target never reaches the shell or the health check', async () => {
  for (const target of ['//health', '//evil.com/health', '///', '//api/v1/config', '//voyage/index.html', '////health']) {
    const response = await rawRequest(target);
    assert.equal(response.statusCode, 400, `${target} must be rejected as ambiguous`);
    assert.equal(JSON.parse(response.body).error, 'invalid_request_path');
  }
});

test('an ambiguous target is rejected before routing, so a health monitor cannot be fooled by the shell', async () => {
  const ambiguous = await rawRequest('//health');
  assert.doesNotMatch(String(ambiguous.headers['content-type'] || ''), /text\/html/);

  const genuine = await rawRequest('/health');
  assert.equal(genuine.statusCode, 200);
  assert.match(String(genuine.headers['content-type'] || ''), /application\/json/);
  assert.equal(JSON.parse(genuine.body).service, 'voyage-api');
});

test('an absolute-form request target is not accepted by an origin server', async () => {
  const response = await rawRequest('http://evil.example/health');
  assert.equal(response.statusCode, 400);
});

test('rejecting ambiguous targets does not disturb ordinary routes', async () => {
  const shell = await rawRequest('/');
  assert.equal(shell.statusCode, 200);
  assert.match(String(shell.headers['content-type'] || ''), /text\/html/);

  const config = await rawRequest('/api/v1/config');
  assert.equal(config.statusCode, 200);

  const missing = await rawRequest('/api/v1/definitely-missing');
  assert.equal(missing.statusCode, 404);

  const encoded = await rawRequest('/health?probe=1');
  assert.equal(encoded.statusCode, 200);
});

function rawRequest(path) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'GET', path, headers: { Host: `127.0.0.1:${port}` } },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body }));
      }
    );
    req.on('error', reject);
    req.end();
  });
}
