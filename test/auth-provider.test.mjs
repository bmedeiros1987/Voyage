import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GMAIL_IMPORT_SCOPES, GOOGLE_LOGIN_SCOPES, evaluateAccountLink, normalizeProviderIdentity
} from '../src/auth-provider.mjs';

test('Google Login requests only openid/email/profile and never Gmail scopes', () => {
  assert.deepEqual(GOOGLE_LOGIN_SCOPES, ['openid', 'email', 'profile']);
  for (const scope of GMAIL_IMPORT_SCOPES) {
    assert.equal(GOOGLE_LOGIN_SCOPES.includes(scope), false);
  }
});

test('a login carrying a Gmail scope is rejected outright', () => {
  const result = evaluateAccountLink({
    existingIdentity: null,
    incoming: {
      provider: 'GOOGLE', subject: 'sub-1', email: 'a@example.test', emailVerified: true,
      grantedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']
    }
  });
  assert.equal(result.decision, 'REJECT');
  assert.equal(result.reason, 'GMAIL_SCOPE_MUST_NOT_RIDE_ON_LOGIN');
});

test('a matching verified email alone never links two identities', () => {
  const result = evaluateAccountLink({
    existingIdentity: { provider: 'PASSWORD', subject: 'local-1', email: 'shared@example.test' },
    incoming: { provider: 'GOOGLE', subject: 'google-9', email: 'shared@example.test', emailVerified: true }
  });
  assert.equal(result.linked, false);
  assert.equal(result.decision, 'REQUIRE_EXPLICIT_CONFIRMATION');
  assert.equal(result.reason, 'EMAIL_ALONE_IS_NOT_PROOF');
});

test('an unverified matching email is even weaker evidence', () => {
  const result = evaluateAccountLink({
    existingIdentity: { provider: 'PASSWORD', subject: 'local-1', email: 'shared@example.test' },
    incoming: { provider: 'GOOGLE', subject: 'google-9', email: 'shared@example.test', emailVerified: false }
  });
  assert.equal(result.linked, false);
  assert.equal(result.reason, 'EMAIL_NOT_VERIFIED_BY_PROVIDER');
});

test('verified email plus explicit confirmation links', () => {
  const result = evaluateAccountLink({
    existingIdentity: { provider: 'PASSWORD', subject: 'local-1', email: 'shared@example.test' },
    incoming: { provider: 'GOOGLE', subject: 'google-9', email: 'shared@example.test', emailVerified: true },
    userConfirmedLink: true
  });
  assert.equal(result.linked, true);
  assert.equal(result.reason, 'VERIFIED_EMAIL_PLUS_EXPLICIT_CONFIRMATION');
});

test('a matching provider subject links without needing the email at all', () => {
  const result = evaluateAccountLink({
    existingIdentity: { provider: 'GOOGLE', subject: 'google-9', email: null },
    incoming: { provider: 'GOOGLE', subject: 'google-9', email: null }
  });
  assert.equal(result.linked, true);
  assert.equal(result.reason, 'VERIFIED_PROVIDER_SUBJECT_MATCH');
});

test('authentication is provider-agnostic', () => {
  for (const provider of ['PASSWORD', 'APPLE', 'CREWCHECK_SSO']) {
    assert.equal(normalizeProviderIdentity({ provider, subject: 's' }).provider, provider);
  }
  assert.equal(normalizeProviderIdentity({ provider: 'MYSTERY', subject: 's' }), null);
});
