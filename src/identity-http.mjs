import { randomUUID } from 'node:crypto';
import { buildEcosystemIdentity, ecosystemIdentityCapabilities } from './ecosystem-identity.mjs';
import { authProviderCapabilities, evaluateAccountLink, normalizeProviderIdentity } from './auth-provider.mjs';
import { createSession, sessionCapabilities, sessionCookie } from './session.mjs';
import { entitlementCapabilities, gateFeature, resolveEntitlements } from './entitlements.mjs';
import { buildVacationBridge, calendarBoundaryCapabilities } from './calendar-boundary.mjs';
import { approveProposal, createProposal, proposalCapabilities } from './proposals.mjs';
import { persistenceCapabilities } from './persistence.mjs';

const MAX_JSON_BYTES = 256 * 1024;

export function identityHttpCapabilities() {
  return Object.freeze({
    version: '1.0',
    identity: ecosystemIdentityCapabilities(),
    authProvider: authProviderCapabilities(),
    session: sessionCapabilities(),
    entitlements: entitlementCapabilities(),
    calendarBoundary: calendarBoundaryCapabilities(),
    proposals: proposalCapabilities(),
    persistence: persistenceCapabilities()
  });
}

export async function handleIdentityHttp(req, res, path, context = {}) {
  const { repository, signingKey, session } = context;

  if (req.method === 'GET' && path === '/api/v1/identity/capabilities') {
    return sendJson(res, 200, identityHttpCapabilities());
  }

  // Public: exchanges a provider identity for a session. This is the only route
  // that may run without one.
  if (req.method === 'POST' && path === '/api/v1/auth/session') {
    const body = await readJson(req);
    const incoming = normalizeProviderIdentity(body.providerIdentity || {});
    if (!incoming) return sendJson(res, 400, { error: 'invalid_provider_identity' });

    const link = evaluateAccountLink({
      existingIdentity: body.existingIdentity || null,
      incoming,
      userConfirmedLink: body.userConfirmedLink === true
    });
    if (link.decision === 'REJECT') return sendJson(res, 400, { error: link.reason });
    if (link.decision === 'REQUIRE_EXPLICIT_CONFIRMATION') {
      return sendJson(res, 409, { error: 'account_link_confirmation_required', reason: link.reason });
    }

    const identity = buildEcosystemIdentity({
      globalUserId: body.globalUserId || null,
      memberships: body.memberships || []
    });
    const created = createSession({ globalUserId: identity.globalUserId, signingKey });
    if (repository) {
      await repository.put('identities', identity.globalUserId, 'self', identity);
    }
    res.setHeader('Set-Cookie', sessionCookie(created.token, { expiresAt: created.expiresAt }));
    return sendJson(res, 200, {
      globalUserId: identity.globalUserId,
      linkDecision: link.decision,
      expiresAt: created.expiresAt,
      crewCheckDetection: identity.crewCheckDetection
    });
  }

  // Everything below requires an authenticated session.
  if (req.method === 'GET' && path === '/api/v1/identity/me') {
    const stored = repository ? await repository.get('identities', session.globalUserId, 'self') : null;
    const identity = stored || buildEcosystemIdentity({ globalUserId: session.globalUserId });
    return sendJson(res, 200, {
      globalUserId: identity.globalUserId,
      memberships: identity.memberships,
      crewCheckDetection: identity.crewCheckDetection,
      dataBoundary: identity.dataBoundary
    });
  }

  if (req.method === 'GET' && path === '/api/v1/entitlements') {
    const subscriptions = repository ? await repository.list('subscriptions', session.globalUserId) : [];
    const stored = repository ? await repository.get('identities', session.globalUserId, 'self') : null;
    const resolved = resolveEntitlements({ subscriptions, memberships: stored?.memberships || {} });
    const consents = repository ? await repository.get('consents', session.globalUserId, 'self') : null;
    return sendJson(res, 200, {
      ...resolved,
      unifiedCalendarGate: gateFeature('UNIFIED_CALENDAR', {
        entitlements: resolved.entitlements,
        consents: consents || {}
      })
    });
  }

  if (req.method === 'POST' && path === '/api/v1/calendar/vacation-bridge') {
    const body = await readJson(req);
    const stored = repository ? await repository.get('identities', session.globalUserId, 'self') : null;
    const subscriptions = repository ? await repository.list('subscriptions', session.globalUserId) : [];
    const consents = repository ? await repository.get('consents', session.globalUserId, 'self') : null;
    const resolved = resolveEntitlements({ subscriptions, memberships: stored?.memberships || {} });
    return sendJson(res, 200, buildVacationBridge({
      identity: stored || { memberships: {} },
      entitlements: resolved.entitlements,
      consents: consents || {},
      crewCheckWindow: body.crewCheckWindow || {},
      personalEvents: body.personalEvents || []
    }));
  }

  if (req.method === 'POST' && path === '/api/v1/proposals') {
    const body = await readJson(req);
    const proposal = createProposal(body, { globalUserId: session.globalUserId });
    if (repository) await repository.put('proposals', session.globalUserId, proposal.proposalId, proposal);
    return sendJson(res, 201, {
      proposalId: proposal.proposalId,
      version: proposal.version,
      diff: proposal.diff,
      state: proposal.state,
      userApproved: proposal.userApproved,
      mayApply: proposal.mayApply
    });
  }

  const approveMatch = path.match(/^\/api\/v1\/proposals\/([A-Za-z0-9_-]{1,80})\/approve$/);
  if (req.method === 'POST' && approveMatch) {
    const body = await readJson(req);
    const stored = repository ? await repository.get('proposals', session.globalUserId, approveMatch[1]) : null;
    if (!stored) return sendJson(res, 404, { error: 'proposal_not_found' });
    const approved = approveProposal(stored, {
      globalUserId: session.globalUserId,
      version: body.version
    });
    if (repository) await repository.put('proposals', session.globalUserId, approved.proposalId, approved);
    return sendJson(res, 200, {
      proposalId: approved.proposalId,
      state: approved.state,
      version: approved.version,
      mayApply: approved.mayApply,
      approvedAt: approved.approvedAt
    });
  }

  return false;
}

function sendJson(res, statusCode, payload) {
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
  return true;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw namedError('request_body_too_large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw namedError('invalid_json', 400); }
}

function namedError(message, statusCode) {
  const error = new Error(message);
  error.code = message;
  error.statusCode = statusCode;
  return error;
}
