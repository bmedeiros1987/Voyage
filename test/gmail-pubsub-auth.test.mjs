import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signPayload } from 'node:crypto';
import { createGmailPubSubVerifier } from '../src/gmail-pubsub-auth.mjs';

const AUDIENCE = 'https://voyage.example/api/v1/integrations/gmail/pubsub';
const SERVICE_ACCOUNT = 'voyage-push@example.iam.gserviceaccount.com';
const NOW_MS = Date.UTC(2026, 8, 7, 12, 0, 0);

const trusted = generateKeyPairSync('rsa', { modulusLength: 2048 });
const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });

test('an unconfigured audience fails closed with 503 instead of accepting a push', async () => {
  const verifier = createGmailPubSubVerifier({ audience: '', fetchImpl: failingFetch });
  assert.equal(verifier.configured, false);
  await assertRejection(() => verifier.verifyRequest({ headers: {} }), 'gmail_pubsub_not_configured', 503);
});

test('a configured verifier rejects a push with no Bearer token before any network call', async () => {
  const verifier = createGmailPubSubVerifier({ audience: AUDIENCE, fetchImpl: failingFetch, now: () => NOW_MS });
  await assertRejection(() => verifier.verifyRequest({ headers: {} }), 'pubsub_authentication_required', 401);
  await assertRejection(
    () => verifier.verifyRequest({ headers: { authorization: 'Basic dXNlcjpwYXNz' } }),
    'pubsub_authentication_required',
    401
  );
});

test('a genuine Google-signed push token is accepted', async () => {
  const verifier = buildVerifier();
  const token = makeToken();
  const result = await verifier.verifyRequest({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(result.audience, AUDIENCE);
  assert.equal(result.issuer, 'https://accounts.google.com');
  assert.equal(result.email, SERVICE_ACCOUNT);
});

test('a token signed by an attacker key is rejected even with perfect claims', async () => {
  const verifier = buildVerifier();
  const token = makeToken({ privateKey: attacker.privateKey });
  await assertRejection(() => verifier.verifyToken(token), 'pubsub_token_signature_invalid', 401);
});

test('the audience must match exactly', async () => {
  const verifier = buildVerifier();
  for (const aud of ['https://voyage.example/api/v1/integrations/gmail/pubsub/', 'https://evil.example/push', '']) {
    await assertRejection(() => verifier.verifyToken(makeToken({ claims: { aud } })), 'pubsub_token_audience_invalid', 401);
  }
});

test('a non-Google issuer is rejected', async () => {
  const verifier = buildVerifier();
  await assertRejection(
    () => verifier.verifyToken(makeToken({ claims: { iss: 'https://accounts.evil.example' } })),
    'pubsub_token_issuer_invalid',
    401
  );
});

test('an expired token is rejected and a not-yet-issued token is rejected', async () => {
  const verifier = buildVerifier();
  const seconds = Math.floor(NOW_MS / 1000);
  await assertRejection(
    () => verifier.verifyToken(makeToken({ claims: { exp: seconds - 1 } })),
    'pubsub_token_expired',
    401
  );
  await assertRejection(
    () => verifier.verifyToken(makeToken({ claims: { iat: seconds + 3600, exp: seconds + 7200 } })),
    'pubsub_token_not_yet_valid',
    401
  );
});

test('an unknown key id is rejected rather than silently trusted', async () => {
  const verifier = buildVerifier();
  await assertRejection(() => verifier.verifyToken(makeToken({ kid: 'rotated-away' })), 'pubsub_token_key_unknown', 401);
});

test('the alg header cannot be downgraded to none or to a symmetric algorithm', async () => {
  const verifier = buildVerifier();
  for (const alg of ['none', 'HS256', 'RS512']) {
    const header = base64url({ alg, kid: 'voyage-test-key', typ: 'JWT' });
    const claims = base64url(defaultClaims());
    await assertRejection(
      () => verifier.verifyToken(`${header}.${claims}.`),
      'pubsub_token_invalid',
      401
    );
    await assertRejection(
      () => verifier.verifyToken(`${header}.${claims}.c2lnbmF0dXJl`),
      'pubsub_token_algorithm_unsupported',
      401
    );
  }
});

test('a token whose subject is not the configured push service account is rejected', async () => {
  const verifier = buildVerifier();
  await assertRejection(
    () => verifier.verifyToken(makeToken({ claims: { email: 'someone-else@example.com' } })),
    'pubsub_token_subject_invalid',
    401
  );
  await assertRejection(
    () => verifier.verifyToken(makeToken({ claims: { email_verified: false } })),
    'pubsub_token_subject_invalid',
    401
  );
});

test('a structurally malformed token never reaches signature verification', async () => {
  const verifier = buildVerifier();
  for (const token of ['', 'not-a-jwt', 'a.b', 'a.b.c.d', '..', `${base64url({ alg: 'RS256' })}..sig`]) {
    await assertRejection(() => verifier.verifyToken(token), /^pubsub_token_(invalid|kid_missing)$/, 401);
  }
});

test('a replayed messageId is ignored instead of reprocessed', () => {
  const verifier = buildVerifier();
  assert.equal(verifier.registerDelivery('message-1'), true);
  assert.equal(verifier.registerDelivery('message-1'), false);
  assert.equal(verifier.registerDelivery('message-2'), true);
});

test('replay protection expires with the delivery window so ids do not accumulate forever', () => {
  let clock = NOW_MS;
  const verifier = createGmailPubSubVerifier({
    audience: AUDIENCE,
    fetchImpl: jwksFetch(),
    now: () => clock,
    replayWindowMs: 1000
  });
  assert.equal(verifier.registerDelivery('message-1'), true);
  clock += 5000;
  assert.equal(verifier.registerDelivery('message-1'), true);
});

test('the JWKS document is cached instead of refetched for every push', async () => {
  let calls = 0;
  const verifier = createGmailPubSubVerifier({
    audience: AUDIENCE,
    serviceAccountEmail: SERVICE_ACCOUNT,
    now: () => NOW_MS,
    fetchImpl: (...args) => { calls += 1; return jwksFetch()(...args); }
  });
  await verifier.verifyToken(makeToken());
  await verifier.verifyToken(makeToken());
  assert.equal(calls, 1);
});

test('an unreachable JWKS endpoint fails closed instead of accepting the push', async () => {
  const verifier = createGmailPubSubVerifier({
    audience: AUDIENCE,
    serviceAccountEmail: SERVICE_ACCOUNT,
    now: () => NOW_MS,
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) })
  });
  await assertRejection(() => verifier.verifyToken(makeToken()), 'pubsub_jwks_unavailable', 503);
});

