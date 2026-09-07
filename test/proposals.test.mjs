import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGuard, approveProposal, createProposal, reviseProposal } from '../src/proposals.mjs';

const DIFF = { summary: 'trocar voo', operations: [{ op: 'REPLACE', target: 'leg-1', from: 'AF457', to: 'AF459' }] };

test('creating a proposal never approves it, even when the body claims approval', () => {
  const proposal = createProposal(
    { diff: DIFF, userApproved: true, approved: true, proposedChanges: { userApproved: true } },
    { globalUserId: 'gid_a' }
  );
  assert.equal(proposal.state, 'AWAITING_USER_APPROVAL');
  assert.equal(proposal.userApproved, false);
  assert.equal(proposal.mayApply, false);
  assert.equal(proposal.activeItineraryUnchanged, true);
});

test('a proposal carries a server-issued id, version and diff', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  assert.match(proposal.proposalId, /^prop_/);
  assert.equal(proposal.version, 1);
  assert.equal(proposal.diff.summary, 'trocar voo');
});

test('creating a proposal without an authenticated identity is refused', () => {
  assert.throws(() => createProposal({ diff: DIFF }, {}), /requires_authenticated_identity/);
});

test('approval requires an authenticated identity', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  assert.throws(() => approveProposal(proposal, { version: 1 }), /requires_authenticated_identity/);
});

test('another user cannot approve someone else\'s proposal', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  assert.throws(() => approveProposal(proposal, { globalUserId: 'gid_b', version: 1 }), /identity_mismatch/);
});

test('approval requires a version', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  assert.throws(() => approveProposal(proposal, { globalUserId: 'gid_a' }), /version_required/);
});

test('a stale version is rejected so nobody approves a diff they never saw', () => {
  const first = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  const revised = reviseProposal(first, { summary: 'trocar hotel', operations: [] });
  assert.equal(revised.version, 2);
  const error = (() => { try { approveProposal(revised, { globalUserId: 'gid_a', version: 1 }); } catch (e) { return e; } })();
  assert.match(error.message, /proposal_version_stale/);
  assert.equal(error.statusCode, 409);
});

test('approval on the reviewed version succeeds and unlocks apply', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  const approved = approveProposal(proposal, { globalUserId: 'gid_a', version: 1 });
  assert.equal(approved.state, 'APPROVED');
  assert.equal(approved.mayApply, true);
  assert.equal(approved.approvedBy, 'gid_a');
  assert.equal(applyGuard(approved).mayMutateItinerary, true);
});

test('an unapproved proposal can never mutate the itinerary', () => {
  const proposal = createProposal({ diff: DIFF, userApproved: true }, { globalUserId: 'gid_a' });
  const guard = applyGuard(proposal);
  assert.equal(guard.mayMutateItinerary, false);
  assert.equal(guard.reason, 'ITINERARY_MUTATION_REQUIRES_APPROVED_PROPOSAL');
});

test('revising a proposal revokes a previous approval', () => {
  const proposal = createProposal({ diff: DIFF }, { globalUserId: 'gid_a' });
  const approved = approveProposal(proposal, { globalUserId: 'gid_a', version: 1 });
  const revised = reviseProposal(approved, { summary: 'outro', operations: [] });
  assert.equal(revised.userApproved, false);
  assert.equal(applyGuard(revised).mayMutateItinerary, false);
});
