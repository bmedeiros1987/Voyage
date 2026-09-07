// Google Pub/Sub push endpoints authenticate with an OIDC bearer token. Accepting
// an unverified body lets anyone forge Gmail change notifications, so the endpoint
// fails closed whenever verification is not fully configured.

export function pubSubVerificationCapabilities() {
  return Object.freeze({
    version: '1.0',
    requiredHeader: 'authorization',
    tokenType: 'GOOGLE_OIDC_JWT',
    verifiedClaims: ['iss', 'aud', 'exp', 'email', 'email_verified'],
    acceptedIssuers: ['https://accounts.google.com', 'accounts.google.com'],
    principles: [
      'An unsigned or unverifiable push notification is rejected, never processed.',
      'When the audience or service account is not configured, the endpoint fails closed.'
    ]
  });
}

export function decodeJwtSegments(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    return Object.freeze({
      header: JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')),
      claims: JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')),
      signature: parts[2]
    });
  } catch {
    return null;
  }
}

// `verifySignature` is injected so the transport-level RS256 check (Google's JWKS)
// can be supplied by the deployment without this module reaching the network.
export async function verifyPubSubPushRequest(req, {
  audience = null,
  serviceAccountEmail = null,
  verifySignature = null,
  now = Date.now()
} = {}) {
  if (!audience || !serviceAccountEmail || typeof verifySignature !== 'function') {
    return Object.freeze({ verified: false, reason: 'PUBSUB_VERIFICATION_NOT_CONFIGURED', statusCode: 503 });
  }

  const authorization = String(req?.headers?.authorization || '');
  if (!/^Bearer\s+/i.test(authorization)) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_TOKEN_MISSING', statusCode: 401 });
  }

  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const decoded = decodeJwtSegments(token);
  if (!decoded) return Object.freeze({ verified: false, reason: 'PUBSUB_TOKEN_MALFORMED', statusCode: 401 });

  const { claims } = decoded;
  const issuers = pubSubVerificationCapabilities().acceptedIssuers;
  if (!issuers.includes(String(claims.iss || ''))) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_ISSUER_INVALID', statusCode: 401 });
  }
  if (String(claims.aud || '') !== String(audience)) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_AUDIENCE_MISMATCH', statusCode: 401 });
  }
  if (String(claims.email || '').toLowerCase() !== String(serviceAccountEmail).toLowerCase()) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_SERVICE_ACCOUNT_MISMATCH', statusCode: 401 });
  }
  if (claims.email_verified !== true) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_SERVICE_ACCOUNT_UNVERIFIED', statusCode: 401 });
  }
  if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) * 1000 <= now) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_TOKEN_EXPIRED', statusCode: 401 });
  }

  const signatureValid = await verifySignature(token, decoded);
  if (signatureValid !== true) {
    return Object.freeze({ verified: false, reason: 'PUBSUB_SIGNATURE_INVALID', statusCode: 401 });
  }

  return Object.freeze({ verified: true, reason: null, statusCode: 200, serviceAccount: String(claims.email) });
}
