import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const port = 20000 + (process.pid % 20000);
const appUrl = `http://127.0.0.1:${port}`;
const redirectUri = `${appUrl}/api/v1/auth/google/callback`;
let server;

before(async () => {
  server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_URL: appUrl,
      SESSION_SIGNING_KEY: '0123456789abcdef0123456789abcdef',
      GOOGLE_CLIENT_ID: 'voyage-test-client.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'server-only-test-secret',
      GOOGLE_REDIRECT_URI: redirectUri
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

test('CORS reflects only the configured web origin or trusted Capacitor shell origins', async () => {
  const webOrigin = appUrl;
  for (const origin of [webOrigin, 'https://localhost', 'capacitor://localhost']) {
    const response = await exactRequest('/api/v1/config', { Origin: origin });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], origin);
    assert.match(String(response.headers.vary || ''), /Origin/);
  }

  const untrusted = await exactRequest('/api/v1/config', { Origin: 'https://attacker.example' });
  assert.equal(untrusted.statusCode, 200);
  assert.equal(untrusted.headers['access-control-allow-origin'], undefined);
});

test('Google login status and start route are mounted through the real server router', async () => {
  const status = await exactRequest('/api/v1/auth/google/status');
  assert.equal(status.statusCode, 200);
  const statusBody = JSON.parse(status.body);
  assert.equal(statusBody.enabled, true);
  assert.equal(statusBody.gmailEnabled, false);

  const start = await exactRequest('/api/v1/auth/google/start?purpose=login');
  assert.equal(start.statusCode, 302);
  const location = new URL(start.headers.location);
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('client_id'), 'voyage-test-client.apps.googleusercontent.com');
  assert.equal(location.searchParams.get('redirect_uri'), redirectUri);
  assert.equal(location.searchParams.get('scope').includes('gmail.readonly'), false);
  assert.match(String(start.headers['set-cookie'] || ''), /voyage_oauth_state=/);
  assert.match(String(start.headers['set-cookie'] || ''), /HttpOnly/);
  assert.equal(String(start.headers.location).includes('server-only-test-secret'), false);
});

function exactRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path,
      headers: { Host: `127.0.0.1:${port}`, ...headers }
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
