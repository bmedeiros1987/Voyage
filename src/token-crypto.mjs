import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function encryptSecret(plaintext, keyInput, { keyVersion = 'v1', aad = 'voyage-oauth-token' } = {}) {
  if (!plaintext) throw new Error('secret_plaintext_required');
  const key = parseEncryptionKey(keyInput);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(String(aad), 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Object.freeze({
    algorithm: ALGORITHM,
    keyVersion: String(keyVersion),
    value: [String(keyVersion), iv.toString('base64url'), ciphertext.toString('base64url'), tag.toString('base64url')].join('.')
  });
}

export function decryptSecret(envelope, keyInput, { aad = 'voyage-oauth-token' } = {}) {
  const value = typeof envelope === 'string' ? envelope : envelope?.value;
  if (!value) throw new Error('secret_envelope_required');
  const [keyVersion, ivEncoded, ciphertextEncoded, tagEncoded, ...extra] = String(value).split('.');
  if (!keyVersion || !ivEncoded || !ciphertextEncoded || !tagEncoded || extra.length) throw new Error('secret_envelope_invalid');
  const key = parseEncryptionKey(keyInput);
  const iv = Buffer.from(ivEncoded, 'base64url');
  const ciphertext = Buffer.from(ciphertextEncoded, 'base64url');
  const tag = Buffer.from(tagEncoded, 'base64url');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('secret_envelope_invalid');
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(String(aad), 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('secret_authentication_failed');
  }
}

export function parseEncryptionKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('token_encryption_key_required');
  const normalized = value.trim();
  let key;
  if (/^[0-9a-f]{64}$/i.test(normalized)) key = Buffer.from(normalized, 'hex');
  else {
    try { key = Buffer.from(normalized.replace(/-/g, '+').replace(/_/g, '/'), 'base64'); } catch { key = Buffer.alloc(0); }
  }
  if (key.length !== 32) throw new Error('token_encryption_key_must_be_32_bytes');
  return key;
}
