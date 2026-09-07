// Provider-agnostic authentication. Google Login is the first concrete provider
// but nothing here depends on Google: a provider supplies a (providerId, subject)
// pair plus optional verified claims, and the identity layer decides linking.

export const SUPPORTED_PROVIDERS = Object.freeze(['PASSWORD', 'GOOGLE', 'APPLE', 'CREWCHECK_SSO']);

// Google Login stays minimal and strictly separate from Gmail authorization.
export const GOOGLE_LOGIN_SCOPES = Object.freeze(['openid', 'email', 'profile']);
export const GMAIL_IMPORT_SCOPES = Object.freeze(['https://www.googleapis.com/auth/gmail.readonly']);

export function authProviderCapabilities() {
  return Object.freeze({
    version: '1.0',
    providers: SUPPORTED_PROVIDERS,
    googleLoginScopes: GOOGLE_LOGIN_SCOPES,
    gmailImportScopes: GMAIL_IMPORT_SCOPES,
    principles: [
      'Authentication is provider-agnostic; Google is one provider, never the model.',
      'Google Login (openid email profile) and Gmail authorization are separate grants, separately revocable.',
      'An email address alone is never sufficient evidence to link two identities.',
      'Account linking requires a verified provider subject plus an explicit, authenticated confirmation.'
    ]
  });
}

export function normalizeProviderIdentity(input = {}) {
  const provider = SUPPORTED_PROVIDERS.includes(String(input.provider || '').toUpperCase())
    ? String(input.provider).toUpperCase()
    : null;
  const subject = input.subject ? String(input.subject).slice(0, 190) : null;
  if (!provider || !subject) return null;

  return Object.freeze({
    provider,
    subject,
    email: input.email ? String(input.email).toLowerCase().slice(0, 254) : null,
    emailVerified: input.emailVerified === true,
    displayName: input.displayName ? String(input.displayName).slice(0, 120) : null,
    // Gmail read access is a separate grant and must never arrive via the login flow.
    grantedScopes: Object.freeze((Array.isArray(input.grantedScopes) ? input.grantedScopes : [])
      .map((scope) => String(scope)).slice(0, 20))
  });
}

export function assertLoginScopeSeparation(identity) {
  const scopes = identity?.grantedScopes || [];
  const gmailInLogin = scopes.some((scope) => GMAIL_IMPORT_SCOPES.includes(scope));
  return Object.freeze({
    ok: !gmailInLogin,
    reason: gmailInLogin ? 'GMAIL_SCOPE_MUST_NOT_RIDE_ON_LOGIN' : null
  });
}

// Linking decision. Email matching is a *hint*, never proof: a provider that does
// not verify the address, or a bare address with no verified subject, can be
// spoofed into taking over an existing account.
export function evaluateAccountLink({ existingIdentity = null, incoming = null, userConfirmedLink = false } = {}) {
  const candidate = incoming && incoming.provider ? incoming : normalizeProviderIdentity(incoming || {});
  if (!candidate) {
    return Object.freeze({ decision: 'REJECT', reason: 'INVALID_PROVIDER_IDENTITY', linked: false });
  }

  const scopeCheck = assertLoginScopeSeparation(candidate);
  if (!scopeCheck.ok) {
    return Object.freeze({ decision: 'REJECT', reason: scopeCheck.reason, linked: false });
  }

  if (!existingIdentity) {
    return Object.freeze({ decision: 'CREATE_NEW_IDENTITY', reason: null, linked: false });
  }

  const sameSubject = existingIdentity.provider === candidate.provider
    && existingIdentity.subject === candidate.subject;
  if (sameSubject) {
    return Object.freeze({ decision: 'LINK', reason: 'VERIFIED_PROVIDER_SUBJECT_MATCH', linked: true });
  }

  const emailMatches = Boolean(candidate.email)
    && candidate.email === existingIdentity.email;

  if (emailMatches && candidate.emailVerified && userConfirmedLink === true) {
    return Object.freeze({ decision: 'LINK', reason: 'VERIFIED_EMAIL_PLUS_EXPLICIT_CONFIRMATION', linked: true });
  }

  if (emailMatches) {
    // The single most important rule in this file.
    return Object.freeze({
      decision: 'REQUIRE_EXPLICIT_CONFIRMATION',
      reason: candidate.emailVerified ? 'EMAIL_ALONE_IS_NOT_PROOF' : 'EMAIL_NOT_VERIFIED_BY_PROVIDER',
      linked: false
    });
  }

  return Object.freeze({ decision: 'CREATE_NEW_IDENTITY', reason: null, linked: false });
}
