import { authenticatePersistedSession } from './auth-session.mjs';
import { buildEcosystemIdentity } from './ecosystem-identity.mjs';
import { resolveEntitlements } from './entitlements.mjs';
import { buildVacationBridge } from './calendar-boundary.mjs';

const PREFIX = '/api/v1/ecosystem';
const CONNECTION_CONSENT = 'CREWCHECK_VOYAGE_CONNECTION';
const VACATION_BRIDGE_PATH = `${PREFIX}/vacation-bridge`;
const LEGACY_PREVIEW_PATH = `${VACATION_BRIDGE_PATH}/preview`;
const MAX_JSON_BYTES = 256 * 1024;

export async function handleEcosystemHttp(req, res, path, { sessionSigningKey, persistence } = {}) {
  if (typeof path !== 'string' || (path !== PREFIX && !path.startsWith(`${PREFIX}/`))) return false;
  requirePersistence(persistence);
  const auth = await authenticatePersistedSession(req, sessionSigningKey, persistence);

  if (req.method === 'GET' && path === `${PREFIX}/context`) {
    return json(res, 200, await buildRuntimeContext(auth.userId, persistence));
  }

  if (req.method === 'POST' && path === `${PREFIX}/consents/crewcheck-voyage`) {
    const body = await readJson(req, MAX_JSON_BYTES);
    if (typeof body.granted !== 'boolean') return json(res, 400, { error: 'consent_granted_boolean_required' });
    const consent = await persistence.setConsent(auth.userId, CONNECTION_CONSENT, body.granted, {
      source: 'VOYAGE_USER_ACTION',
      changedAt: new Date().toISOString()
    });
    return json(res, 200, {
      consentKey: CONNECTION_CONSENT,
      granted: consent.granted,
      updatedAt: consent.updatedAt
    });
  }

  // This operation only projects already-authorized context. It never changes
  // CrewCheck data or the Voyage itinerary, so it has a production-safe path
  // instead of depending on the globally disabled /preview namespace.
  if (req.method === 'POST' && (path === VACATION_BRIDGE_PATH || path === LEGACY_PREVIEW_PATH)) {
    const body = await readJson(req, MAX_JSON_BYTES);
    const context = await buildRuntimeContext(auth.userId, persistence);
    const result = buildVacationBridge({
      identity: context.identity,
      entitlements: context.entitlements,
      consents: context.consents,
      crewCheckWindow: body.crewCheckWindow || {},
      personalEvents: Array.isArray(body.personalEvents) ? body.personalEvents : []
    });
    return json(res, 200, result);
  }

  return json(res, 404, { error: 'ecosystem_route_not_found' });
}

export async function buildRuntimeContext(globalUserId, persistence) {
  requirePersistence(persistence);
  const profile = await persistence.getEcosystemProfile(globalUserId);
  const canonicalIdentity = buildEcosystemIdentity({ globalUserId, memberships: profile.memberships });
  const hasActiveCrewCheck = canonicalIdentity.memberships.CREWCHECK.state === 'ACTIVE';

  // Visitor/inactive relationships are private server-side history, not a hint
  // that Voyage should ask whether the person is crew. Only an active,
  // CrewCheck-verified membership crosses this presentation boundary.
  const identity = hasActiveCrewCheck ? canonicalIdentity : buildEcosystemIdentity({
    globalUserId,
    createdAt: canonicalIdentity.createdAt,
    memberships: profile.memberships.filter((item) => String(item?.product || '').toUpperCase() !== 'CREWCHECK')
  });
  const visibleSubscriptions = hasActiveCrewCheck
    ? profile.subscriptions
    : profile.subscriptions.filter((item) => String(item?.product || '').toUpperCase() !== 'CREWCHECK');
  const resolved = resolveEntitlements({ subscriptions: visibleSubscriptions, memberships: identity.memberships });
  const persistedConsents = Object.fromEntries(
    profile.consents.map((item) => [item.consentKey, item.granted === true])
  );
  // A historical consent record must not reveal an inactive/visitor CrewCheck
  // relationship back to the Voyage UI.
  const consents = Object.freeze({
    ...persistedConsents,
    [CONNECTION_CONSENT]: hasActiveCrewCheck && persistedConsents[CONNECTION_CONSENT] === true
  });

  return Object.freeze({
    globalUserId,
    identity,
    memberships: identity.memberships,
    crewCheckDetection: identity.crewCheckDetection,
    entitlements: resolved.entitlements,
    unifiedCalendar: resolved.unifiedCalendar,
    subscriptions: resolved.subscriptions,
    consents
  });
}

function requirePersistence(persistence) {
  const methods = ['putSession', 'getSession', 'getEcosystemProfile', 'setConsent'];
  if (!persistence || methods.some((method) => typeof persistence[method] !== 'function')) {
    const error = new Error('ecosystem_persistence_required');
    error.code = error.message;
    error.statusCode = 500;
    throw error;
  }
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const error = new Error('request_body_too_large');
      error.code = error.message;
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch {
    const error = new Error('invalid_json');
    error.code = error.message;
    error.statusCode = 400;
    throw error;
  }
}

function json(res, statusCode, payload) {
  if (res.writableEnded) return true;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
  return true;
}
