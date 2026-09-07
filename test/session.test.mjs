import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateRequest, createSession, isPublicEndpoint, verifySession } from '../src/session.mjs';

const KEY = 'test-signing-key-not-a-real-secret';

test('a signed session round-trips and carries the globalUserId', () => {
  const created = createSession({ globalUserId: 'gid_abc', signingKey: KEY });
  const verified = verifySession(created.token, { signingKey: KEY });
  assert.equal(verified.valid, true);
  assert.equal(verified.globalUserId, 'gid_abc');
});

test('a tampered or foreign-signed token is rejected', () => {
  const created = createSession({ globalUserId: 'gid_abc', signingKey: KEY });
  assert.equal(verifySession(created.token, { signingKey: 'other-key' }).reason, 'SESSION_SIGNATURE_INVALID');
  assert.equal(verifySession(`${created.token}x`, { signingKey: KEY }).valid, false);
});

test('an expired session is rejected', () => {
  const created = createSession({ globalUserId: 'gid_abc', signingKey: KEY, ttlSeconds: 60 });
  const verified = verifySession(created.token, { signingKey: KEY, now: Date.now() + 61_000 });
  assert.equal(verified.reason, 'SESSION_EXPIRED');
});

test('private endpoints are denied without a session', () => {
  const auth = authenticateRequest({ method: 'POST', headers: {} }, '/api/v1/imports/pdf', { signingKey: KEY });
  assert.equal(auth.allowed, false);
  assert.equal(auth.reason, 'SESSION_MISSING');
});

test('a valid bearer token unlocks a private endpoint', () => {
  const created = createSession({ globalUserId: 'gid_abc', signingKey: KEY });
  const auth = authenticateRequest(
    { method: 'POST', headers: { authorization: `Bearer ${created.token}` } },
    '/api/v1/imports/pdf', { signingKey: KEY }
  );
  assert.equal(auth.allowed, true);
  assert.equal(auth.session.globalUserId, 'gid_abc');
});

test('only the explicit allowlist is public', () => {
  assert.equal(isPublicEndpoint('/health'), true);
  assert.equal(isPublicEndpoint('/api/v1/config'), true);
  assert.equal(isPublicEndpoint('/api/v1/auth/session', 'POST'), true);
  // Anything carrying user data must not be public.
  for (const path of ['/api/v1/imports/pdf', '/api/v1/identity/me', '/api/v1/proposals',
                      '/api/v1/planner/preview', '/api/v1/entitlements', '/api/v1/dietary/travel-card']) {
    assert.equal(isPublicEndpoint(path, 'POST'), false, `${path} must be private`);
  }
});

test('no secret is exposed to the client', () => {
  const created = createSession({ globalUserId: 'gid_abc', signingKey: KEY });
  assert.equal(created.token.includes(KEY), false);
});
