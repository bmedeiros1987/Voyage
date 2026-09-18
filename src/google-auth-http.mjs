import { createHash, timingSafeEqual } from 'node:crypto';
import { buildGoogleAuthorizationUrl, createSignedOAuthState, exchangeGoogleAuthorizationCode, verifySignedOAuthState } from './google-oauth.mjs';
import { createSessionToken, persistIssuedSession } from './auth-session.mjs';
import { encryptSecret } from './token-crypto.mjs';

const START_PATH = '/api/v1/auth/google/start';
const CALLBACK_PATH = '/api/v1/auth/google/callback';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const CONSENT_POLICY_VERSION = '2026-09';
const STATE_COOKIE = 'voyage_oauth_state';
const STATE_TTL_SECONDS = 600;

export async function handleGoogleAuthHttp(req, res, path, { config, persistence, fetchImpl = fetch } = {}) {
  if (req?.method !== 'GET' || (path !== START_PATH && path !== CALLBACK_PATH)) return false;
  requireRuntime(config, persistence);
  if (config.nodeEnv === 'production') {
    const app = new URL(config.appUrl); const callback = new URL(config.google.redirectUri);
    if (app.protocol !== 'https:' || callback.origin !== app.origin || callback.pathname !== CALLBACK_PATH || app.username || app.password || callback.username || callback.password) throw namedError('google_oauth_origin_invalid', 503);
  }

  if (path === START_PATH) {
    const requestUrl = new URL(req.url, 'http://localhost');
    const purpose = normalizePurpose(requestUrl.searchParams.get('purpose'));
    if (purpose === 'gmail' && !config.google.gmailConfigured) throw namedError('google_oauth_not_configured', 503);

    const state = createSignedOAuthState({ purpose }, config.session.signingKey, { ttlSeconds: STATE_TTL_SECONDS });
    setStateCookie(res, [...pendingStates(req).slice(-3), fingerprintState(state)].join('.'));
    const authorizationUrl = buildGoogleAuthorizationUrl({
      clientId: config.google.clientId,
      redirectUri: config.google.redirectUri,
      state,
      purpose,
      forceConsent: purpose === 'gmail'
    });
    redirect(res, authorizationUrl);
    return true;
  }

  const requestUrl = new URL(req.url, 'http://localhost');
  const state = requestUrl.searchParams.get('state');
  verifyBrowserState(req, state);
  const remainingStates = pendingStates(req).filter(value => value !== fingerprintState(state));
  if (remainingStates.length) setStateCookie(res, remainingStates.join('.'));
  else clearStateCookie(res);

  const providerError = requestUrl.searchParams.get('error');
  if (providerError) {
    redirect(res, appReturnUrl(config.appUrl, { oauth_error: safeProviderError(providerError) }));
    return true;
  }

  const code = requestUrl.searchParams.get('code');
  if (!code) throw namedError('oauth_code_required');
  const statePayload = verifySignedOAuthState(state, config.session.signingKey);
  const purpose = normalizePurpose(statePayload.purpose);
  if (purpose === 'gmail' && config.google.gmailRuntimeEnabled === false) throw namedError('gmail_unavailable', 503);

  const tokens = await exchangeGoogleAuthorizationCode({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
    code,
    fetchImpl
  });
  const profile = await fetchGoogleUserInfo(tokens.accessToken, { fetchImpl });
  const identity = await persistence.upsertGoogleIdentity({
    googleSubject: profile.sub,
    email: profile.email || null,
    emailVerified: profile.email_verified === true,
    displayName: profile.name || null,
    avatarUrl: profile.picture || null
  });

  let gmailConnected = false;
  if (purpose === 'gmail') {
    if (!tokens.scope.includes(GMAIL_SCOPE)) throw namedError('gmail_scope_not_granted', 403);
    const encrypted = tokens.refreshToken
      ? encryptSecret(tokens.refreshToken, config.google.tokenEncryptionKey, { keyVersion: config.google.tokenKeyVersion })
      : null;
    await persistence.upsertGoogleConnection({
      userId: identity.userId,
      googleSubject: profile.sub,
      encryptedRefreshToken: encrypted?.value || null,
      tokenKeyVersion: encrypted?.keyVersion || null,
      grantedScopes: tokens.scope
    });
    await persistence.recordOAuthConsent({
      userId: identity.userId,
      provider: 'GOOGLE',
      purpose: 'GMAIL_TRAVEL_IMPORT',
      scopes: tokens.scope,
      policyVersion: CONSENT_POLICY_VERSION
    });
    gmailConnected = true;
  }

  const sessionToken = createSessionToken({ userId: identity.userId }, config.session.signingKey);
  await persistIssuedSession({ token: sessionToken, persistence });
  redirect(res, appReturnUrl(config.appUrl, {
    voyage_session: sessionToken,
    ...(gmailConnected ? { gmail: 'connected' } : { login: 'connected' })
  }));
  return true;
}

