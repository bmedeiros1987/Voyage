import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

// Opaque, HMAC-signed session tokens. The signing key never leaves the server and
// is never embedded in any client payload.

const DEFAULT_TTL_SECONDS = 60 * 60 * 12;
const TOKEN_VERSION = 'v1';

// Endpoints reachable without a session. Anything not listed here is private.
// Keep this list explicit — a route must be deliberately made public.
export const PUBLIC_ENDPOINTS = Object.freeze([
  '/health',
  '/api/v1/config',
  '/api/v1/auth/google/status',
  '/api/v1/auth/session',
  '/api/v1/integrations/gmail/pubsub'
]);

const PUBLIC_SUFFIXES = Object.freeze(['/capabilities']);

export function sessionCapabilities() {
  return Object.freeze({
    version: '1.0',
    tokenType: 'OPAQUE_HMAC_SIGNED',
    defaultTtlSeconds: DEFAULT_TTL_SECONDS,
    publicEndpoints: PUBLIC_ENDPOINTS,
    publicSuffixes: PUBLIC_SUFFIXES,
    principles: [
      'Every endpoint is private unless it appears in an explicit public allowlist.',
      'Session tokens are opaque and integrity-protected; no secret is ever sent to the client.',
      'Cookies are HttpOnly, Secure, SameSite=Lax and scoped to the app path.'
    ]
  });
}

export function isPublicEndpoint(path, method = 'GET') {
  const normalized = String(path || '').replace(/\/+$/, '') || '/';
  if (normalized === '/' ) return true;
  if (PUBLIC_ENDPOINTS.includes(normalized)) return true;
  // Static shell assets stay public; they contain no user data.
  if (method === 'GET' && /\.(html|css|js|webmanifest|svg|png|ico)$/.test(normalized)) return true;
  if (method === 'GET' && PUBLIC_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return true;
  return false;
}

export function createSession({ globalUserId, signingKey, ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() } = {}) {
  if (!globalUserId) throw namedError('session_global_user_id_required', 400);
  if (!signingKey) throw namedError('session_signing_key_missing', 500);

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.max(60, Number(ttlSeconds) || DEFAULT_TTL_SECONDS);
  const nonce = randomBytes(16).toString('hex');
  const payload = `${TOKEN_VERSION}.${encode(globalUserId)}.${issuedAt}.${expiresAt}.${nonce}`;
  return Object.freeze({
    token: `${payload}.${sign(payload, signingKey)}`,
    globalUserId,
    issuedAt,
    expiresAt
  });
}

export function verifySession(token, { signingKey, now = Date.now() } = {}) {
  if (!token || !signingKey) return Object.freeze({ valid: false, reason: 'SESSION_MISSING' });
  const parts = String(token).split('.');
  if (parts.length !== 6) return Object.freeze({ valid: false, reason: 'SESSION_MALFORMED' });

  const [version, encodedUser, issuedAt, expiresAt, nonce, signature] = parts;
  if (version !== TOKEN_VERSION) return Object.freeze({ valid: false, reason: 'SESSION_VERSION_UNSUPPORTED' });

  const payload = `${version}.${encodedUser}.${issuedAt}.${expiresAt}.${nonce}`;
  if (!safeEqual(signature, sign(payload, signingKey))) {
    return Object.freeze({ valid: false, reason: 'SESSION_SIGNATURE_INVALID' });
  }
  if (Number(expiresAt) * 1000 <= now) {
    return Object.freeze({ valid: false, reason: 'SESSION_EXPIRED' });
  }
  return Object.freeze({
    valid: true,
    reason: null,
    globalUserId: decode(encodedUser),
    issuedAt: Number(issuedAt),
    expiresAt: Number(expiresAt)
  });
}

export function sessionCookie(token, { expiresAt, secure = true } = {}) {
  const attributes = [
    `voyage_session=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.max(0, Number(expiresAt) - Math.floor(Date.now() / 1000))}`
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function readSessionToken(req) {
  const authorization = String(req?.headers?.authorization || '');
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim();
  const cookie = String(req?.headers?.cookie || '');
  const match = cookie.match(/(?:^|;\s*)voyage_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Request-level gate used by the server before dispatching to any route.
export function authenticateRequest(req, path, { signingKey, now = Date.now() } = {}) {
  if (isPublicEndpoint(path, req?.method)) {
    return Object.freeze({ allowed: true, public: true, session: null });
  }
  const verified = verifySession(readSessionToken(req), { signingKey, now });
  if (!verified.valid) {
    return Object.freeze({ allowed: false, public: false, session: null, reason: verified.reason });
  }
  return Object.freeze({ allowed: true, public: false, session: verified });
}

function sign(payload, signingKey) {
  return createHmac('sha256', signingKey).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function encode(value) { return Buffer.from(String(value), 'utf8').toString('base64url'); }
function decode(value) { return Buffer.from(String(value), 'base64url').toString('utf8'); }

function namedError(message, statusCode) {
  const error = new Error(message);
  error.code = message;
  error.statusCode = statusCode;
  return error;
}
