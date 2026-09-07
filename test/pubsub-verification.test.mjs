import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPubSubPushRequest } from '../src/pubsub-verification.mjs';

const AUDIENCE = 'https://voyage.test/api/v1/integrations/gmail/pubsub';
const SERVICE_ACCOUNT = 'pubsub@voyage.iam.gserviceaccount.test';
const ok = async () => true;

function tokenFor(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.sig`;
}
const validClaims = {
  iss: 'https://accounts.google.com', aud: AUDIENCE,
  email: SERVICE_ACCOUNT, email_verified: true, exp: Math.floor(Date.now() / 1000) + 600
};
const req = (token) => ({ headers: token ? { authorization: `Bearer ${token}` } : {} });
const config = { audience: AUDIENCE, serviceAccountEmail: SERVICE_ACCOUNT, verifySignature: ok };

test('an unconfigured deployment fails closed', async () => {
  const result = await verifyPubSubPushRequest(req(tokenFor(validClaims)), {});
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'PUBSUB_VERIFICATION_NOT_CONFIGURED');
  assert.equal(result.statusCode, 503);
});

test('a push with no bearer token is rejected', async () => {
  const result = await verifyPubSubPushRequest(req(null), config);
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'PUBSUB_TOKEN_MISSING');
});

test('a forged issuer, audience or service account is rejected', async () => {
  const cases = [
    [{ ...validClaims, iss: 'https://evil.test' }, 'PUBSUB_ISSUER_INVALID'],
    [{ ...validClaims, aud: 'https://evil.test/hook' }, 'PUBSUB_AUDIENCE_MISMATCH'],
    [{ ...validClaims, email: 'attacker@evil.test' }, 'PUBSUB_SERVICE_ACCOUNT_MISMATCH'],
    [{ ...validClaims, email_verified: false }, 'PUBSUB_SERVICE_ACCOUNT_UNVERIFIED'],
    [{ ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 }, 'PUBSUB_TOKEN_EXPIRED']
  ];
  for (const [claims, reason] of cases) {
    const result = await verifyPubSubPushRequest(req(tokenFor(claims)), config);
    assert.equal(result.verified, false);
    assert.equal(result.reason, reason);
  }
});

test('a bad signature is rejected even when every claim looks right', async () => {
  const result = await verifyPubSubPushRequest(req(tokenFor(validClaims)), {
    ...config, verifySignature: async () => false
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'PUBSUB_SIGNATURE_INVALID');
});

test('a fully valid push verifies', async () => {
  const result = await verifyPubSubPushRequest(req(tokenFor(validClaims)), config);
  assert.equal(result.verified, true);
  assert.equal(result.serviceAccount, SERVICE_ACCOUNT);
});
