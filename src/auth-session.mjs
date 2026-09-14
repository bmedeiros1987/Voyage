import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { newSessionRecord } from './persistence.mjs';

const TOKEN_VERSION = 'v1';
const MIN_TTL_SECONDS = 300;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

export function createSessionToken({ userId, sessionId = randomUUID(), issuedAt = Date.now(), ttlSeconds = 60 * 60 * 24 * 7 } = {}, secret) {
  requireSecret(secret);
  requireIdentifier(userId, 'session_user_id_required');
  requireIdentifier(sessionId, 'session_id_required');
  const ttl = clampTtl(ttlSeconds);
  const iat = Math.floor(Number(issuedAt) / 1000);
  if (!Number.isFinite(iat) || iat <= 0) throw namedError('session_issued_at_invalid');
  const payload = Object.freeze({ v: TOKEN_VERSION, sid: String(sessionId), sub: String(userId), iat, exp: iat + ttl });
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${TOKEN_VERSION}.${encoded}.${sign(`${TOKEN_VERSION}.${encoded}`, secret)}`;
}

export function verifySessionToken(token, secret, { now = Date.now() } = {}) {
  requireSecret(secret);
  if (typeof token !== 'string' || !token.trim()) throw namedError('session_token_required');
  const [version, encoded, providedSignature, ...extra] = token.trim().split('.');
  if (version !== TOKEN_VERSION || !encoded || !providedSignature || extra.length) throw namedError('session_token_invalid');
  const signed = `${version}.${encoded}`;
  const expectedSignature = sign(signed, secret);
  if (!safeEqual(providedSignature, expectedSignature)) throw namedError('session_token_invalid');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw namedError('session_token_invalid'); }
  requireIdentifier(payload?.sub, 'session_token_invalid');
  requireIdentifier(payload?.sid, 'session_token_invalid');
  if (payload?.v !== TOKEN_VERSION) throw namedError('session_token_invalid');
  const nowSeconds = Math.floor(Number(now) / 1000);
  if (!Number.isFinite(nowSeconds)) throw namedError('session_clock_invalid');
  if (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 60) throw namedError('session_token_invalid');
  if (!Number.isFinite(payload.exp) || payload.exp <= nowSeconds) throw namedError('session_token_expired');
  return Object.freeze({ userId: payload.sub, sessionId: payload.sid, issuedAt: payload.iat, expiresAt: payload.exp });
}

export function sessionTokenFingerprint(token) {
  if (typeof token !== 'string' || !token.trim()) throw namedError('session_token_required');
  return createHash('sha256').update(token.trim()).digest('hex');
}

export async function persistIssuedSession({ token, persistence } = {}) {
  requirePersistence(persistence);
  const decoded = decodeUnsignedClaims(token);
  const record = newSessionRecord({
    userId: decoded.userId,
    sessionId: decoded.sessionId,
    tokenFingerprint: sessionTokenFingerprint(token),
    issuedAt: decoded.issuedAt * 1000,
    expiresAt: decoded.expiresAt * 1000
  });
  await persistence.putSession(record);
  return record;
}

export async function authenticatePersistedSession(req, secret, persistence, { now = Date.now() } = {}) {
  requirePersistence(persistence);
  const token = bearerTokenFromRequest(req);
  if (!token) throw namedError('authentication_required', 401);
  let verified;
  try { verified = verifySessionToken(token, secret, { now }); }
  catch (error) {
    if (error?.message === 'session_token_expired') throw namedError('session_expired', 401);
    throw namedError('authentication_invalid', 401);
  }
  const stored = await persistence.getSession(verified.sessionId);
  if (!stored || stored.userId !== verified.userId) throw namedError('session_not_found', 401);
  if (stored.revokedAt) throw namedError('session_revoked', 401);
  if (new Date(stored.expiresAt).getTime() <= Number(now)) throw namedError('session_expired', 401);
  if (!safeEqual(stored.tokenFingerprint, sessionTokenFingerprint(token))) throw namedError('authentication_invalid', 401);
  return Object.freeze({ userId: verified.userId, sessionId: verified.sessionId, permissions: [] });
}

export function bearerTokenFromRequest(req) {
  const raw = req?.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function requireAuthenticatedSession(req, secret, options) {
  const token = bearerTokenFromRequest(req);
  if (!token) throw namedError('authentication_required', 401);
  try { return verifySessionToken(token, secret, options); }
  catch (error) {
    if (error?.message === 'session_token_expired') throw namedError('session_expired', 401);
    throw namedError('authentication_invalid', 401);
  }
}

function decodeUnsignedClaims(token) {
  if (typeof token !== 'string' || !token.trim()) throw namedError('session_token_required');
  const [version, encoded, signature, ...extra] = token.trim().split('.');
  if (version !== TOKEN_VERSION || !encoded || !signature || extra.length) throw namedError('session_token_invalid');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw namedError('session_token_invalid'); }
  requireIdentifier(payload?.sub, 'session_token_invalid');
  requireIdentifier(payload?.sid, 'session_token_invalid');
  if (!Number.isFinite(payload?.iat) || !Number.isFinite(payload?.exp)) throw namedError('session_token_invalid');
  return { userId: payload.sub, sessionId: payload.sid, issuedAt: payload.iat, expiresAt: payload.exp };
}
function sign(value, secret) { return createHmac('sha256', secret).update(value).digest('base64url'); }
function safeEqual(a, b) { const left = Buffer.from(String(a)); const right = Buffer.from(String(b)); return left.length === right.length && timingSafeEqual(left, right); }
function clampTtl(value) { const parsed = Math.floor(Number(value)); if (!Number.isFinite(parsed)) return 60 * 60 * 24 * 7; return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, parsed)); }
function requireSecret(secret) { if (typeof secret !== 'string' || secret.trim().length < 32) throw namedError('session_signing_key_required'); }
function requireIdentifier(value, code) { if (typeof value !== 'string' || !value.trim() || value.length > 160) throw namedError(code); }
function requirePersistence(persistence) { if (!persistence || typeof persistence.putSession !== 'function' || typeof persistence.getSession !== 'function') throw namedError('session_persistence_required', 500); }
function namedError(code, statusCode = 400) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }
