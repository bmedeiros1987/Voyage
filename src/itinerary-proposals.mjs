import { createHash, randomUUID } from 'node:crypto';

const MAX_PROPOSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_PROPOSAL_TTL_MS = 24 * 60 * 60 * 1000;

export async function createItineraryProposal({ actor, tripId, baseVersion, changes, ttlMs = DEFAULT_PROPOSAL_TTL_MS } = {}, { persistence, now = Date.now } = {}) {
  requireActor(actor);
  requirePersistence(persistence);
  requireId(tripId, 'proposal_trip_id_required');
  if (!Number.isInteger(baseVersion) || baseVersion < 0) throw namedError('proposal_base_version_invalid');
  const normalizedChanges = normalizeChanges(changes);
  if (!normalizedChanges.length) throw namedError('proposal_changes_required');
  const createdAtMs = Number(now());
  if (!Number.isFinite(createdAtMs)) throw namedError('proposal_clock_invalid');
  const boundedTtl = Math.max(60_000, Math.min(MAX_PROPOSAL_TTL_MS, Math.floor(Number(ttlMs) || DEFAULT_PROPOSAL_TTL_MS)));
  const proposal = {
    id: randomUUID(),
    tripId,
    createdByUserId: actor.userId,
    baseVersion,
    version: 1,
    status: 'PENDING',
    changes: normalizedChanges,
    changesDigest: digestChanges(normalizedChanges),
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(createdAtMs + boundedTtl).toISOString(),
    approvedByUserId: null,
    approvedAt: null
  };
  await persistence.createProposal(proposal);
  return publicProposal(proposal);
}

export async function approveItineraryProposal({ actor, proposalId, version } = {}, { persistence, now = Date.now } = {}) {
  requireActor(actor);
  requirePersistence(persistence);
  requireId(proposalId, 'proposal_id_required');
  if (!Number.isInteger(version) || version < 1) throw namedError('proposal_version_required');
  const current = await persistence.getProposal(proposalId);
  if (!current) throw namedError('proposal_not_found', 404);
  if (current.version !== version) throw namedError('proposal_version_conflict', 409);
  if (current.status !== 'PENDING') throw namedError('proposal_not_pending', 409);
  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) throw namedError('proposal_clock_invalid');
  if (current.expiresAt && new Date(current.expiresAt).getTime() <= nowMs) {
    await persistence.updateProposal(proposalId, (proposal) => ({ ...proposal, status: 'EXPIRED' }));
    throw namedError('proposal_expired', 409);
  }
  if (!actor.permissions?.includes('itinerary:approve') && actor.userId !== current.createdByUserId) {
    throw namedError('proposal_approval_forbidden', 403);
  }
  const approvedAt = new Date(nowMs).toISOString();
  const approved = await persistence.updateProposal(proposalId, (proposal) => ({
    ...proposal,
    status: 'APPROVED',
    approvedByUserId: actor.userId,
    approvedAt
  }));
  if (!approved) throw namedError('proposal_not_found', 404);
  return {
    proposal: publicProposal(approved),
    applyCommand: Object.freeze({
      kind: 'APPLY_ITINERARY_PROPOSAL',
      proposalId: approved.id,
      proposalVersion: approved.version,
      tripId: approved.tripId,
      expectedTripVersion: approved.baseVersion,
      changesDigest: approved.changesDigest || digestChanges(approved.changes)
    })
  };
}

export async function getItineraryProposal({ actor, proposalId } = {}, { persistence } = {}) {
  requireActor(actor);
  requirePersistence(persistence);
  requireId(proposalId, 'proposal_id_required');
  const proposal = await persistence.getProposal(proposalId);
  if (!proposal) throw namedError('proposal_not_found', 404);
  if (proposal.createdByUserId !== actor.userId && !actor.permissions?.includes('itinerary:approve')) throw namedError('proposal_read_forbidden', 403);
  return publicProposal(proposal);
}

export function digestChanges(changes) {
  return createHash('sha256').update(stableJson(normalizeChanges(changes))).digest('hex');
}

function publicProposal(proposal) {
  return Object.freeze({
    proposalId: proposal.id,
    tripId: proposal.tripId,
    baseVersion: proposal.baseVersion,
    version: proposal.version,
    status: proposal.status,
    changes: structuredClone(proposal.changes),
    changesDigest: proposal.changesDigest || digestChanges(proposal.changes),
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    approvedByUserId: proposal.approvedByUserId || null,
    approvedAt: proposal.approvedAt || null,
    approvalRequired: proposal.status === 'PENDING'
  });
}

function normalizeChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes.slice(0, 500).map((change, index) => {
    if (!change || typeof change !== 'object' || Array.isArray(change)) throw namedError('proposal_change_invalid');
    const operation = String(change.operation || '').trim().toUpperCase();
    if (!['ADD', 'UPDATE', 'REMOVE', 'MOVE'].includes(operation)) throw namedError('proposal_change_operation_invalid');
    const entityId = String(change.entityId || '').trim();
    if (!entityId || entityId.length > 160) throw namedError('proposal_change_entity_required');
    const payload = sanitizeJson(change.payload ?? null, 0);
    return Object.freeze({ index, operation, entityId, payload });
  });
}

function sanitizeJson(value, depth) {
  if (depth > 6) throw namedError('proposal_change_too_deep');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
    if (typeof value === 'string') return value.slice(0, 4000);
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeJson(item, depth + 1));
  if (typeof value === 'object') {
    const result = {};
    for (const [key, nested] of Object.entries(value).slice(0, 100)) {
      const safeKey = String(key).slice(0, 120);
      result[safeKey] = sanitizeJson(nested, depth + 1);
    }
    return result;
  }
  return null;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function requireActor(actor) {
  requireId(actor?.userId, 'authentication_required');
}
function requirePersistence(persistence) {
  if (!persistence || typeof persistence.createProposal !== 'function' || typeof persistence.getProposal !== 'function' || typeof persistence.updateProposal !== 'function') throw namedError('proposal_persistence_required', 500);
}
function requireId(value, code) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160) throw namedError(code);
}
function namedError(code, statusCode = 400) { const error = new Error(code); error.code = code; error.statusCode = statusCode; return error; }