function buildVerifier() {
  return createGmailPubSubVerifier({
    audience: AUDIENCE,
    serviceAccountEmail: SERVICE_ACCOUNT,
    fetchImpl: jwksFetch(),
    now: () => NOW_MS
  });
}

function jwksFetch() {
  const jwk = trusted.publicKey.export({ format: 'jwk' });
  const document = { keys: [{ ...jwk, kid: 'voyage-test-key', alg: 'RS256', use: 'sig' }] };
  return async () => ({ ok: true, status: 200, json: async () => document });
}

function defaultClaims(overrides = {}) {
  const seconds = Math.floor(NOW_MS / 1000);
  return {
    iss: 'https://accounts.google.com',
    aud: AUDIENCE,
    sub: '123456789',
    email: SERVICE_ACCOUNT,
    email_verified: true,
    iat: seconds - 30,
    exp: seconds + 600,
    ...overrides
  };
}

function makeToken({ privateKey = trusted.privateKey, kid = 'voyage-test-key', claims = {} } = {}) {
  const header = base64url({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = base64url(defaultClaims(claims));
  const signingInput = `${header}.${payload}`;
  const signature = signPayload('sha256', Buffer.from(signingInput, 'utf8'), privateKey);
  return `${signingInput}.${signature.toString('base64url')}`;
}

function base64url(value) {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

async function failingFetch() {
  throw new Error('network_access_must_not_happen');
}

async function assertRejection(operation, expectedCode, expectedStatus) {
  try {
    await operation();
  } catch (error) {
    if (expectedCode instanceof RegExp) assert.match(String(error.code), expectedCode);
    else assert.equal(error.code, expectedCode);
    assert.equal(error.statusCode, expectedStatus);
    return;
  }
  assert.fail(`expected rejection with ${expectedCode}`);
}
