import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionToken, requireAuthenticatedSession, verifySessionToken } from '../src/auth-session.mjs';

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

test('session signing refuses missing or weak secret', () => {
  assert.throws(() => createSessionToken({ userId: 'u', sessionId: 's' }, 'weak'), /session_signing_key_required/);
});
