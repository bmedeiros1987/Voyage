import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const LOGIN_SCOPES = ['openid', 'email', 'profile'];
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

export function buildGoogleAuthorizationUrl({ clientId, redirectUri, state, purpose = 'login', loginHint = null, forceConsent = false } = {}) {
  requireString(clientId, 'google_client_id_required');
  requireHttpsOrLocalhost(redirectUri, 'google_redirect_uri_invalid');
  requireString(state, 'oauth_state_required');
  const scopes = purpose === 'gmail' ? [...LOGIN_SCOPES, GMAIL_SCOPE] : LOGIN_SCOPES;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    state,
    include_granted_scopes: 'true'
  });
  if (purpose === 'gmail') {
    params.set('access_type', 'offline');
    params.set('prompt', forceConsent ? 'consent' : 'select_account');
  }
  if (loginHint) params.set('login_hint', String(loginHint));
  return `${AUTH_ENDPOINT}?${params}`;
}

export async function exchangeGoogleAuthorizationCode({ clientId, clientSecret, redirectUri, code, fetchImpl = fetch } = {}) {
  requireString(clientId, 'google_client_id_required');
  requireString(clientSecret, 'google_client_secret_required');
  requireHttpsOrLocalhost(redirectUri, 'google_redirect_uri_invalid');
  requireString(code, 'oauth_code_required');
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: 'authorization_code'
  }, fetchImpl);
}

export async function refreshGoogleAccessToken({ clientId, clientSecret, refreshToken, fetchImpl = fetch } = {}) {
  requireString(clientId, 'google_client_id_required');
  requireString(clientSecret, 'google_client_secret_required');
  requireString(refreshToken, 'google_refresh_token_required');
  return tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token'
  }, fetchImpl);
}

export async function revokeGoogleToken(token, { fetchImpl = fetch } = {}) {
  requireString(token, 'google_token_required');
  const response = await fetchImpl(REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ token })
  });
  if (!response.ok) {
    const error = new Error(`google_revoke_${response.status}`);
    error.status = response.status;
    throw error;
  }
  return true;
}

export function createSignedOAuthState(payload = {}, secret, { ttlSeconds = 600, now = Date.now() } = {}) {
  requireString(secret, 'oauth_state_secret_required');
  const body = {
    ...payload,
    nonce: randomBytes(18).toString('base64url'),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + Math.max(60, Math.min(1800, Number(ttlSeconds) || 600))
  };
  const encoded = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifySignedOAuthState(state, secret, { now = Date.now() } = {}) {
  requireString(state, 'oauth_state_required');
  requireString(secret, 'oauth_state_secret_required');
  const [encoded, providedSignature, ...extra] = state.split('.');
  if (!encoded || !providedSignature || extra.length) throw new Error('oauth_state_invalid');
  const expectedSignature = createHmac('sha256', secret).update(encoded).digest('base64url');
  const provided = Buffer.from(providedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new Error('oauth_state_signature_invalid');
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw new Error('oauth_state_invalid'); }
  const nowSeconds = Math.floor(now / 1000);
  if (!Number.isFinite(payload.exp) || payload.exp < nowSeconds) throw new Error('oauth_state_expired');
  if (!Number.isFinite(payload.iat) || payload.iat > nowSeconds + 60) throw new Error('oauth_state_invalid');
  return Object.freeze(payload);
}

export function googleScopesForPurpose(purpose) {
  return Object.freeze(purpose === 'gmail' ? [...LOGIN_SCOPES, GMAIL_SCOPE] : [...LOGIN_SCOPES]);
}

async function tokenRequest(parameters, fetchImpl) {
  const response = await fetchImpl(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(parameters)
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) {
    const error = new Error(`google_token_${response.status}`);
    error.status = response.status;
    error.code = payload.error || 'GOOGLE_TOKEN_ERROR';
    error.details = payload.error_description || null;
    throw error;
  }
  return Object.freeze({
    accessToken: payload.access_token || null,
    refreshToken: payload.refresh_token || null,
    expiresIn: Number(payload.expires_in || 0),
    scope: String(payload.scope || '').split(/\s+/).filter(Boolean),
    tokenType: payload.token_type || null,
    idToken: payload.id_token || null
  });
}

function requireString(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
}

function requireHttpsOrLocalhost(value, code) {
  requireString(value, code);
  let url;
  try { url = new URL(value); } catch { throw new Error(code); }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error(code);
}
