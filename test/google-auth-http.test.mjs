import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleGoogleAuthHttp } from '../src/google-auth-http.mjs';
import { createSignedOAuthState } from '../src/google-oauth.mjs';
import { verifySessionToken } from '../src/auth-session.mjs';
import { createMemoryPersistence } from '../src/persistence.mjs';
import { getRuntimeConfig, publicConfig } from '../src/config.mjs';

const SIGNING_KEY = '0123456789abcdef0123456789abcdef';
const TOKEN_KEY = Buffer.alloc(32, 7).toString('base64url');

function runtimeConfig() {
  return {
    appUrl: 'https://voyage-api-okay.onrender.com/voyage',
    session: { signingKey: SIGNING_KEY },
    google: {
      clientId: '627296893301-client.apps.googleusercontent.com',
      clientSecret: 'server-only-client-secret',
      redirectUri: 'https://voyage-api-okay.onrender.com/api/v1/auth/google/callback',
      tokenEncryptionKey: TOKEN_KEY,
      tokenKeyVersion: 'v1',
      gmailConfigured: true
    }
  };
}

function responseStub() {
  const headers = new Map();
  return {
    statusCode: 200,
    writableEnded: false,
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    end() { this.writableEnded = true; }
  };
}

function stateCookie(state) {
  const fingerprint = createHash('sha256').update(state).digest('base64url');
  return `voyage_oauth_state=${encodeURIComponent(fingerprint)}`;
}

test('OAuth preserves up to four pending tabs and consumes only the completed state', async () => {
  const options = { config: runtimeConfig(), persistence: createMemoryPersistence() };
  let cookie = '';
  const states = [];
  for (let index = 0; index < 5; index++) {
    const res = responseStub();
    await handleGoogleAuthHttp({ method: 'GET', url: '/api/v1/auth/google/start', headers: { cookie } }, res, '/api/v1/auth/google/start', options);
    states.push(new URL(res.getHeader('location')).searchParams.get('state'));
    cookie = res.getHeader('set-cookie').split(';')[0];
    assert.match(res.getHeader('set-cookie'), /Path=\/api\/v1\/auth\/google;/);
  }
  const callback = async state => {
    const res = responseStub();
    await handleGoogleAuthHttp({ method: 'GET', url: `/api/v1/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`, headers: { cookie } }, res, '/api/v1/auth/google/callback', options);
    cookie = res.getHeader('set-cookie').split(';')[0];
    return res;
  };
  await assert.rejects(callback(states[0]), /oauth_state_browser_mismatch/);
  await callback(states[1]);
  await assert.rejects(callback(states[1]), /oauth_state_browser_mismatch/);
  await callback(states[3]);
  await callback(states[2]);
  assert.match((await callback(states[4])).getHeader('set-cookie'), /Max-Age=0/);
});

test('Google start route creates a signed Gmail redirect and browser-bound state cookie without leaking server secret', async () => {
  const persistence = createMemoryPersistence();
  const req = { method: 'GET', url: '/api/v1/auth/google/start?purpose=gmail', headers: {} };
  const res = responseStub();

  const handled = await handleGoogleAuthHttp(req, res, '/api/v1/auth/google/start', { config: runtimeConfig(), persistence });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  const location = new URL(res.getHeader('location'));
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('client_id'), '627296893301-client.apps.googleusercontent.com');
  assert.equal(location.searchParams.get('redirect_uri'), runtimeConfig().google.redirectUri);
  assert.equal(location.searchParams.get('access_type'), 'offline');
  assert.equal(location.searchParams.get('prompt'), 'consent');
  assert.match(location.searchParams.get('scope'), /gmail\.readonly/);
  assert.equal(location.toString().includes('server-only-client-secret'), false);

  const cookie = res.getHeader('set-cookie');
  assert.match(cookie, /^voyage_oauth_state=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal(cookie.includes(location.searchParams.get('state')), false);
});

