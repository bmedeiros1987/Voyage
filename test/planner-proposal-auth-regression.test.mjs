import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createSessionToken } from '../src/auth-session.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const OTHER_KEY = 'fedcba9876543210fedcba9876543210';
const port = 36000 + (process.pid % 4000);
const baseUrl = `http://127.0.0.1:${port}`;
const proposalsUrl = `${baseUrl}/api/v1/planner/itinerary/proposals`;
let server;

before(async () => {
  server = spawn(process.execPath, ['src/server.mjs'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      APP_URL: baseUrl,
      SESSION_SIGNING_KEY: SIGNING_KEY
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

test('a correctly signed token for an unknown session is still rejected', async () => {
  const token = createSessionToken({ userId: 'user-1', sessionId: 'never-persisted' }, SIGNING_KEY);
  const response = await postProposal(token);
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, 'session_not_found');
});

test('a token signed with a different key is rejected', async () => {
  const token = createSessionToken({ userId: 'user-1', sessionId: 'session-1' }, OTHER_KEY);
  const response = await postProposal(token);
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, 'authentication_invalid');
});

test('an expired token is rejected as expired, never accepted', async () => {
  const issuedAt = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const token = createSessionToken({ userId: 'user-1', sessionId: 'session-1', issuedAt, ttlSeconds: 300 }, SIGNING_KEY);
  const response = await postProposal(token);
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, 'session_expired');
});

test('a tampered token payload does not survive signature verification', async () => {
  const token = createSessionToken({ userId: 'user-1', sessionId: 'session-1' }, SIGNING_KEY);
  const [version, encoded, signature] = token.split('.');
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  claims.sub = 'attacker';
  const forged = `${version}.${Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')}.${signature}`;
  const response = await postProposal(forged);
  assert.equal(response.status, 401);
  assert.equal(response.payload.error, 'authentication_invalid');
});

test('a malformed Authorization header is not treated as authentication', async () => {
  for (const authorization of ['Bearer', 'Basic dXNlcjpwYXNz', 'Bearer  ', 'token abc']) {
    const response = await fetch(proposalsUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization },
      body: JSON.stringify(proposalBody())
    });
    assert.equal(response.status, 401, `${authorization} must not authenticate`);
  }
});

test('reading and approving a proposal are separate authenticated requests', async () => {
  const token = createSessionToken({ userId: 'user-1', sessionId: 'never-persisted' }, SIGNING_KEY);
  const read = await fetch(`${proposalsUrl}/some-proposal`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(read.status, 401);

  const approve = await fetch(`${proposalsUrl}/some-proposal/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ version: 1 })
  });
  assert.equal(approve.status, 401);

  const unauthenticatedApprove = await fetch(`${proposalsUrl}/some-proposal/approve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version: 1 })
  });
  assert.equal(unauthenticatedApprove.status, 401);
});

function proposalBody() {
  return { tripId: 'trip-1', baseVersion: 0, changes: [{ op: 'replace', path: '/title', value: 'Test' }] };
}

async function postProposal(token) {
  const response = await fetch(proposalsUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(proposalBody())
  });
  return { status: response.status, payload: await response.json() };
}
