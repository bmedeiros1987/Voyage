import { createPublicKey, verify as verifySignature } from 'node:crypto';

const GOOGLE_JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);
const SUPPORTED_ALGORITHMS = Object.freeze({
  RS256: { name: 'rsa', hash: 'sha256', keyType: 'RSA', options: undefined },
  ES256: { name: 'ec', hash: 'sha256', keyType: 'EC', options: { dsaEncoding: 'ieee-p1363' } }
});
const CLOCK_SKEW_SECONDS = 60;
const JWKS_CACHE_TTL_MS = 60 * 60 * 1000;
const JWKS_FETCH_TIMEOUT_MS = 5000;
const MAX_TOKEN_BYTES = 8 * 1024;
const DEFAULT_REPLAY_WINDOW_MS = 10 * 60 * 1000;
const MAX_REPLAY_ENTRIES = 5000;

/**
 * Verifies the OIDC push token Google Pub/Sub attaches to every push delivery.
 * Nothing is accepted without a signature that chains to Google's JWKS, so an
 * incomplete configuration is a 503 and an unsigned envelope is a 401 — never
 * an accepted notification.
 */
export function createGmailPubSubVerifier({
  audience,
  serviceAccountEmail = null,
  jwksUri = GOOGLE_JWKS_URI,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  jwksCacheTtlMs = JWKS_CACHE_TTL_MS,
  replayWindowMs = DEFAULT_REPLAY_WINDOW_MS
} = {}) {
  const configuredAudience = typeof audience === 'string' ? audience.trim() : '';
  const expectedEmail = typeof serviceAccountEmail === 'string' && serviceAccountEmail.trim()
    ? serviceAccountEmail.trim().toLowerCase()
    : null;
  const jwks = createJwksCache({ jwksUri, fetchImpl, now, ttlMs: jwksCacheTtlMs });
  const seenMessages = new Map();

  return Object.freeze({
    get configured() { return Boolean(configuredAudience); },

    async verifyRequest(req) {
      if (!configuredAudience) throw namedError('gmail_pubsub_not_configured', 503);
      const token = bearerToken(req);
      if (!token) throw namedError('pubsub_authentication_required', 401);
      return this.verifyToken(token);
    },

    async verifyToken(token) {
      if (!configuredAudience) throw namedError('gmail_pubsub_not_configured', 503);
      if (typeof token !== 'string' || Buffer.byteLength(token) > MAX_TOKEN_BYTES) {
        throw namedError('pubsub_token_invalid', 401);
      }

      const { header, claims, signingInput, signature } = decodeJwt(token);
      const algorithm = SUPPORTED_ALGORITHMS[header.alg];
      if (!algorithm) throw namedError('pubsub_token_algorithm_unsupported', 401);
      if (typeof header.kid !== 'string' || !header.kid) throw namedError('pubsub_token_kid_missing', 401);

      if (!GOOGLE_ISSUERS.includes(String(claims.iss))) throw namedError('pubsub_token_issuer_invalid', 401);
      if (String(claims.aud) !== configuredAudience) throw namedError('pubsub_token_audience_invalid', 401);

      const nowSeconds = Math.floor(Number(now()) / 1000);
      if (!Number.isFinite(nowSeconds)) throw namedError('pubsub_clock_invalid', 500);
      if (!Number.isFinite(claims.exp) || claims.exp <= nowSeconds) throw namedError('pubsub_token_expired', 401);
      if (!Number.isFinite(claims.iat) || claims.iat > nowSeconds + CLOCK_SKEW_SECONDS) {
        throw namedError('pubsub_token_not_yet_valid', 401);
      }

      if (expectedEmail) {
        if (String(claims.email || '').toLowerCase() !== expectedEmail) throw namedError('pubsub_token_subject_invalid', 401);
        if (claims.email_verified === false) throw namedError('pubsub_token_subject_invalid', 401);
      }

      const key = await jwks.publicKeyFor(header.kid, algorithm.keyType);
      const verified = verifySignature(
        algorithm.hash,
        Buffer.from(signingInput, 'utf8'),
        { key, ...(algorithm.options || {}) },
        signature
      );
      if (!verified) throw namedError('pubsub_token_signature_invalid', 401);

      return Object.freeze({
        issuer: String(claims.iss),
        audience: String(claims.aud),
        subject: claims.sub ? String(claims.sub) : null,
        email: claims.email ? String(claims.email).toLowerCase() : null,
        expiresAt: claims.exp
      });
    },

    /**
     * Pub/Sub guarantees at-least-once delivery, so a replayed messageId is
     * ignored rather than reprocessed. Returns false when already seen.
     */
    registerDelivery(messageId) {
      if (typeof messageId !== 'string' || !messageId.trim()) return true;
      const key = messageId.trim();
      const currentTime = Number(now());
      pruneReplayWindow(seenMessages, currentTime, replayWindowMs);
      if (seenMessages.has(key)) return false;
      if (seenMessages.size >= MAX_REPLAY_ENTRIES) {
        const oldest = seenMessages.keys().next();
        if (!oldest.done) seenMessages.delete(oldest.value);
      }
      seenMessages.set(key, currentTime);
      return true;
    }
  });
}

