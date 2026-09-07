import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';

const PORT = 10499;
const BASE = `http://127.0.0.1:${PORT}`;
let server;

test.before(async () => {
  server = spawn(process.execPath, ['src/server.mjs'], {
    env: { ...process.env, PORT: String(PORT), SESSION_SIGNING_KEY: 'test-key-not-a-secret', NO_PROXY: '*' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 60; i += 1) {
    try { await fetch(`${BASE}/health`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('server did not start');
});

test.after(async () => { server?.kill(); if (server) await once(server, 'exit').catch(() => {}); });

test('public allowlist endpoints stay reachable without a session', async () => {
  for (const path of ['/health', '/api/v1/config', '/api/v1/auth/google/status']) {
    assert.equal((await fetch(`${BASE}${path}`)).status, 200, `${path} should be public`);
  }
});

test('private endpoints are 401 without a session', async () => {
  const post = await fetch(`${BASE}/api/v1/imports/pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF-1.4\ntest\n'
  });
  assert.equal(post.status, 401);
  assert.equal((await post.json()).error, 'authentication_required');

  for (const path of ['/api/v1/identity/me', '/api/v1/entitlements', '/api/v1/trips/demo']) {
    assert.equal((await fetch(`${BASE}${path}`)).status, 401, `${path} must be private`);
  }
});

test('a session unlocks private endpoints and the PDF import path', async () => {
  const login = await fetch(`${BASE}/api/v1/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerIdentity: { provider: 'PASSWORD', subject: 'user-1' } })
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { globalUserId } = await login.json();
  assert.match(globalUserId, /^gid_/);

  const me = await fetch(`${BASE}/api/v1/identity/me`, { headers: { cookie } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).globalUserId, globalUserId);

  const upload = await fetch(`${BASE}/api/v1/imports/pdf`, {
    method: 'POST', headers: { 'Content-Type': 'application/pdf', cookie }, body: '%PDF-1.4\ntest\n'
  });
  assert.equal(upload.status, 200);
});

test('the Gmail Pub/Sub endpoint fails closed on an unverified push', async () => {
  const response = await fetch(`${BASE}/api/v1/integrations/gmail/pubsub`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { data: 'e30=' } })
  });
  assert.ok(response.status >= 400, 'a forged push must not be accepted');
  assert.notEqual(response.status, 202);
});

test('the full proposal lifecycle is enforced over HTTP', async () => {
  const login = await fetch(`${BASE}/api/v1/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerIdentity: { provider: 'PASSWORD', subject: 'user-2' } })
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const json = { 'Content-Type': 'application/json', cookie };

  // Creating with a self-approval flag must not approve.
  const created = await fetch(`${BASE}/api/v1/proposals`, {
    method: 'POST', headers: json,
    body: JSON.stringify({ userApproved: true, diff: { summary: 'trocar voo', operations: [] } })
  });
  assert.equal(created.status, 201);
  const proposal = await created.json();
  assert.equal(proposal.userApproved, false);
  assert.equal(proposal.mayApply, false);

  // A stale version is a 409.
  const stale = await fetch(`${BASE}/api/v1/proposals/${proposal.proposalId}/approve`, {
    method: 'POST', headers: json, body: JSON.stringify({ version: 99 })
  });
  assert.equal(stale.status, 409);

  // The reviewed version approves.
  const approved = await fetch(`${BASE}/api/v1/proposals/${proposal.proposalId}/approve`, {
    method: 'POST', headers: json, body: JSON.stringify({ version: proposal.version })
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).mayApply, true);
});

test('one user cannot reach another user\'s proposal', async () => {
  const loginA = await fetch(`${BASE}/api/v1/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerIdentity: { provider: 'PASSWORD', subject: 'user-a' } })
  });
  const cookieA = loginA.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${BASE}/api/v1/proposals`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieA },
    body: JSON.stringify({ diff: { summary: 'x', operations: [] } })
  });
  const { proposalId } = await created.json();

  const loginB = await fetch(`${BASE}/api/v1/auth/session`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerIdentity: { provider: 'PASSWORD', subject: 'user-b' } })
  });
  const cookieB = loginB.headers.get('set-cookie').split(';')[0];
  const stolen = await fetch(`${BASE}/api/v1/proposals/${proposalId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie: cookieB },
    body: JSON.stringify({ version: 1 })
  });
  assert.equal(stolen.status, 404, 'another user must not resolve this proposal');
});
