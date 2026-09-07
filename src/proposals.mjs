import { createHash, randomUUID } from 'node:crypto';

// Itinerary changes are a two-step, two-request protocol. Creating a proposal can
// never approve it: the approval flag lives on a separate authenticated request
// against a server-issued proposalId and the exact version the user reviewed.

export const PROPOSAL_STATES = Object.freeze(['AWAITING_USER_APPROVAL', 'APPROVED', 'SUPERSEDED', 'REJECTED']);

export function proposalCapabilities() {
  return Object.freeze({
    version: '1.0',
    states: PROPOSAL_STATES,
    createRoute: 'POST /api/v1/proposals',
    approveRoute: 'POST /api/v1/proposals/:id/approve',
    principles: [
      'A proposal is created without any approval semantics; userApproved in the creation body is ignored.',
      'Approval is a separate authenticated request carrying proposalId and the reviewed version.',
      'A stale version is rejected with 409 so nobody approves a diff they never saw.',
      'The active itinerary is byte-identical until an approval succeeds.'
    ]
  });
}

// Note: any `userApproved`/`approved` key in `input` is deliberately not read.
export function createProposal(input = {}, { globalUserId, now = new Date() } = {}) {
  if (!globalUserId) throw namedError('proposal_requires_authenticated_identity', 401);

  const diff = normalizeDiff(input.diff || input.proposedChanges || {});
  const version = 1;
  const proposalId = `prop_${randomUUID()}`;

  return Object.freeze({
    proposalId,
    globalUserId,
    version,
    state: 'AWAITING_USER_APPROVAL',
    diff,
    diffDigest: digestOf(diff, version),
    createdAt: now.toISOString(),
    approvedAt: null,
    // Explicit and load-bearing: nothing the caller sent can flip these.
    userApproved: false,
    mayApply: false,
    activeItineraryUnchanged: true
  });
}

export function reviseProposal(proposal, nextDiff, { now = new Date() } = {}) {
  assertProposal(proposal);
  const diff = normalizeDiff(nextDiff || {});
  const version = Number(proposal.version) + 1;
  return Object.freeze({
    ...proposal,
    version,
    diff,
    diffDigest: digestOf(diff, version),
    state: 'AWAITING_USER_APPROVAL',
    userApproved: false,
    mayApply: false,
    approvedAt: null,
    activeItineraryUnchanged: true,
    revisedAt: now.toISOString()
  });
}

export function approveProposal(proposal, {
  globalUserId = null,
  version = null,
  now = new Date()
} = {}) {
  assertProposal(proposal);

  if (!globalUserId) {
    throw namedError('proposal_approval_requires_authenticated_identity', 401);
  }
  if (proposal.globalUserId !== globalUserId) {
    throw namedError('proposal_approval_identity_mismatch', 403);
  }
  if (proposal.state === 'APPROVED') {
    return Object.freeze({ ...proposal, alreadyApproved: true });
  }
  // Number(null) is 0, so a missing version must be rejected before any
  // numeric comparison, or it would silently read as version 0 and fall
  // through to the staleness check.
  if (version === null || version === undefined || !Number.isInteger(Number(version))) {
    throw namedError('proposal_approval_version_required', 400);
  }
  if (Number(version) !== Number(proposal.version)) {
    // The proposal moved under the user's feet; they must re-read the new diff.
    throw namedError('proposal_version_stale', 409);
  }

  return Object.freeze({
    ...proposal,
    state: 'APPROVED',
    userApproved: true,
    mayApply: true,
    activeItineraryUnchanged: false,
    approvedAt: now.toISOString(),
    approvedBy: globalUserId,
    approvedVersion: Number(version)
  });
}

export function applyGuard(proposal) {
  const approved = proposal?.state === 'APPROVED' && proposal?.mayApply === true;
  return Object.freeze({
    mayMutateItinerary: approved,
    reason: approved ? null : 'ITINERARY_MUTATION_REQUIRES_APPROVED_PROPOSAL'
  });
}

function normalizeDiff(diff) {
  const summary = diff.summary ? String(diff.summary).slice(0, 500) : null;
  const operations = (Array.isArray(diff.operations) ? diff.operations : []).slice(0, 100).map((operation) => ({
    op: String(operation?.op || 'UPDATE').toUpperCase().slice(0, 20),
    target: operation?.target ? String(operation.target).slice(0, 190) : null,
    from: operation?.from ?? null,
    to: operation?.to ?? null
  }));
  return Object.freeze({ summary, operations: Object.freeze(operations) });
}

function digestOf(diff, version) {
  return createHash('sha256').update(`${version}:${JSON.stringify(diff)}`).digest('hex').slice(0, 32);
}

function assertProposal(proposal) {
  if (!proposal || !proposal.proposalId) throw namedError('proposal_not_found', 404);
}

function namedError(message, statusCode) {
  const error = new Error(message);
  error.code = message;
  error.statusCode = statusCode;
  return error;
}