export function bearerToken(req) {
  const raw = req?.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

function decodeJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) throw namedError('pubsub_token_invalid', 401);
  const [encodedHeader, encodedClaims, encodedSignature] = parts;
  const header = decodeJsonSegment(encodedHeader);
  const claims = decodeJsonSegment(encodedClaims);
  let signature;
  try { signature = Buffer.from(encodedSignature, 'base64url'); } catch { throw namedError('pubsub_token_invalid', 401); }
  if (!signature.length) throw namedError('pubsub_token_invalid', 401);
  return { header, claims, signingInput: `${encodedHeader}.${encodedClaims}`, signature };
}

function decodeJsonSegment(segment) {
  let parsed;
  try { parsed = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')); }
  catch { throw namedError('pubsub_token_invalid', 401); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw namedError('pubsub_token_invalid', 401);
  return parsed;
}

function createJwksCache({ jwksUri, fetchImpl, now, ttlMs }) {
  let keys = new Map();
  let fetchedAt = 0;
  let inflight = null;

  async function refresh() {
    if (typeof fetchImpl !== 'function') throw namedError('pubsub_jwks_unavailable', 503);
    if (inflight) return inflight;
    inflight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), JWKS_FETCH_TIMEOUT_MS);
      try {
        const response = await fetchImpl(jwksUri, { signal: controller.signal, headers: { accept: 'application/json' } });
        if (!response?.ok) throw namedError('pubsub_jwks_unavailable', 503);
        const document = await response.json();
        const entries = Array.isArray(document?.keys) ? document.keys : [];
        if (!entries.length) throw namedError('pubsub_jwks_unavailable', 503);
        const next = new Map();
        for (const jwk of entries) {
          if (jwk && typeof jwk.kid === 'string') next.set(jwk.kid, jwk);
        }
        keys = next;
        fetchedAt = Number(now());
      } finally {
        clearTimeout(timer);
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async publicKeyFor(kid, expectedKeyType) {
      const stale = Number(now()) - fetchedAt > ttlMs;
      if (stale || !keys.has(kid)) await refresh();
      const jwk = keys.get(kid);
      if (!jwk) throw namedError('pubsub_token_key_unknown', 401);
      if (expectedKeyType && jwk.kty !== expectedKeyType) throw namedError('pubsub_token_key_unknown', 401);
      try { return createPublicKey({ key: jwk, format: 'jwk' }); }
      catch { throw namedError('pubsub_token_key_unknown', 401); }
    }
  };
}

function pruneReplayWindow(seen, currentTime, windowMs) {
  for (const [key, seenAt] of seen) {
    if (currentTime - seenAt <= windowMs) break;
    seen.delete(key);
  }
}

function namedError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
