import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticatePersistedSession, createSessionToken, persistIssuedSession, requireAuthenticatedSession, verifySessionToken } from '../src/auth-session.mjs';
import { createMemoryPersistence } from '../src/persistence.mjs';

const SECRET = 'test-only-session-signing-key-32-bytes-minimum-123456';

test('session token authenticates user and session without embedding PII', () => {
  const token = createSessionToken({ userId: 'user-123', sessionId: 'session-abc', issuedAt: 1_700_000_000_000, ttlSeconds: 3600 }, SECRET);
  const verified = verifySessionToken(token, SECRET, { now: 1_700_000_100_000 });
  assert.equal(verified.userId, 'user-123');
  assert.equal(verified.sessionId, 'session-abc');
  assert.equal(token.includes('@'), false);
});

test('tampered and expired session tokens fail closed', () => {
  const token = createSessionToken({ userId: 'user-123', sessionId: 'session-abc', issuedAt: 1_700_000_000_000, ttlSeconds: 300 }, SECRET);
  assert.throws(() => verifySessionToken(`${token}x`, SECRET, { now: 1_700_000_100_000 }), /session_token_invalid/);
  assert.throws(() => verifySessionToken(token, SECRET, { now: 1_700_000_400_000 }), /session_token_expired/);
});

test('HTTP authentication requires Bearer and never accepts arbitrary headers as identity', () => {
  const token = createSessionToken({ userId: 'user-456', sessionId: 'session-def', issuedAt: 1_700_000_000_000, ttlSeconds: 3600 }, SECRET);
  const authenticated = requireAuthenticatedSession({ headers: { authorization: `Bearer ${token}` } }, SECRET, { now: 1_700_000_100_000 });
  assert.equal(authenticated.userId, 'user-456');
  assert.throws(() => requireAuthenticatedSession({ headers: { 'x-user-id': 'user-456' } }, SECRET), /authentication_required/);
});

test('persisted session authentication binds signature to revocable server state', async () => {
  const persistence = createMemoryPersistence();
  const token = createSessionToken({ userId: 'user-789', sessionId: 'session-persisted', issuedAt: 1_700_000_000_000, ttlSeconds: 3600 }, SECRET);
  await persistIssuedSession({ token, persistence });
  const request = { headers: { authorization: `Bearer ${token}` } };
  const actor = await authenticatePersistedSession(request, SECRET, persistence, { now: 1_700_000_100_000 });
  assert.equal(actor.userId, 'user-789');
  await persistence.revokeSession('session-persisted', '2023-11-14T22:15:01.000Z');
  await assert.rejects(() => authenticatePersistedSession(request, SECRET, persistence, { now: 1_700_000_101_000 }), /session_revoked/);
});

test('persisted session rejects same session id with a different signed token fingerprint', async () => {
  const persistence = createMemoryPersistence();
  const first = createSessionToken({ userId: 'user-789', sessionId: 'session-shared', issuedAt: 1_700_000_000_000, ttlSeconds: 3600 }, SECRET);
  await persistIssuedSession({ token: first, persistence });
  const second = createSessionToken({ userId: 'user-789', sessionId: 'session-shared', issuedAt: 1_700_000_001_000, ttlSeconds: 3600 }, SECRET);
  await assert.rejects(() => authenticatePersistedSession({ headers: { authorization: `Bearer ${second}` } }, SECRET, persistence, { now: 1_700_000_100_000 }), /authentication_invalid/);
});

test('session signing refuses missing or weak secret', () => {
  assert.throws(() => createSessionToken({ userId: 'u', sessionId: 's' }, 'weak'), /session_signing_key_required/);
});
