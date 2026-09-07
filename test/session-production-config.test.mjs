import test from 'node:test';
import assert from 'node:assert/strict';
import { getRuntimeConfig } from '../src/config.mjs';

test('production fails closed when SESSION_SIGNING_KEY is missing', () => {
  assert.throws(
    () => getRuntimeConfig({ NODE_ENV: 'production' }),
    /session_signing_key_required/
  );
});

test('production fails closed when SESSION_SIGNING_KEY is shorter than 32 characters', () => {
  assert.throws(
    () => getRuntimeConfig({ NODE_ENV: 'production', SESSION_SIGNING_KEY: 'too-short' }),
    /session_signing_key_required/
  );
});

test('production accepts a stable SESSION_SIGNING_KEY with at least 32 characters', () => {
  const config = getRuntimeConfig({
    NODE_ENV: 'production',
    SESSION_SIGNING_KEY: '0123456789abcdef0123456789abcdef'
  });
  assert.equal(config.session.configured, true);
  assert.equal(config.session.signingKey, '0123456789abcdef0123456789abcdef');
});
