import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const servers = [];

before(async () => {
  await Promise.all([
    startServer('development', {}),
    startServer('production', { SESSION_SIGNING_KEY: '0123456789abcdef0123456789abcdef', DATABASE_URL: '' })
  ]);
});

after(() => {
  for (const entry of servers) {
    if (entry.process && !entry.process.killed) entry.process.kill('SIGTERM');
  }
});

test('HSTS is sent only in production, never in development', async () => {
  const development = await headers('development', '/health');
  const production = await headers('production', '/health');
  assert.equal(development['strict-transport-security'], undefined);
  assert.match(String(production['strict-transport-security'] || ''), /max-age=63072000/);
  assert.match(String(production['strict-transport-security'] || ''), /includeSubDomains/);
});

test('every response carries the restrictive policy, not only the shell', async () => {
  for (const path of ['/health', '/api/v1/config', '/does-not-exist']) {
    const received = await headers('development', path);
    const csp = String(received['content-security-policy'] || '');
    assert.match(csp, /default-src 'self'/, `${path} must carry a CSP`);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
    assert.doesNotMatch(csp, /unsafe-(inline|eval)/);
  }
});

test('CORS responses vary on Origin and never use wildcard', async () => {
  const received = await headers('development', '/api/v1/config');
  assert.match(String(received.vary || ''), /Origin/i);
  assert.doesNotMatch(String(received['access-control-allow-origin'] || ''), /\*/);
});

test('same-origin web requests receive the configured web origin', async () => {
  const origin = urlFor('development');
  const received = await headers('development', '/api/v1/config', { Origin: origin });
  assert.equal(received['access-control-allow-origin'], origin);
});

test('trusted Capacitor origin is allowed explicitly', async () => {
  const received = await headers('development', '/api/v1/config', { Origin: 'https://localhost' });
  assert.equal(received['access-control-allow-origin'], 'https://localhost');
});

test('untrusted origins do not receive an allow-origin header', async () => {
  const received = await headers('development', '/api/v1/config', { Origin: 'https://attacker.example' });
  assert.equal(received['access-control-allow-origin'], undefined);
});

test('preflight from trusted Capacitor origin succeeds with narrow allowlist', async () => {
  const response = await fetch(`${urlFor('development')}/api/v1/config`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://localhost',
      'Access-Control-Request-Method': 'GET'
    }
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://localhost');
  assert.doesNotMatch(String(response.headers.get('access-control-allow-origin') || ''), /\*/);
});

test('an authenticated surface stays fail-closed in production without a database', async () => {
  const response = await fetch(`${urlFor('production')}/api/v1/planner/itinerary/proposals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tripId: 'trip-1', baseVersion: 0, changes: [{ op: 'replace', path: '/title', value: 'x' }] })
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'production_persistence_required');
});

function urlFor(name) {
  return servers.find((entry) => entry.name === name).baseUrl;
}

async function headers(name, path, extraHeaders = {}) {
  const response = await fetch(`${urlFor(name)}${path}`, { headers: extraHeaders });
  return Object.fromEntries(response.headers.entries());
}

function startServer(name, extraEnv) {
  const port = 38000 + servers.length + (process.pid % 2000);
  const entry = { name, baseUrl: `http://127.0.0.1:${port}`, process: null };
  servers.push(entry);
  entry.process = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: name, PORT: String(port), APP_URL: entry.baseUrl, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return new Promise((resolve, reject) => {
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`server_start_timeout(${name}): ${stderr}`)), 5000);
    entry.process.stderr.setEncoding('utf8');
    entry.process.stdout.setEncoding('utf8');
    entry.process.stderr.on('data', (chunk) => { stderr += chunk; });
    entry.process.stdout.on('data', (chunk) => {
      if (chunk.includes('"event":"server_started"')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    entry.process.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`server_exited_before_ready(${name}):${code}: ${stderr}`));
    });
  });
}
