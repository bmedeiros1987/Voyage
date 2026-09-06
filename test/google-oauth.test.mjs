import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleAuthorizationUrl,
  createSignedOAuthState,
  exchangeGoogleAuthorizationCode,
  googleScopesForPurpose,
  refreshGoogleAccessToken,
  verifySignedOAuthState
} from '../src/google-oauth.mjs';

test('Gmail authorization requests readonly scope separately with offline access', () => {
  const url = new URL(buildGoogleAuthorizationUrl({
    clientId: 'client.apps.googleusercontent.com',
    redirectUri: 'https://example.com/oauth/google/callback',
    state: 'signed-state',
    purpose: 'gmail'
  }));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.ok(url.searchParams.get('scope').includes('gmail.readonly'));
  assert.ok(googleScopesForPurpose('login').includes('profile'));
  assert.equal(googleScopesForPurpose('login').some((scope) => scope.includes('gmail')), false);
});

test('signed OAuth state verifies and expires fail-closed', () => {
  const secret = 'state-secret-with-enough-entropy-for-tests';
  const now = Date.parse('2026-09-06T10:00:00Z');
  const state = createSignedOAuthState({ userId: 'u1', purpose: 'gmail' }, secret, { ttlSeconds: 300, now });
  const verified = verifySignedOAuthState(state, secret, { now: now + 1000 });
  assert.equal(verified.userId, 'u1');
  assert.equal(verified.purpose, 'gmail');
  assert.throws(() => verifySignedOAuthState(state, `${secret}-wrong`, { now }), /signature/);
  assert.throws(() => verifySignedOAuthState(state, secret, { now: now + 301000 }), /expired/);
});

test('authorization code exchange normalizes Google token response', async () => {
  const fetchImpl = async (url, init) => {
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    assert.equal(init.method, 'POST');
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('grant_type'), 'authorization_code');
    return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly', token_type: 'Bearer', id_token: 'id' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const token = await exchangeGoogleAuthorizationCode({ clientId: 'client', clientSecret: 'secret', redirectUri: 'https://example.com/callback', code: 'code', fetchImpl });
  assert.equal(token.accessToken, 'access');
  assert.equal(token.refreshToken, 'refresh');
  assert.ok(token.scope.includes('https://www.googleapis.com/auth/gmail.readonly'));
});

test('refresh flow does not require a new refresh token from Google', async () => {
  const fetchImpl = async (_url, init) => {
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'stored-refresh');
    return new Response(JSON.stringify({ access_token: 'fresh-access', expires_in: 3599, scope: 'openid email', token_type: 'Bearer' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const token = await refreshGoogleAccessToken({ clientId: 'client', clientSecret: 'secret', refreshToken: 'stored-refresh', fetchImpl });
  assert.equal(token.accessToken, 'fresh-access');
  assert.equal(token.refreshToken, null);
});
