import test from 'node:test';
import assert from 'node:assert/strict';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../src/token-crypto.mjs';

const KEY = Buffer.alloc(32, 7).toString('base64url');

test('refresh token encryption round-trips with AES-256-GCM', () => {
  const encrypted = encryptSecret('refresh-token-secret', KEY, { keyVersion: 'k1' });
  assert.equal(encrypted.algorithm, 'aes-256-gcm');
  assert.equal(encrypted.keyVersion, 'k1');
  assert.notEqual(encrypted.value.includes('refresh-token-secret'), true);
  assert.equal(decryptSecret(encrypted, KEY), 'refresh-token-secret');
});

test('tampered encrypted token fails authentication', () => {
  const encrypted = encryptSecret('refresh-token-secret', KEY);
  const parts = encrypted.value.split('.');
  const bytes = Buffer.from(parts[2], 'base64url');
  bytes[0] ^= 1;
  parts[2] = bytes.toString('base64url');
  assert.throws(() => decryptSecret(parts.join('.'), KEY), /secret_authentication_failed/);
});

test('encryption key must be exactly 32 bytes', () => {
  assert.equal(parseEncryptionKey('11'.repeat(32)).length, 32);
  assert.throws(() => parseEncryptionKey(Buffer.alloc(16).toString('base64')), /32_bytes/);
});
