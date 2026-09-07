import { authenticatePersistedSession } from './auth-session.mjs';
import { approveItineraryProposal, createItineraryProposal, getItineraryProposal } from './itinerary-proposals.mjs';

const MAX_BODY_BYTES = 256 * 1024;
const COLLECTION_PATH = '/api/v1/planner/itinerary/proposals';

export async function handlePlannerProposalHttp(req, res, path, { sessionSigningKey, persistence } = {}) {
  if (path === COLLECTION_PATH && req.method === 'POST') {
    const actor = await authenticate(req, sessionSigningKey, persistence);
    const body = await readJson(req);
    const proposal = await createItineraryProposal({
      actor,
      tripId: body.tripId,
      baseVersion: body.baseVersion,
      changes: body.changes,
      ttlMs: body.ttlMs
    }, { persistence });
    sendJson(res, 201, { proposal });
    return true;
  }

  const match = /^\/api\/v1\/planner\/itinerary\/proposals\/([^/]+)(\/approve)?$/.exec(path);
  if (!match) return false;
  const proposalId = decodePathSegment(match[1]);
  const approving = match[2] === '/approve';

  if (!approving && req.method === 'GET') {
    const actor = await authenticate(req, sessionSigningKey, persistence);
    const proposal = await getItineraryProposal({ actor, proposalId }, { persistence });
    sendJson(res, 200, { proposal });
    return true;
  }

  if (approving && req.method === 'POST') {
    const actor = await authenticate(req, sessionSigningKey, persistence);
    const body = await readJson(req);
    const approval = await approveItineraryProposal({ actor, proposalId, version: body.version }, { persistence });
    sendJson(res, 200, approval);
    return true;
  }

  return false;
}

async function authenticate(req, sessionSigningKey, persistence) {
  if (typeof sessionSigningKey !== 'string' || sessionSigningKey.length < 32) throw namedError('authentication_not_configured', 503);
  return authenticatePersistedSession(req, sessionSigningKey, persistence);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw namedError('request_body_too_large', 413);
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw namedError('invalid_json', 400); }
}

function sendJson(res, statusCode, payload) {
  if (res.writableEnded) return;
  const data = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', Buffer.byteLength(data));
  res.end(data);
}

function decodePathSegment(value) {
  try {
    const decoded = decodeURIComponent(value);
    if (!decoded || decoded.includes('/') || decoded.length > 160) throw new Error('invalid');
    return decoded;
  } catch { throw namedError('proposal_id_invalid', 400); }
}

function namedError(code, statusCode) {
  const error = new Error(code);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}