test('Gmail callback persists verified Google subject, encrypted refresh token, consent and Voyage session', async () => {
  const persistence = createMemoryPersistence();
  const state = createSignedOAuthState({ purpose: 'gmail' }, SIGNING_KEY, { ttlSeconds: 600 });
  const req = {
    method: 'GET',
    url: `/api/v1/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`,
    headers: { cookie: stateCookie(state) }
  };
  const res = responseStub();
  const fetchImpl = async (url, init = {}) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(init.body);
      assert.equal(form.get('client_secret'), 'server-only-client-secret');
      return new Response(JSON.stringify({
        access_token: 'access-token',
        refresh_token: 'raw-refresh-token',
        expires_in: 3600,
        scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
        token_type: 'Bearer'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      assert.equal(init.headers.Authorization, 'Bearer access-token');
      return new Response(JSON.stringify({
        sub: 'google-subject-123',
        email: 'traveler@example.com',
        email_verified: true,
        name: 'Traveler',
        picture: 'https://example.com/avatar.png'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  const handled = await handleGoogleAuthHttp(req, res, '/api/v1/auth/google/callback', {
    config: runtimeConfig(), persistence, fetchImpl
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.match(res.getHeader('set-cookie'), /Max-Age=0/);

  const returned = new URL(res.getHeader('location'));
  const fragment = new URLSearchParams(returned.hash.slice(1));
  assert.equal(fragment.get('gmail'), 'connected');
  assert.equal(returned.search, '');
  assert.equal(returned.toString().includes('raw-refresh-token'), false);
  assert.equal(returned.toString().includes('server-only-client-secret'), false);

  const sessionToken = fragment.get('voyage_session');
  const session = verifySessionToken(sessionToken, SIGNING_KEY);
  const connection = await persistence.getGoogleConnectionByUserId(session.userId);
  assert.equal(connection.googleSubject, 'google-subject-123');
  assert.ok(connection.grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly'));
  assert.notEqual(connection.encryptedRefreshToken, 'raw-refresh-token');
  assert.match(connection.encryptedRefreshToken, /^v1\./);
  assert.ok(await persistence.getSession(session.sessionId));
});

test('OAuth callback fails closed when the browser state cookie is missing or mismatched', async () => {
  const persistence = createMemoryPersistence();
  const state = createSignedOAuthState({ purpose: 'login' }, SIGNING_KEY);
  const res = responseStub();
  let fetchCalled = false;

  await assert.rejects(
    () => handleGoogleAuthHttp({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`,
      headers: {}
    }, res, '/api/v1/auth/google/callback', {
      config: runtimeConfig(), persistence, fetchImpl: async () => { fetchCalled = true; throw new Error('must not fetch'); }
    }),
    /oauth_state_browser_mismatch/
  );

  await assert.rejects(
    () => handleGoogleAuthHttp({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-1&state=${encodeURIComponent(state)}`,
      headers: { cookie: 'voyage_oauth_state=wrong' }
    }, responseStub(), '/api/v1/auth/google/callback', {
      config: runtimeConfig(), persistence, fetchImpl: async () => { fetchCalled = true; throw new Error('must not fetch'); }
    }),
    /oauth_state_browser_mismatch/
  );
  assert.equal(fetchCalled, false);
});

test('OAuth callback rejects a tampered signed state even if its browser fingerprint is supplied', async () => {
  const persistence = createMemoryPersistence();
  const good = createSignedOAuthState({ purpose: 'login' }, SIGNING_KEY);
  const tampered = `${good.slice(0, -1)}${good.endsWith('A') ? 'B' : 'A'}`;
  let fetchCalled = false;
  await assert.rejects(
    () => handleGoogleAuthHttp({
      method: 'GET',
      url: `/api/v1/auth/google/callback?code=code-1&state=${encodeURIComponent(tampered)}`,
      headers: { cookie: stateCookie(tampered) }
    }, responseStub(), '/api/v1/auth/google/callback', {
      config: runtimeConfig(), persistence, fetchImpl: async () => { fetchCalled = true; throw new Error('must not fetch'); }
    }),
    /oauth_state_signature_invalid/
  );
  assert.equal(fetchCalled, false);
});

test('identity persistence does not silently link a second Google subject by email alone', async () => {
  const persistence = createMemoryPersistence();
  await persistence.upsertGoogleIdentity({
    googleSubject: 'subject-one', email: 'same@example.com', emailVerified: true, displayName: 'One'
  });
  await assert.rejects(
    () => persistence.upsertGoogleIdentity({
      googleSubject: 'subject-two', email: 'same@example.com', emailVerified: true, displayName: 'Two'
    }),
    /identity_link_confirmation_required/
  );
});

test('public runtime config never exposes OAuth client id, client secret, redirect or token key', () => {
  const config = getRuntimeConfig({
    NODE_ENV: 'development',
    APP_URL: 'https://voyage-api-okay.onrender.com/voyage',
    SESSION_SIGNING_KEY: SIGNING_KEY,
    GOOGLE_CLIENT_ID: '627296893301-client.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'private-secret',
    GOOGLE_REDIRECT_URI: 'https://voyage-api-okay.onrender.com/api/v1/auth/google/callback',
    TOKEN_ENCRYPTION_KEY: TOKEN_KEY
  });
  const exposed = JSON.stringify(publicConfig(config));
  assert.equal(config.google.gmailConfigured, true);
  assert.equal(exposed.includes('private-secret'), false);
  assert.equal(exposed.includes('627296893301-client'), false);
  assert.equal(exposed.includes('/api/v1/auth/google/callback'), false);
  assert.equal(exposed.includes(TOKEN_KEY), false);
});
