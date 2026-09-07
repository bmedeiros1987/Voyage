import test from 'node:test';
import assert from 'node:assert/strict';
import { buildJourneyCommandCenter } from '../src/journey-command-center.mjs';

test('a self-approval flag in the same request never approves the change', async () => {
  const result = await buildJourneyCommandCenter({
    userApproval: true,
    proposedChanges: { userApproved: true, changes: [{ id: 'c1', type: 'FLIGHT_CHANGE' }] }
  });
  assert.equal(result.proposal.approved, false);
  assert.equal(result.proposal.state, 'AWAITING_USER_APPROVAL');
  assert.equal(result.proposal.canApply, false);
  assert.equal(result.proposal.userApprovalRequired, true);
  assert.equal(result.mutationPolicy.executionState, 'PROPOSAL_ONLY');
});

test('detecting and proposing stays automatic; the active itinerary is untouched', async () => {
  const result = await buildJourneyCommandCenter({
    proposedChanges: { changes: [{ id: 'c1', type: 'FLIGHT_CHANGE' }] }
  });
  assert.equal(result.mutationPolicy.activeItineraryRemainsCurrentUntilApproval, true);
  assert.equal(result.proposal.automaticApplyAllowed, false);
  assert.equal(result.proposal.approvalRoute, 'POST /api/v1/proposals/:id/approve');
});