export async function fetchGoogleUserInfo(accessToken, { fetchImpl = fetch } = {}) {
  if (!accessToken) throw namedError('google_access_token_required');
  const response = await fetchImpl(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  let payload = {};
  try { payload = await response.json(); } catch { payload = {}; }
  if (!response.ok) throw namedError(`google_userinfo_${response.status}`, response.status >= 500 ? 502 : 400);
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw namedError('google_userinfo_subject_required', 502);
  return Object.freeze(payload);
}

function requireRuntime(config, persistence) {
  if (!config?.session?.signingKey || !config?.google?.clientId || !config?.google?.clientSecret || !config?.google?.redirectUri) {
    throw namedError('google_oauth_not_configured', 503);
  }
  if (!persistence || typeof persistence.upsertGoogleIdentity !== 'function' || typeof persistence.putSession !== 'function') {
    throw namedError('production_persistence_required', 503);
  }
}

function normalizePurpose(value) {
  return String(value || 'login').toLowerCase() === 'gmail' ? 'gmail' : 'login';
}

function appReturnUrl(appUrl, fragment = {}) {
  const url = new URL(appUrl);
  url.hash = new URLSearchParams(fragment).toString();
  return url.toString();
}

function fingerprintState(state) {
  return createHash('sha256').update(String(state || '')).digest('base64url');
}

function verifyBrowserState(req, state) {
  if (typeof state !== 'string' || !state) throw namedError('oauth_state_required');
  const actual = fingerprintState(state);
  const right = Buffer.from(actual);
  if (!pendingStates(req).some(expected => timingSafeEqual(Buffer.from(expected), right))) throw namedError('oauth_state_browser_mismatch', 400);
}

function pendingStates(req) {
  return (readCookie(req, STATE_COOKIE) || '').split('.').filter(value => /^[A-Za-z0-9_-]{43}$/.test(value)).slice(-4);
}

function readCookie(req, name) {
  const raw = Array.isArray(req?.headers?.cookie) ? req.headers.cookie[0] : req?.headers?.cookie;
  if (typeof raw !== 'string') return null;
  for (const pair of raw.split(';')) {
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const key = pair.slice(0, index).trim();
    if (key !== name) continue;
    try { return decodeURIComponent(pair.slice(index + 1).trim()); } catch { return null; }
  }
  return null;
}

function setStateCookie(res, value) {
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/api/v1/auth/google; Max-Age=${STATE_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`);
}

function clearStateCookie(res) {
  res.setHeader('Set-Cookie', `${STATE_COOKIE}=; Path=/api/v1/auth/google; Max-Age=0; HttpOnly; Secure; SameSite=Lax`);
}

function safeProviderError(value) {
  const normalized = String(value || 'access_denied').toLowerCase();
  return /^[a-z0-9_.-]{1,80}$/.test(normalized) ? normalized : 'access_denied';
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader('Location', String(location));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.end();
}

function namedError(code, statusCode = 400) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
